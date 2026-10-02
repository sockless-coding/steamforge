using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace SF.Application.Infrastructure.Auth;

public static class AuthExtensions
{
    public static IServiceCollection AddAppAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
        if (System.Text.Encoding.UTF8.GetByteCount(options.SigningKey) < 32)
        {
            throw new InvalidOperationException("Jwt:SigningKey must be configured and at least 32 bytes long.");
        }

        services.AddSingleton(options);
        services.AddSingleton<TokenService>();
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpCurrentUser>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(jwt =>
            {
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenService(options, TimeProvider.System).ValidationParameters();
            });

        services.AddAuthorizationBuilder()
            .AddPolicy(AuthPolicies.Player, p => p.RequireAuthenticatedUser())
            .AddPolicy(AuthPolicies.Registered, p => p.RequireRole(AppRoles.Player, AppRoles.Admin))
            .AddPolicy(AuthPolicies.Admin, p => p.RequireRole(AppRoles.Admin));

        return services;
    }
}

public static class AuthPolicies
{
    /// <summary>Any authenticated account, guest or registered.</summary>
    public const string Player = "player";

    /// <summary>Registered (non-guest) accounts only.</summary>
    public const string Registered = "registered";

    public const string Admin = "admin";
}
