namespace SF.Application.Infrastructure.Auth;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = "steamforge";
    public string Audience { get; set; } = "steamforge-client";

    /// <summary>HMAC-SHA256 signing key; at least 32 bytes. Must come from secrets/environment in production.</summary>
    public string SigningKey { get; set; } = string.Empty;

    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 60;
}

public static class AppRoles
{
    public const string Guest = "guest";
    public const string Player = "player";
    public const string Admin = "admin";
}

public static class AppClaims
{
    public const string Role = "role";
}
