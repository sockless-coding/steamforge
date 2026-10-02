using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;
using SF.Application.Infrastructure.RateLimiting;
using SF.Application.Infrastructure.Validation;

namespace SF.Application.Features.Profiles;

public sealed class ProfileEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/profile").WithTags("Profile").RequireAuthorization(AuthPolicies.Player);

        group.MapGet("/", async (GetMyProfileHandler handler, CancellationToken ct) =>
            (await handler.Handle(ct)).ToHttpResult());

        group.MapPut("/", async (UpdateProfileRequest request, UpdateProfileHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult())
            .Validate<UpdateProfileRequest>()
            .RequireRateLimiting(RateLimitPolicies.Mutation);

        group.MapPut("/settings", async (UpdateSettingsRequest request, UpdateSettingsHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult(_ => TypedResults.NoContent()))
            .Validate<UpdateSettingsRequest>()
            .RequireRateLimiting(RateLimitPolicies.Mutation);
    }
}
