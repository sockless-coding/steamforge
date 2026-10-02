using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;
using SF.Application.Infrastructure.RateLimiting;
using SF.Application.Infrastructure.Validation;

namespace SF.Application.Features.Accounts;

public sealed class AccountEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth").RequireRateLimiting(RateLimitPolicies.Auth);

        group.MapPost("/guest", async (CreateGuestRequest request, CreateGuestAccountHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult())
            .Validate<CreateGuestRequest>()
            .AllowAnonymous();

        group.MapPost("/register", async (RegisterRequest request, RegisterAccountHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult())
            .Validate<RegisterRequest>()
            .AllowAnonymous();

        group.MapPost("/upgrade", async (UpgradeGuestRequest request, UpgradeGuestAccountHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult())
            .Validate<UpgradeGuestRequest>()
            .RequireAuthorization(AuthPolicies.Player);

        group.MapPost("/login", async (LoginRequest request, LoginHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult())
            .Validate<LoginRequest>()
            .AllowAnonymous();

        group.MapPost("/refresh", async (RefreshRequest request, RefreshSessionHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult())
            .Validate<RefreshRequest>()
            .AllowAnonymous();

        group.MapPost("/logout", async (LogoutRequest request, LogoutHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult(_ => TypedResults.NoContent()))
            .Validate<LogoutRequest>()
            .RequireAuthorization(AuthPolicies.Player);
    }
}
