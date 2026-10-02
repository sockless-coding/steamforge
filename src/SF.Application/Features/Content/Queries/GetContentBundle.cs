using SF.Application.Infrastructure.Endpoints;

namespace SF.Application.Features.Content;

public sealed class GetContentBundleHandler(ContentCatalog catalog) : IHandler
{
    public string Version => catalog.Current.Version;

    /// <summary>The pre-serialized bundle: every content document keyed by kind, plus the version.</summary>
    public string Handle() => catalog.Current.BundleJson;
}
