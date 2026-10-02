namespace SF.Application.Features.Accounts;

public sealed record AuthResponse(
    Guid AccountId,
    string DisplayName,
    AccountKind Kind,
    string AccessToken,
    DateTime AccessTokenExpiresAt,
    string RefreshToken,
    DateTime RefreshTokenExpiresAt);

public sealed record CreateGuestRequest(string? DeviceId, string? DisplayName);

public sealed record RegisterRequest(string Email, string Password, string DisplayName);

public sealed record UpgradeGuestRequest(string Email, string Password, string? DisplayName);

public sealed record LoginRequest(string Email, string Password);

public sealed record RefreshRequest(string RefreshToken);

public sealed record LogoutRequest(string RefreshToken);
