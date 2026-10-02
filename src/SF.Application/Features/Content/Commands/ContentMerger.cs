using System.Text.Json.Nodes;

namespace SF.Application.Features.Content;

/// <summary>
/// Merges a content pack document onto a base document. Objects merge recursively; arrays whose items all carry an
/// "id" merge by id (matching items are merged, new ones appended, and an item with <c>"remove": true</c> deletes
/// its match); any other value is replaced. This lets a pack add a building or tweak one preset without copying
/// whole files.
/// </summary>
public static class ContentMerger
{
    public static JsonNode? Merge(JsonNode? target, JsonNode? overlay)
    {
        if (overlay is null)
        {
            return target?.DeepClone();
        }

        if (target is JsonObject t && overlay is JsonObject o)
        {
            var result = (JsonObject)t.DeepClone();
            foreach (var (key, value) in o)
            {
                result[key] = Merge(result[key], value);
            }

            return result;
        }

        if (target is JsonArray ta && overlay is JsonArray oa && IsIdArray(ta) && IsIdArray(oa))
        {
            var result = (JsonArray)ta.DeepClone();
            foreach (var item in oa)
            {
                var id = Id(item);
                var index = result.Select((n, i) => (n, i)).FirstOrDefault(x => Id(x.n) == id, (null!, -1)).i;
                var remove = item is JsonObject io && io["remove"]?.GetValue<bool>() == true;
                if (index >= 0 && remove)
                {
                    result.RemoveAt(index);
                }
                else if (index >= 0)
                {
                    result[index] = Merge(result[index], item);
                }
                else if (!remove)
                {
                    result.Add(item?.DeepClone());
                }
            }

            return result;
        }

        return overlay.DeepClone();
    }

    private static bool IsIdArray(JsonArray array) => array.All(n => n is JsonObject o && o["id"] is JsonValue);

    private static string? Id(JsonNode? node) => (node as JsonObject)?["id"]?.GetValue<string>();
}
