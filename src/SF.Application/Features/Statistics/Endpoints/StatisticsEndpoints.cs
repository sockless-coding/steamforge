using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;
using SF.Application.Infrastructure.RateLimiting;
using SF.Application.Infrastructure.Validation;

namespace SF.Application.Features.Statistics;

public sealed class StatisticsEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stats").WithTags("Statistics").RequireAuthorization(AuthPolicies.Player);

        group.MapGet("/", async (GetColonyRecordsHandler handler, CancellationToken ct) => TypedResults.Ok(await handler.Handle(ct)));

        group.MapPost("/colony", async (ReportColonyRequest request, ReportColonyHandler handler, CancellationToken ct) =>
                (await handler.Handle(request, ct)).ToHttpResult())
            .Validate<ReportColonyRequest>()
            .RequireRateLimiting(RateLimitPolicies.Mutation);
    }
}
