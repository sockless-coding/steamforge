using System.Reflection;

namespace SF.Application.Infrastructure.Endpoints;

/// <summary>Implemented once per feature slice to map its HTTP endpoints.</summary>
public interface IEndpointModule
{
    void MapEndpoints(IEndpointRouteBuilder app);
}

/// <summary>Marker for command/query handlers so they are registered automatically (scoped).</summary>
public interface IHandler;

/// <summary>Marker for slice-internal helper services that are registered automatically (scoped).</summary>
public interface ISliceService;

public static class EndpointModuleExtensions
{
    public static IServiceCollection AddFeatureHandlers(this IServiceCollection services, Assembly assembly)
    {
        foreach (var type in assembly.GetTypes().Where(t => t is { IsClass: true, IsAbstract: false } && (typeof(IHandler).IsAssignableFrom(t) || typeof(ISliceService).IsAssignableFrom(t))))
        {
            services.AddScoped(type);
        }

        return services;
    }

    public static IEndpointRouteBuilder MapFeatureEndpoints(this IEndpointRouteBuilder app, Assembly assembly)
    {
        var modules = assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(IEndpointModule).IsAssignableFrom(t))
            .Select(t => (IEndpointModule)Activator.CreateInstance(t)!);

        foreach (var module in modules)
        {
            module.MapEndpoints(app);
        }

        return app;
    }
}
