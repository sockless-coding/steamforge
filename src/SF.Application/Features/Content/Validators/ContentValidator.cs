using System.Text.Json;

namespace SF.Application.Features.Content;

/// <summary>
/// Cross-reference and invariant checks over a whole content snapshot. Startup fails if any check fails, so a bad
/// content pack can never reach players. Keep the known component and event kinds in sync with the client registries
/// (game/sim/components and game/sim/events.ts).
/// </summary>
public static class ContentValidator
{
    public static readonly HashSet<string> ComponentKinds =
        ["storage", "housing", "shelter", "workplace", "firefighting", "gatherer", "producer", "field", "generator", "consumer", "research",
         "amenity", "lighting", "airship", "assembler", "tramDepot", "pneumatic", "valve", "emitter", "scrubber", "clinic",
         "booster", "tractor"];

    /// <summary>Components that are worked by a building's staff; they need a workplace component.</summary>
    public static readonly HashSet<string> StaffedComponents = ["gatherer", "producer", "field", "research", "assembler"];

    public static readonly HashSet<string> EventKinds = ["fire", "blight", "sickness", "coldSnap", "nomads", "bounty", "pipeBurst", "supplies", "blackLung", "rain"];
    public static readonly HashSet<string> Categories = ["material", "fuel", "food", "goods"];
    public static readonly HashSet<string> Terrains = ["grass", "water", "mountain", "stone", "iron", "coal", "sand", "copper"];
    public static readonly HashSet<string> Shapes = ["box", "cylinder", "cone", "sphere", "gable", "hip", "gear", "chimney", "stack", "tank", "pipe", "torus", "dome"];
    public static readonly HashSet<string> Emitters = ["smoke", "steam"];
    public static readonly HashSet<string> ConduitStyles = ["duct", "main", "lagged", "water", "wire"];
    public static readonly HashSet<string> NatureModels = ["tree", "rock", "ironstone", "bush", "mushroom"];
    public static readonly HashSet<string> Modifiers = ["winterSeverity", "disasterRate", "productionMultiplier", "birthRate", "spoilageRate", "wearRate", "hungerRate", "sootRate"];
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
        Unique("network", c.Rules.Networks, n => n.Id);
        Unique("research", c.Research, t => t.Id);
        Unique("dispatch", c.Story.Dispatches, d => d.Id);

        var resources = c.Resources.ToDictionary(r => r.Id);
        var features = c.Features.Select(f => f.Id).ToHashSet();
        var recipes = c.Recipes.Select(r => r.Id).ToHashSet();
        var crops = c.Crops.Select(x => x.Id).ToHashSet();
        var professions = c.Professions.Select(p => p.Id).ToHashSet();
        var seasons = c.Rules.Seasons.Select(s => s.Id).ToHashSet();
        var buildings = c.Buildings.Select(b => b.Id).ToHashSet();
        var networks = c.Rules.Networks.Select(n => n.Id).ToHashSet();
        var roads = c.Rules.Roads.Select(x => x.Id).ToHashSet();
        var techs = c.Research.Select(t => t.Id).ToHashSet();
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
        Check(r.Day is not null, "Rules: day settings are required.");
        if (r.Day is { } day)
        {
            Check(day.DaysPerMonth >= 1, "Rules: day.daysPerMonth must be at least 1.");
            Check(day.Daylight.Count == r.Months.Count, "Rules: there must be one day.daylight value per month.");
            Check(day.Daylight.All(d => d is > 0.05 and < 0.95), "Rules: day.daylight values must be between 0.05 and 0.95.");
            Check(day.NightWorkFactor is > 0 and <= 1, "Rules: day.nightWorkFactor must be in (0, 1].");
        }

        var covered = r.Seasons.SelectMany(s => s.Months).OrderBy(m => m).ToList();
        Check(covered.SequenceEqual(Enumerable.Range(0, r.Months.Count)), "Rules: seasons must cover every month exactly once.");
        Check(r.Roads.Count > 0, "Rules: at least one road type is required.");
        foreach (var road in r.Roads)
        {
            CheckStock($"Road {road.Id}", road.Cost.Keys);
            Check(road.Speed >= 1 && road.Work > 0, $"Road {road.Id} needs speed >= 1 and positive work.");
        }

        Check(r.Networks.Count is >= 1 and <= 8, "Rules: 1-8 energy networks are supported.");
        var conduitGrades = r.Networks.SelectMany(n => new[] { n.Conduit }.Concat(n.Upgrades ?? [])).ToList();
        Unique("conduit grade", conduitGrades, g => g.Id);
        foreach (var net in r.Networks)
        {
            foreach (var grade in new[] { net.Conduit }.Concat(net.Upgrades ?? []))
            {
                var where = $"Network {net.Id} conduit {grade.Id}";
                CheckStock(where, grade.Cost.Keys);
                Check(grade.Work > 0, $"{where} needs positive work.");
                Check(grade.LossPerTile is >= 0 and < 1, $"{where}: lossPerTile must be in [0, 1).");
                Check(ConduitStyles.Contains(grade.Style), $"{where} has unknown style '{grade.Style}'.");
            }

            Check((net.Upgrades?.Count ?? 0) < 255, $"Network {net.Id} has too many conduit grades.");
        }

        var conduits = conduitGrades.Select(g => g.Id).ToHashSet();

        Check(r.Wind is not null, "Rules: wind settings are required.");
        if (r.Wind is { } wind)
        {
            Check(r.Seasons.All(s => wind.Prevailing.ContainsKey(s.Id)) && wind.Prevailing.Keys.All(seasons.Contains),
                "Rules: wind.prevailing needs exactly one direction per season.");
            Check(wind.Variance is >= 0 and <= 180, "Rules: wind.variance must be 0-180 degrees.");
            Check(wind.Speed.Count == 2 && wind.Speed[0] >= 0 && wind.Speed[1] >= wind.Speed[0] && wind.Speed[1] <= 4,
                "Rules: wind.speed must be [min, max] tiles per second, at most 4.");
        }

        Check(r.Soot is not null, "Rules: soot settings are required.");
        if (r.Soot is { } soot)
        {
            Check(soot.CellSize is >= 1 and <= 16, "Rules: soot.cellSize must be 1-16 tiles.");
            Check(soot.Diffusion is >= 0 and <= 0.2, "Rules: soot.diffusion must be 0-0.2 (higher is unstable).");
            Check(new[] { soot.DecayPerSecond, soot.ForestDecayPerSecond, soot.DepositPerSecond, soot.GrimeFadePerMonth }.All(v => v is >= 0 and < 1),
                "Rules: soot decay, deposit and fade rates must be in [0, 1).");
            Check(soot.WinterDecayFactor > 0, "Rules: soot.winterDecayFactor must be positive.");
            Check(soot.FullSoot > 0 && soot.FullGrime > 0, "Rules: soot.fullSoot and soot.fullGrime must be positive.");
            Check(soot.LungSafe is >= 0 and < 1, "Rules: soot.lungSafe must be in [0, 1).");
            Check(soot.CropPenalty is >= 0 and <= 1, "Rules: soot.cropPenalty must be 0-1.");
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
                Check(part.Emit is null || Emitters.Contains(part.Emit), $"{where} model part emits unknown particles '{part.Emit}'.");
            }

            foreach (var (kind, cfg) in b.Components)
            {
                Check(ComponentKinds.Contains(kind), $"{where} has unknown component '{kind}'.");
                ValidateComponent(where, kind, cfg);
            }

            // A converter (a generator that also consumes) draws on a network solved before the one it feeds.
            if (b.Components.TryGetValue("generator", out var gen) && b.Components.TryGetValue("consumer", out var con)
                && gen.TryGetProperty("network", out var genNet) && con.TryGetProperty("uses", out var uses) && uses.ValueKind == JsonValueKind.Object)
            {
                var output = r.Networks.ToList().FindIndex(n => n.Id == genNet.GetString());
                foreach (var input in uses.EnumerateObject())
                {
                    var index = r.Networks.ToList().FindIndex(n => n.Id == input.Name);
                    Check(index < 0 || output < 0 || index < output, $"{where}: a converter's input network '{input.Name}' must come before its output network in rules.networks.");
                }
            }

            var workplace = b.Components.ContainsKey("workplace");
            var staffed = b.Components.Keys.Any(StaffedComponents.Contains);
            Check(!staffed || workplace, $"{where}: gatherer/producer/field/research/assembler components need a workplace component.");
            Check(!workplace || staffed || b.Components.ContainsKey("generator"), $"{where}: a workplace needs something to work (gatherer, producer, field, research or generator).");
        }

        var headquarters = c.Buildings.Where(b => b.Headquarters == true).ToList();
        Check(headquarters.Count == 1, "Exactly one building must be the headquarters (headquarters: true).");
        Check(headquarters.All(h => h.Components.ContainsKey("storage") && h.Components.ContainsKey("shelter") && h.Buildable == false),
            "The headquarters needs storage and shelter components and must not be buildable.");

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

                    if (cfg.TryGetProperty("sootPenalty", out var sootPenalty))
                    {
                        Check(sootPenalty.GetDouble() is >= 0 and <= 1, $"{where} gatherer sootPenalty must be 0-1.");
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
                case "generator":
                    Check(networks.Contains(Str("network") ?? string.Empty), $"{where} generator feeds an unknown network.");
                    Check(cfg.TryGetProperty("output", out var output) && output.GetDouble() > 0, $"{where} generator needs a positive output.");
                    CheckStock($"{where} generator fuel", Keys("fuel"));
                    break;
                case "consumer":
                    Check(Keys("uses").Any(), $"{where} consumer must use at least one network.");
                    foreach (var net in Keys("uses"))
                    {
                        Check(networks.Contains(net), $"{where} consumes unknown network '{net}'.");
                    }

                    break;
                case "booster":
                    Check(networks.Contains(Str("network") ?? string.Empty), $"{where} booster drives an unknown network.");
                    Check(cfg.TryGetProperty("head", out var head) && head.GetDouble() is > 0 and <= 1, $"{where} booster head must be in (0, 1].");
                    break;
                case "tractor":
                    Check(cfg.TryGetProperty("radius", out var tr) && tr.GetDouble() > 0, $"{where} tractor needs a positive radius.");
                    Check(cfg.TryGetProperty("bonus", out var bonus) && bonus.GetDouble() > 0, $"{where} tractor needs a positive bonus.");
                    break;
                case "assembler":
                    Check(Keys("inputs").Any(), $"{where} assembler needs inputs.");
                    CheckStock($"{where} assembler", Keys("inputs"));
                    break;
                case "pneumatic":
                    Check(networks.Contains(Str("network") ?? string.Empty), $"{where} pneumatic tubes use an unknown network.");
                    break;
                case "amenity":
                    Check(cfg.TryGetProperty("radius", out var ar) && ar.GetDouble() > 0, $"{where} amenity needs a positive radius.");
                    break;
                case "lighting":
                    Check(cfg.TryGetProperty("radius", out var lr) && lr.GetDouble() > 0, $"{where} lighting needs a positive radius.");
                    break;
                case "emitter":
                    Check(cfg.TryGetProperty("soot", out var emitted) && emitted.GetDouble() >= 0, $"{where} emitter needs a soot rate of 0 or more.");
                    Check(!cfg.TryGetProperty("stack", out var stack) || stack.GetDouble() is >= 0 and <= 20, $"{where} emitter stack must be 0-20 tiles.");
                    break;
                case "scrubber":
                    Check(cfg.TryGetProperty("radius", out var sr) && sr.GetDouble() > 0, $"{where} scrubber needs a positive radius.");
                    Check(cfg.TryGetProperty("rate", out var rate) && rate.GetDouble() is > 0 and <= 1, $"{where} scrubber rate must be in (0, 1].");
                    break;
                case "clinic":
                    Check(cfg.TryGetProperty("radius", out var cr) && cr.GetDouble() > 0, $"{where} clinic needs a positive radius.");
                    Check(cfg.TryGetProperty("protection", out var protection) && protection.GetDouble() is > 0 and <= 1, $"{where} clinic protection must be in (0, 1].");
                    Check(Res(Str("resource") ?? string.Empty), $"{where} clinic hands out an unknown resource.");
                    Check(cfg.TryGetProperty("perHome", out var perHome) && perHome.GetDouble() > 0, $"{where} clinic needs a positive perHome.");
                    break;
                case "research":
                    Check(cfg.TryGetProperty("points", out var points) && points.GetDouble() > 0, $"{where} research needs positive points.");
                    Check(cfg.TryGetProperty("seconds", out var seconds) && seconds.GetDouble() > 0, $"{where} research needs positive seconds.");
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
            if (e.Kind == "supplies")
            {
                CheckStock($"Event {e.Id}", e.Params?.Keys.AsEnumerable() ?? []);
            }

            if (e.Kind == "pipeBurst" && e.Params?.TryGetValue("network", out var burst) == true)
            {
                Check(networks.Contains(burst.GetString() ?? string.Empty), $"Event {e.Id} bursts an unknown network.");
            }
        }

        // Research: a tree of techs, each unlocking content. Anything no tech unlocks is available from the start.
        var unlockedBy = new Dictionary<string, string>();
        void Unlock(string tech, string kind, IReadOnlyList<string>? ids, HashSet<string> known)
        {
            foreach (var id in ids ?? [])
            {
                Check(known.Contains(id), $"Research {tech} unlocks unknown {kind} '{id}'.");
                Check(unlockedBy.TryAdd($"{kind}:{id}", tech), $"Research {tech} unlocks {kind} '{id}', which another research already unlocks.");
            }
        }

        foreach (var t in c.Research)
        {
            Check(t.Points > 0, $"Research {t.Id} needs positive points.");
            Check(t.Tier >= 0, $"Research {t.Id} needs a tier of 0 or more.");
            foreach (var req in t.Requires)
            {
                Check(techs.Contains(req), $"Research {t.Id} requires unknown research '{req}'.");
            }

            Unlock(t.Id, "building", t.Unlocks.Buildings, buildings);
            Unlock(t.Id, "road", t.Unlocks.Roads, roads);
            Unlock(t.Id, "network", t.Unlocks.Networks, networks);
            Unlock(t.Id, "conduit", t.Unlocks.Conduits, conduits);
            Unlock(t.Id, "recipe", t.Unlocks.Recipes, recipes);
        }

        foreach (var h in headquarters)
        {
            Check(!unlockedBy.ContainsKey($"building:{h.Id}"), "The headquarters cannot be locked behind research.");
        }

        var techById = c.Research.GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());
        var visit = new Dictionary<string, int>();
        bool Acyclic(string id)
        {
            if (visit.TryGetValue(id, out var mark))
            {
                return mark == 2;
            }

            visit[id] = 1;
            var ok = !techById.TryGetValue(id, out var t) || t.Requires.All(Acyclic);
            visit[id] = 2;
            return ok;
        }

        foreach (var t in c.Research)
        {
            Check(Acyclic(t.Id), $"Research {t.Id} is part of a requirement cycle.");
        }

        // Story
        Check(c.Story.Intro.Paragraphs.Count > 0, "Story: the intro needs at least one paragraph.");
        foreach (var d in c.Story.Dispatches)
        {
            var w = d.When;
            var triggers = new object?[] { w.Research, w.Building, w.Year, w.Population }.Count(x => x is not null);
            Check(triggers == 1, $"Dispatch {d.Id} needs exactly one trigger.");
            Check(w.Research is null || techs.Contains(w.Research), $"Dispatch {d.Id} waits for unknown research '{w.Research}'.");
            Check(w.Building is null || buildings.Contains(w.Building), $"Dispatch {d.Id} waits for unknown building '{w.Building}'.");
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

            foreach (var tech in p.StartingResearch ?? [])
            {
                Check(techs.Contains(tech), $"{where} starts with unknown research '{tech}'.");
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
