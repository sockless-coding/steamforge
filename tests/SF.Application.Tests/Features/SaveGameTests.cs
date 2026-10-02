using System.Net;
using System.Net.Http.Json;
using SF.Application.Features.SaveGames;
using SF.Application.Features.Statistics;
using SF.Application.Tests.Infrastructure;

namespace SF.Application.Tests.Features;

public sealed class SaveGameTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;

    public SaveGameTests(TestApp app) => _app = app;

    private static PutSaveGameRequest Save(string data = "SGVsbG8gY29sb255", long? expected = null) =>
        new("Brassbury", "Year 3, Summer", "engineer", 3, 42, "abc123", 1, data, expected);

    [Fact]
    public async Task Saves_round_trip_and_list_without_data()
    {
        var (client, _) = await _app.CreateGuestClientAsync();
        var put = await client.PutAsJsonAsync("/api/saves/2", Save(), TestApp.Json);
        put.EnsureSuccessStatusCode();
        var summary = (await put.Content.ReadFromJsonAsync<SaveGameSummary>(TestApp.Json))!;
        Assert.Equal(42, summary.Population);

        var list = (await client.GetFromJsonAsync<List<SaveGameSummary>>("/api/saves", TestApp.Json))!;
        Assert.Single(list);
        Assert.Equal("Brassbury", list[0].Name);

        var details = (await client.GetFromJsonAsync<SaveGameDetails>("/api/saves/2", TestApp.Json))!;
        Assert.Equal("SGVsbG8gY29sb255", details.Data);

        (await client.DeleteAsync("/api/saves/2")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/saves/2")).StatusCode);
    }

    [Fact]
    public async Task Saves_are_private_and_versioned()
    {
        var (owner, _) = await _app.CreateGuestClientAsync();
        var (other, _) = await _app.CreateGuestClientAsync();
        var first = (await (await owner.PutAsJsonAsync("/api/saves/1", Save(), TestApp.Json)).Content.ReadFromJsonAsync<SaveGameSummary>(TestApp.Json))!;

        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync("/api/saves/1")).StatusCode);

        var stale = await owner.PutAsJsonAsync("/api/saves/1", Save(expected: first.Version + 5), TestApp.Json);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var fresh = await owner.PutAsJsonAsync("/api/saves/1", Save(expected: first.Version), TestApp.Json);
        fresh.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Invalid_saves_are_rejected()
    {
        var (client, _) = await _app.CreateGuestClientAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/saves/1", Save("not base64!"), TestApp.Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/saves/99", Save(), TestApp.Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _app.CreateClient().GetAsync("/api/saves")).StatusCode);
    }

    [Fact]
    public async Task Colony_records_only_ever_improve()
    {
        var (client, _) = await _app.CreateGuestClientAsync();
        (await client.PostAsJsonAsync("/api/stats/colony", new ReportColonyRequest("ironclad", true, 0, 12), TestApp.Json)).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/stats/colony", new ReportColonyRequest("ironclad", false, 6, 80), TestApp.Json)).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/stats/colony", new ReportColonyRequest("ironclad", false, 2, 20), TestApp.Json)).EnsureSuccessStatusCode();

        var records = (await client.GetFromJsonAsync<List<ColonyRecordDto>>("/api/stats", TestApp.Json))!;
        var record = Assert.Single(records);
        Assert.Equal(1, record.ColoniesFounded);
        Assert.Equal(6, record.BestYears);
        Assert.Equal(80, record.PeakPopulation);

        var unknown = await client.PostAsJsonAsync("/api/stats/colony", new ReportColonyRequest("godmode", true, 1, 1), TestApp.Json);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
    }
}
