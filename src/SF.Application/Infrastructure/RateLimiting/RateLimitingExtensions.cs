using System.Threading.RateLimiting;
using Microsoft.IdentityModel.JsonWebTokens;

namespace SF.Application.Infrastructure.RateLimiting;

public static class RateLimitPolicies
{
    /// <summary>Login, register, refresh: strict per-IP fixed window to slow credential stuffing.</summary>
    public const string Auth = "auth";

    /// <summary>State-changing calls (profile, settings, saves).</summary>
    public const string Mutation = "mutation";
}

public sealed class RateLimitOptions
{
    public const string SectionName = "RateLimits";

    public int GlobalTokenLimit { get; set; } = 200;
    public int AuthPerMinute { get; set; } = 20;
    public int MutationPerMinute { get; set; } = 60;
}

public static class RateLimitingExtensions
{
    public static IServiceCollection AddAppRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var limits = configuration.GetSection(RateLimitOptions.SectionName).Get<RateLimitOptions>() ?? new RateLimitOptions();

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, _) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString();
                }

                await TypedResults.Problem(statusCode: StatusCodes.Status429TooManyRequests, title: "Too many requests")
                    .ExecuteAsync(context.HttpContext);
            };

            // Global safety net: every request is bucketed per account, or per IP when anonymous.
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                RateLimitPartition.GetTokenBucketLimiter(PartitionKey(context), _ => new TokenBucketRateLimiterOptions
                {
                    TokenLimit = limits.GlobalTokenLimit,
                    TokensPerPeriod = Math.Max(1, limits.GlobalTokenLimit / 2),
                    ReplenishmentPeriod = TimeSpan.FromSeconds(30),
                    QueueLimit = 0,
                }));

            options.AddPolicy(RateLimitPolicies.Auth, context =>
                RateLimitPartition.GetFixedWindowLimiter(IpKey(context), _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = limits.AuthPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                }));

            options.AddPolicy(RateLimitPolicies.Mutation, context =>
                RateLimitPartition.GetSlidingWindowLimiter(PartitionKey(context), _ => new SlidingWindowRateLimiterOptions
                {
                    PermitLimit = limits.MutationPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                    SegmentsPerWindow = 6,
                    QueueLimit = 0,
                }));
        });

        return services;
    }

    private static string PartitionKey(HttpContext context) =>
        context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value is { } sub ? $"acct:{sub}" : IpKey(context);

    private static string IpKey(HttpContext context) =>
        $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
}
