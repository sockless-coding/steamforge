using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using SF.Application.Features.Content;
using SF.Application.Tests.Infrastructure;

namespace SF.Application.Tests.Features;

public sealed class ContentTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;

    public ContentTests(TestApp app) => _app = app;

    private ContentSnapshot Snapshot => _app.Services.GetRequiredService<ContentCatalog>().Current;

    [Fact]
    public async Task Content_is_served_anonymously_with_etag_revalidation()
    {
        var client = _app.CreateClient();
        var response = await client.GetAsync("/api/content");
        response.EnsureSuccessStatusCode();
        var etag = response.Headers.ETag!.Tag;

        var bundle = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
        foreach (var kind in ContentKinds.All)
        {
            Assert.True(bundle.ContainsKey(kind), $"bundle is missing {kind}");
        }

        Assert.Equal(Snapshot.Version, bundle["version"]!.GetValue<string>());

        using var revalidate = new HttpRequestMessage(HttpMethod.Get, "/api/content");
        revalidate.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var notModified = await client.SendAsync(revalidate);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
    }

    [Fact]
    public void Shipped_content_meets_the_minimums()
    {
        var c = Snapshot;
        Assert.Empty(ContentValidator.Validate(c));
        Assert.True(c.Difficulty.Presets.Count >= 4, "four difficulty presets");
        Assert.True(c.Buildings.Count >= 20, "a full starting building set");
        Assert.Contains(c.Buildings, b => b.Components.ContainsKey("housing"));
        Assert.Contains(c.Buildings, b => b.Components.ContainsKey("field"));
        Assert.Contains(c.Buildings, b => b.Components.ContainsKey("generator") && b.Components.ContainsKey("workplace"));
        Assert.Contains(c.Buildings, b => b.Components.ContainsKey("research"));
        Assert.Single(c.Buildings, b => b.Headquarters == true);
        Assert.True(c.Resources.Count(r => r.Category == "food") >= 5, "food variety");

        // Every network has a generator, and at least one building needs it outright.
        foreach (var net in c.Rules.Networks)
        {
            Assert.Contains(c.Buildings, b => b.Components.TryGetValue("generator", out var g) && g.GetProperty("network").GetString() == net.Id);
            Assert.Contains(c.Buildings, b => b.Components.TryGetValue("consumer", out var u)
                && u.GetProperty("uses").TryGetProperty(net.Id, out _)
                && u.TryGetProperty("required", out var req) && req.GetBoolean());
        }

        // Research builds on itself, and a building that makes research points is available from the start.
        Assert.True(c.Research.Count >= 10, "a research tree");
        Assert.Contains(c.Research, t => t.Requires.Count > 0);
        var locked = c.Research.SelectMany(t => t.Unlocks.Buildings ?? []).ToHashSet();
        Assert.Contains(c.Buildings, b => b.Components.ContainsKey("research") && !locked.Contains(b.Id));
        Assert.NotEmpty(c.Story.Dispatches);

        // Harder presets start with less.
        var ordered = c.Difficulty.Presets.OrderBy(p => p.Order).ToList();
        for (var i = 1; i < ordered.Count; i++)
        {
            Assert.True(ordered[i].StartingFamilies <= ordered[i - 1].StartingFamilies, $"{ordered[i].Id} families");
            Assert.True(ordered[i].Modifiers["winterSeverity"] >= ordered[i - 1].Modifiers["winterSeverity"], $"{ordered[i].Id} winters");
        }
    }

    [Fact]
    public void Validator_reports_broken_references()
    {
        var docs = Snapshot.Documents.ToDictionary(kv => kv.Key, kv => kv.Value);
        var buildings = JsonNode.Parse(docs["buildings"])!.AsArray();
        var cottage = buildings.First(b => b!["id"]!.GetValue<string>() == "cottage")!;
        cottage["cost"]!["resources"]!["unobtainium"] = 5;
        cottage["components"]!["teleporter"] = new JsonObject();
        docs["buildings"] = buildings.ToJsonString();

        var difficulty = JsonNode.Parse(docs["difficulty"])!;
        difficulty["defaultPreset"] = "nonexistent";
        docs["difficulty"] = difficulty.ToJsonString();

        var errors = ContentValidator.Validate(new ContentSnapshot("test", docs));
        Assert.Contains(errors, e => e.Contains("unobtainium"));
        Assert.Contains(errors, e => e.Contains("teleporter"));
        Assert.Contains(errors, e => e.Contains("default preset"));
    }

    [Fact]
    public void Validator_reports_broken_research_and_story()
    {
        var docs = Snapshot.Documents.ToDictionary(kv => kv.Key, kv => kv.Value);
        var research = JsonNode.Parse(docs["research"])!.AsArray();
        var mining = research.First(t => t!["id"]!.GetValue<string>() == "mining")!;
        var metallurgy = research.First(t => t!["id"]!.GetValue<string>() == "metallurgy")!;
        mining["requires"] = new JsonArray("metallurgy");
        metallurgy["unlocks"]!["buildings"] = new JsonArray("smelter", "zeppelin-dock", "steamforge");
        docs["research"] = research.ToJsonString();

        var story = JsonNode.Parse(docs["story"])!;
        story["dispatches"]!.AsArray().Add(JsonNode.Parse("""{"id":"x","title":"X","text":"X","when":{"year":2,"research":"time-travel"}}"""));
        docs["story"] = story.ToJsonString();

        var errors = ContentValidator.Validate(new ContentSnapshot("test", docs));
        Assert.Contains(errors, e => e.Contains("requirement cycle"));
        Assert.Contains(errors, e => e.Contains("zeppelin-dock"));
        Assert.Contains(errors, e => e.Contains("headquarters cannot be locked"));
        Assert.Contains(errors, e => e.Contains("exactly one trigger"));
        Assert.Contains(errors, e => e.Contains("time-travel"));
    }

    [Fact]
    public void Content_packs_merge_by_id()
    {
        var baseDoc = JsonNode.Parse("""[{"id":"a","name":"A","cost":{"logs":1}},{"id":"b","name":"B"}]""");
        var pack = JsonNode.Parse("""[{"id":"a","cost":{"stone":2}},{"id":"b","remove":true},{"id":"c","name":"C"}]""");
        var merged = ContentMerger.Merge(baseDoc, pack)!.AsArray();

        Assert.Equal(["a", "c"], merged.Select(n => n!["id"]!.GetValue<string>()));
        Assert.Equal("A", merged[0]!["name"]!.GetValue<string>());
        Assert.Equal(1, merged[0]!["cost"]!["logs"]!.GetValue<int>());
        Assert.Equal(2, merged[0]!["cost"]!["stone"]!.GetValue<int>());

        var obj = ContentMerger.Merge(JsonNode.Parse("""{"x":1,"y":{"z":2}}"""), JsonNode.Parse("""{"y":{"w":3}}"""))!;
        Assert.Equal(JsonSerializer.Serialize(new { x = 1, y = new { z = 2, w = 3 } }), obj.ToJsonString());
    }
}
