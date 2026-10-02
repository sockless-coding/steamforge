using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Data;

namespace SF.Application.Features.Content;

/// <summary>Holds the current validated content snapshot. Replaced atomically on reload.</summary>
public sealed class ContentCatalog
{
    private ContentSnapshot? _current;

    public ContentSnapshot Current => _current ?? throw new InvalidOperationException("Content has not been loaded.");

    public void Set(ContentSnapshot snapshot) => Interlocked.Exchange(ref _current, snapshot);
}

/// <summary>
/// Builds each content document from <c>Content/&lt;kind&gt;.json</c> plus any content packs in
/// <c>Content/packs/&lt;pack&gt;/&lt;kind&gt;.json</c> (applied in folder-name order), persists it, validates the whole
/// set, and publishes the snapshot to <see cref="ContentCatalog"/>. Rows marked as overrides are never replaced, so
/// live tuning in the database survives restarts.
/// </summary>
public sealed class ContentSeeder(AppDbContext db, ContentCatalog catalog, TimeProvider clock, ILogger<ContentSeeder> logger)
{
    public static string ContentDirectory => Path.Combine(AppContext.BaseDirectory, "Content");

    public async Task<ContentSnapshot> SeedAndLoadAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var existing = await db.ContentDocuments.ToDictionaryAsync(d => d.Kind, ct);
        var packs = Directory.Exists(Path.Combine(ContentDirectory, "packs"))
            ? Directory.GetDirectories(Path.Combine(ContentDirectory, "packs")).OrderBy(p => p, StringComparer.Ordinal).ToList()
            : [];

        var documents = new Dictionary<string, string>();
        foreach (var kind in ContentKinds.All)
        {
            var json = await BuildDocumentAsync(kind, packs, ct);
            documents[kind] = Upsert(existing, kind, json, now).Json;
        }

        await db.SaveChangesAsync(ct);

        var version = Sha256(string.Join('|', ContentKinds.All.Select(k => $"{k}:{Sha256(documents[k])}")))[..16].ToLowerInvariant();
        var snapshot = new ContentSnapshot(version, documents);
        var errors = ContentValidator.Validate(snapshot);
        if (errors.Count > 0)
        {
            throw new InvalidOperationException("Content validation failed:" + Environment.NewLine + string.Join(Environment.NewLine, errors));
        }

        catalog.Set(snapshot);
        logger.LogInformation(
            "Content {Version} loaded: {Buildings} buildings, {Resources} resources, {Presets} difficulty presets, {Packs} packs",
            version, snapshot.Buildings.Count, snapshot.Resources.Count, snapshot.Difficulty.Presets.Count, packs.Count);
        return snapshot;
    }

    private static async Task<string> BuildDocumentAsync(string kind, List<string> packs, CancellationToken ct)
    {
        var node = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(ContentDirectory, $"{kind}.json"), ct));
        foreach (var pack in packs)
        {
            var file = Path.Combine(pack, $"{kind}.json");
            if (File.Exists(file))
            {
                node = ContentMerger.Merge(node, JsonNode.Parse(await File.ReadAllTextAsync(file, ct)));
            }
        }

        return node?.ToJsonString() ?? "null";
    }

    private ContentDocument Upsert(Dictionary<string, ContentDocument> existing, string kind, string json, DateTime now)
    {
        var hash = Sha256(json);
        if (!existing.TryGetValue(kind, out var doc))
        {
            doc = new ContentDocument { Kind = kind, Json = json, Hash = hash, UpdatedAt = now };
            db.ContentDocuments.Add(doc);
            existing[kind] = doc;
        }
        else if (!doc.IsOverride && doc.Hash != hash)
        {
            doc.Json = json;
            doc.Hash = hash;
            doc.UpdatedAt = now;
        }

        return doc;
    }

    private static string Sha256(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
}

public static class ContentStartupExtensions
{
    public static IServiceCollection AddContent(this IServiceCollection services)
    {
        services.AddSingleton<ContentCatalog>();
        services.AddScoped<ContentSeeder>();
        return services;
    }

    public static async Task SeedContentAsync(this IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<ContentSeeder>().SeedAndLoadAsync(ct);
    }
}
