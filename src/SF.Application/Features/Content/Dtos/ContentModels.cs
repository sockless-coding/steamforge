using System.Text.Json;
using System.Text.Json.Serialization;

namespace SF.Application.Features.Content;

// Typed views over the content documents, used for validation and server-side lookups. The client receives the
// merged JSON verbatim, so fields the server does not need are deliberately absent here: adding a content field
// requires no server change unless it must be validated.

public static class ContentJson
{
    /// <summary>Serializer settings for content documents: camelCase properties and enums, unknown fields ignored.</summary>
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        WriteIndented = false,
    };
}

public sealed record SeasonDef(string Id, string Name, IReadOnlyList<int> Months, bool Growing);

public sealed record RoadDef(string Id, string Name, Dictionary<string, double> Cost, double Work, double Speed);

public sealed record ConduitDef(string Name, Dictionary<string, double> Cost, double Work);

/// <summary>An energy network (steam, galvanic power): generators and consumers joined by conduit tiles.</summary>
public sealed record NetworkDef(string Id, string Name, string Color, ConduitDef Conduit);

/// <summary>Day and night: the lit share of each month's day, and how fast lamplit night work goes.</summary>
public sealed record DayRules(int DaysPerMonth, IReadOnlyList<double> Daylight, double NightWorkFactor);

public sealed record RulesDef(
    int TicksPerSecond,
    int SecondsPerMonth,
    DayRules Day,
    IReadOnlyList<string> Months,
    IReadOnlyList<SeasonDef> Seasons,
    IReadOnlyList<double> Temperature,
    IReadOnlyList<RoadDef> Roads,
    IReadOnlyList<NetworkDef> Networks);

public sealed record ResourceDef(string Id, string Name, string Category, string Color, double SpoilagePerYear, int DefaultLimit);

public sealed record FeatureYield(string Resource, double Amount, double Seconds, IReadOnlyList<string>? Ripens);

public sealed record FeatureDef(string Id, string Name, string Model, FeatureYield Clear, FeatureYield? Harvest);

public sealed record ModelPart(string Shape, string Mat, IReadOnlyList<double> Pos, IReadOnlyList<double> Size, string? Emit);

public sealed record ModelSpec(IReadOnlyList<ModelPart> Parts);

public sealed record TerrainRule(string Id, int Min);

public sealed record VariableSize(IReadOnlyList<int> Min, IReadOnlyList<int> Max);

public sealed record PlacementRules(TerrainRule? Terrain, TerrainRule? Adjacent, VariableSize? VariableSize);

public sealed record BuildingCost(Dictionary<string, double> Resources, double Work);

public sealed record BuildingDef(
    string Id,
    string Name,
    string Category,
    IReadOnlyList<int> Size,
    BuildingCost Cost,
    int? Limit,
    bool? Buildable,
    bool? Headquarters,
    PlacementRules? Placement,
    Dictionary<string, JsonElement> Components,
    ModelSpec Model);

public sealed record RecipeDef(string Id, string Name, Dictionary<string, double> Inputs, Dictionary<string, double> Outputs, double Seconds);

public sealed record CropDef(string Id, string Name, string Resource, double YieldPerTile, int GrowthMonths);

public sealed record ProfessionDef(string Id, string Name, string Color);

public sealed record EventDef(
    string Id,
    string Name,
    string Kind,
    bool Disaster,
    double Weight,
    int MinYear,
    IReadOnlyList<string>? Seasons,
    Dictionary<string, JsonElement>? Params);

public sealed record ResearchUnlocks(
    IReadOnlyList<string>? Buildings,
    IReadOnlyList<string>? Roads,
    IReadOnlyList<string>? Networks,
    IReadOnlyList<string>? Recipes);

public sealed record ResearchDef(string Id, string Name, int Tier, double Points, IReadOnlyList<string> Requires, ResearchUnlocks Unlocks);

public sealed record StoryIntro(string Title, IReadOnlyList<string> Paragraphs, string Signature);

/// <summary>When a dispatch arrives: exactly one of the fields is set.</summary>
public sealed record DispatchTrigger(string? Research, string? Building, int? Year, int? Population);

public sealed record DispatchDef(string Id, string Title, string Text, DispatchTrigger When);

public sealed record StoryDef(StoryIntro Intro, IReadOnlyList<DispatchDef> Dispatches);

public sealed record StartingBuilding(string Id, int Count);

public sealed record DifficultyPreset(
    string Id,
    string Name,
    int Order,
    int StartingFamilies,
    Dictionary<string, double> StartingResources,
    IReadOnlyList<StartingBuilding> StartingBuildings,
    IReadOnlyList<string>? StartingResearch,
    Dictionary<string, double> Modifiers);

public sealed record DifficultyCatalog(string DefaultPreset, IReadOnlyList<DifficultyPreset> Presets);

public sealed record MapSizeDef(string Id, string Name, int Size);

public sealed record TerrainPresetDef(string Id, string Name, Dictionary<string, int> Deposits);

public sealed record MapGenDef(string DefaultSize, string DefaultTerrain, IReadOnlyList<MapSizeDef> Sizes, IReadOnlyList<TerrainPresetDef> Terrains);

/// <summary>An immutable, validated view of all content plus the pre-serialized bundle served to clients.</summary>
public sealed class ContentSnapshot
{
    public ContentSnapshot(string version, IReadOnlyDictionary<string, string> documents)
    {
        Version = version;
        Documents = documents;
        T Read<T>(string kind) => JsonSerializer.Deserialize<T>(documents[kind], ContentJson.Options)
            ?? throw new InvalidOperationException($"Content document '{kind}' is empty.");

        Rules = Read<RulesDef>("rules");
        Resources = Read<List<ResourceDef>>("resources");
        Features = Read<List<FeatureDef>>("features");
        Buildings = Read<List<BuildingDef>>("buildings");
        Recipes = Read<List<RecipeDef>>("recipes");
        Crops = Read<List<CropDef>>("crops");
        Professions = Read<List<ProfessionDef>>("professions");
        Events = Read<List<EventDef>>("events");
        Difficulty = Read<DifficultyCatalog>("difficulty");
        MapGen = Read<MapGenDef>("mapgen");
        Research = Read<List<ResearchDef>>("research");
        Story = Read<StoryDef>("story");

        // Assemble the bundle once: {"version": ..., "<kind>": <document>, ...}.
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("version", version);
            foreach (var kind in ContentKinds.All)
            {
                writer.WritePropertyName(kind);
                using var doc = JsonDocument.Parse(documents[kind]);
                doc.WriteTo(writer);
            }

            writer.WriteEndObject();
        }

        BundleJson = System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    public string Version { get; }
    public IReadOnlyDictionary<string, string> Documents { get; }
    public string BundleJson { get; }

    public RulesDef Rules { get; }
    public IReadOnlyList<ResourceDef> Resources { get; }
    public IReadOnlyList<FeatureDef> Features { get; }
    public IReadOnlyList<BuildingDef> Buildings { get; }
    public IReadOnlyList<RecipeDef> Recipes { get; }
    public IReadOnlyList<CropDef> Crops { get; }
    public IReadOnlyList<ProfessionDef> Professions { get; }
    public IReadOnlyList<EventDef> Events { get; }
    public DifficultyCatalog Difficulty { get; }
    public MapGenDef MapGen { get; }
    public IReadOnlyList<ResearchDef> Research { get; }
    public StoryDef Story { get; }

    public bool HasPreset(string id) => Difficulty.Presets.Any(p => p.Id == id);
}

public static class ContentKinds
{
    /// <summary>Every content document, in bundle order. Each maps to <c>Content/&lt;kind&gt;.json</c>.</summary>
    public static readonly string[] All = ["rules", "resources", "features", "buildings", "recipes", "crops", "professions", "events", "difficulty", "mapgen", "research", "story"];
}
