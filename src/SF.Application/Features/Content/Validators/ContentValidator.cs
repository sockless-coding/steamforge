using System.Text.Json;

namespace SF.Application.Features.Content;

/// <summary>
/// Cross-reference and invariant checks over a whole content snapshot. Startup fails if any check fails, so a bad
/// content pack can never reach players. Keep the known component and event kinds in sync with the client registries
/// (game/sim/components and game/sim/events.ts).
/// </summary>
public static class ContentValidator
{
    public static readonly HashSet<string> ComponentKinds = ["storage", "housing", "shelter", "workplace", "firefighting", "gatherer", "producer", "field", "boiler"];
    public static readonly HashSet<string> EventKinds = ["fire", "blight", "sickness", "coldSnap", "nomads", "bounty"];
    public static readonly HashSet<string> Categories = ["material", "fuel", "food", "goods"];
    public static readonly HashSet<string> Terrains = ["grass", "water", "mountain", "stone", "iron", "coal", "sand"];
    public static readonly HashSet<string> Shapes = ["box", "cylinder", "cone", "sphere", "gable", "hip", "gear", "chimney"];
    public static readonly HashSet<string> NatureModels = ["tree", "rock", "ironstone", "bush", "mushroom"];
    public static readonly HashSet<string> Modifiers = ["winterSeverity", "disasterRate", "productionMultiplier", "birthRate", "spoilageRate", "wearRate", "hungerRate"];
    public static readonly HashSet<string> RequiredProfessions = ["child", "laborer", "builder"];

    public static IReadOnlyList<string> Validate(ContentSnapshot c)
    {
        var errors = new List<string>();
        void Check(bool condition, string message)
        {
            if (!condition)
            {
                errors.Add(message);
            }
        }

        void Unique<T>(string kind, IEnumerable<T> items, Func<T, string> id)
        {
            foreach (var dup in items.GroupBy(id).Where(g => g.Count() > 1))
            {
                errors.Add($"Duplicate {kind} id '{dup.Key}'.");
            }
        }

        Unique("resource", c.Resources, r => r.Id);
        Unique("feature", c.Features, f => f.Id);
        Unique("building", c.Buildings, b => b.Id);
        Unique("recipe", c.Recipes, r => r.Id);
        Unique("crop", c.Crops, x => x.Id);
        Unique("profession", c.Professions, p => p.Id);
        Unique("event", c.Events, e => e.Id);
        Unique("difficulty preset", c.Difficulty.Presets, p => p.Id);

        var resources = c.Resources.ToDictionary(r => r.Id);
        var features = c.Features.Select(f => f.Id).ToHashSet();
        var recipes = c.Recipes.Select(r => r.Id).ToHashSet();
        var crops = c.Crops.Select(x => x.Id).ToHashSet();
        var professions = c.Professions.Select(p => p.Id).ToHashSet();
        var seasons = c.Rules.Seasons.Select(s => s.Id).ToHashSet();
        var buildings = c.Buildings.Select(b => b.Id).ToHashSet();
        bool Res(string id) => resources.ContainsKey(id);
        void CheckStock(string owner, IEnumerable<string> keys)
        {
            foreach (var key in keys)
            {
                Check(Res(key), $"{owner} references unknown resource '{key}'.");
            }
        }

        // Rules
        var r = c.Rules;
        Check(r.TicksPerSecond is >= 1 and <= 60, "Rules: ticksPerSecond must be 1-60.");
        Check(r.SecondsPerMonth > 0, "Rules: secondsPerMonth must be positive.");
        Check(r.Months.Count == r.Temperature.Count, "Rules: there must be one temperature per month.");
        var covered = r.Seasons.SelectMany(s => s.Months).OrderBy(m => m).ToList();
        Check(covered.SequenceEqual(Enumerable.Range(0, r.Months.Count)), "Rules: seasons must cover every month exactly once.");
        Check(r.Roads.Count > 0, "Rules: at least one road type is required.");
        foreach (var road in r.Roads)
        {
            CheckStock($"Road {road.Id}", road.Cost.Keys);
            Check(road.Speed >= 1 && road.Work > 0, $"Road {road.Id} needs speed >= 1 and positive work.");
        }

        foreach (var p in RequiredProfessions)
        {
            Check(professions.Contains(p), $"Profession '{p}' is required.");
        }

        // Resources and features
        foreach (var res in c.Resources)
        {
            Check(Categories.Contains(res.Category), $"Resource {res.Id} has unknown category '{res.Category}'.");
            Check(res.SpoilagePerYear is >= 0 and <= 1, $"Resource {res.Id} spoilage must be 0-1.");
        }

        Check(c.Resources.Any(x => x.Category == "food"), "At least one food resource is required.");
        Check(Res("firewood") && Res("tools") && Res("coats"), "Resources 'firewood', 'tools' and 'coats' are required by the simulation.");

        foreach (var f in c.Features)
        {
            Check(NatureModels.Contains(f.Model), $"Feature {f.Id} has unknown model '{f.Model}'.");
            Check(Res(f.Clear.Resource) && f.Clear.Amount > 0 && f.Clear.Seconds > 0, $"Feature {f.Id} has an invalid clear yield.");
            if (f.Harvest is { } h)
            {
                Check(Res(h.Resource) && h.Amount > 0 && h.Seconds > 0, $"Feature {f.Id} has an invalid harvest yield.");
                Check(h.Ripens is { Count: > 0 } && h.Ripens.All(seasons.Contains), $"Feature {f.Id} ripens in an unknown season.");
            }
        }

        Check(features.Contains("tree"), "Feature 'tree' is required (map generation and foresters).");
        Check(c.Features.Count < 255, "At most 254 feature kinds are supported.");

        // Buildings
        foreach (var b in c.Buildings)
        {
            var where = $"Building {b.Id}";
            Check(b.Size.Count == 2 && b.Size.All(s => s is >= 1 and <= 16), $"{where} has an invalid size.");
            Check(b.Cost.Work > 0, $"{where} must take some work to build.");
            CheckStock(where, b.Cost.Resources.Keys);
            if (b.Placement?.Terrain is { } terrain)
            {
                Check(Terrains.Contains(terrain.Id), $"{where} requires unknown terrain '{terrain.Id}'.");
            }

            if (b.Placement?.Adjacent is { } adjacent)
            {
                Check(Terrains.Contains(adjacent.Id), $"{where} requires unknown adjacent terrain '{adjacent.Id}'.");
            }

            foreach (var part in b.Model.Parts)
            {
                Check(Shapes.Contains(part.Shape), $"{where} model uses unknown shape '{part.Shape}'.");
                Check(part.Pos.Count == 3 && part.Size.Count == 3, $"{where} model part needs 3D pos and size.");
            }

            foreach (var (kind, cfg) in b.Components)
            {
                Check(ComponentKinds.Contains(kind), $"{where} has unknown component '{kind}'.");
                ValidateComponent(where, kind, cfg);
            }

            var workplace = b.Components.ContainsKey("workplace");
            var worked = b.Components.Keys.Any(k => k is "gatherer" or "producer" or "field" or "boiler");
            Check(workplace == worked, $"{where}: gatherer/producer/field/boiler components need a workplace component and vice versa.");
        }

        Check(c.Buildings.FirstOrDefault(b => b.Id == "guildhall") is { } hall && hall.Components.ContainsKey("storage") && hall.Components.ContainsKey("shelter"),
            "A 'guildhall' building with storage and shelter components is required.");

        void ValidateComponent(string where, string kind, JsonElement cfg)
        {
            string? Str(string name) => cfg.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            IEnumerable<string> Strings(string name) => cfg.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
                ? v.EnumerateArray().Select(x => x.GetString() ?? string.Empty)
                : [];
            IEnumerable<string> Keys(string name) => cfg.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object
                ? v.EnumerateObject().Select(p => p.Name)
                : [];

            switch (kind)
            {
                case "workplace":
                    Check(professions.Contains(Str("profession") ?? string.Empty), $"{where} workplace has an unknown profession.");
                    break;
                case "storage":
                    Check(Strings("accepts").Any() && Strings("accepts").All(Categories.Contains), $"{where} storage accepts an unknown category.");
                    break;
                case "gatherer":
                    var featureList = Strings("features").ToList();
                    var yields = Keys("yield").ToList();
                    Check(featureList.Count > 0 ^ yields.Count > 0, $"{where} gatherer needs either features or a yield.");
                    foreach (var f in featureList)
                    {
                        Check(features.Contains(f), $"{where} gathers unknown feature '{f}'.");
                    }

                    CheckStock(where, yields);
                    if (cfg.TryGetProperty("scale", out var scale))
                    {
                        var by = scale.GetProperty("by").GetString();
                        var id = scale.GetProperty("id").GetString() ?? string.Empty;
                        Check(by == "feature" ? features.Contains(id) : by == "terrain" && Terrains.Contains(id), $"{where} gatherer scales by unknown {by} '{id}'.");
                    }

                    if (cfg.TryGetProperty("replant", out var replant))
                    {
                        Check(features.Contains(replant.GetProperty("feature").GetString() ?? string.Empty), $"{where} replants an unknown feature.");
                    }

                    break;
                case "producer":
                    Check(Strings("recipes").Any() && Strings("recipes").All(recipes.Contains), $"{where} uses an unknown recipe.");
                    break;
                case "field":
                    Check(Strings("crops").Any() && Strings("crops").All(crops.Contains), $"{where} grows an unknown crop.");
                    break;
                case "boiler":
                    Check(Res(Str("fuel") ?? string.Empty), $"{where} boiler burns an unknown fuel.");
                    break;
            }
        }

        // Recipes and crops
        foreach (var recipe in c.Recipes)
        {
            CheckStock($"Recipe {recipe.Id}", recipe.Inputs.Keys.Concat(recipe.Outputs.Keys));
            Check(recipe.Seconds > 0 && recipe.Outputs.Count > 0, $"Recipe {recipe.Id} needs outputs and positive time.");
        }

        foreach (var crop in c.Crops)
        {
            Check(resources.TryGetValue(crop.Resource, out var res) && res.Category == "food", $"Crop {crop.Id} must yield a food resource.");
            Check(crop.GrowthMonths > 0 && crop.YieldPerTile > 0, $"Crop {crop.Id} needs positive growth and yield.");
        }

        // Events
        foreach (var e in c.Events)
        {
            Check(EventKinds.Contains(e.Kind), $"Event {e.Id} has unknown kind '{e.Kind}'.");
            Check(e.Weight >= 0, $"Event {e.Id} has a negative weight.");
            Check(e.Seasons is null || e.Seasons.All(seasons.Contains), $"Event {e.Id} references an unknown season.");
        }

        // Difficulty
        Check(c.HasPreset(c.Difficulty.DefaultPreset), "Difficulty default preset does not exist.");
        foreach (var p in c.Difficulty.Presets)
        {
            var where = $"Difficulty {p.Id}";
            Check(p.StartingFamilies is >= 1 and <= 50, $"{where} needs 1-50 starting families.");
            CheckStock(where, p.StartingResources.Keys);
            foreach (var sb in p.StartingBuildings)
            {
                Check(buildings.Contains(sb.Id) && sb.Count >= 0, $"{where} starts with unknown building '{sb.Id}'.");
            }

            foreach (var m in Modifiers)
            {
                Check(p.Modifiers.TryGetValue(m, out var v) && v > 0, $"{where} needs a positive '{m}' modifier.");
            }
        }

        // Map generation
        Check(c.MapGen.Sizes.Any(s => s.Id == c.MapGen.DefaultSize), "Map default size does not exist.");
        Check(c.MapGen.Terrains.Any(t => t.Id == c.MapGen.DefaultTerrain), "Map default terrain does not exist.");
        foreach (var s in c.MapGen.Sizes)
        {
            Check(s.Size is >= 64 and <= 256, $"Map size {s.Id} must be 64-256 tiles.");
        }

        return errors;
    }
}
