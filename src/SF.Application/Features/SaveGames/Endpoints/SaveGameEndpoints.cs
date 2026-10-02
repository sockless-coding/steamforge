using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;
using SF.Application.Infrastructure.RateLimiting;
using SF.Application.Infrastructure.Validation;

namespace SF.Application.Features.SaveGames;

public sealed class SaveGameEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/saves").WithTags("SaveGames").RequireAuthorization(AuthPolicies.Player);

        group.MapGet("/", async (ListSaveGamesHandler handler, CancellationToken ct) => TypedResults.Ok(await handler.Handle(ct)));

        group.MapGet("/{slot:int}", async (int slot, GetSaveGameHandler handler, CancellationToken ct) =>
            (await handler.Handle(slot, ct)).ToHttpResult());

        group.MapPut("/{slot:int}", async (int slot, PutSaveGameRequest request, PutSaveGameHandler handler, CancellationToken ct) =>
                (await handler.Handle(slot, request, ct)).ToHttpResult())
            .Validate<PutSaveGameRequest>()
            .RequireRateLimiting(RateLimitPolicies.Mutation);

        group.MapDelete("/{slot:int}", async (int slot, DeleteSaveGameHandler handler, CancellationToken ct) =>
                (await handler.Handle(slot, ct)).ToHttpResult(_ => TypedResults.NoContent()))
            .RequireRateLimiting(RateLimitPolicies.Mutation);
    }
}
