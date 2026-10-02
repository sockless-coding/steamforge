using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Audit;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;

namespace SF.Application.Features.Accounts;

/// <summary>
/// Rotates a refresh token. Presenting an already-rotated token is treated as theft:
/// the whole token family is revoked and the event is audited as critical.
/// </summary>
public sealed class RefreshSessionHandler(AppDbContext db, AuthSessionIssuer issuer, AuditLog audit, TimeProvider clock) : IHandler
{
    private static readonly Error InvalidToken = Error.Unauthorized("auth.invalid_refresh_token", "The refresh token is invalid or expired.");

    public async Task<Result<AuthResponse>> Handle(RefreshRequest request, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var hash = TokenService.HashRefreshToken(request.RefreshToken);
        var token = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, ct);

        if (token is null)
        {
            return InvalidToken;
        }

        if (token.RevokedAt is not null)
        {
            await db.RefreshTokens
                .Where(t => t.FamilyId == token.FamilyId && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
            audit.Record(AuditCategories.Auth, "refresh.reuse_detected", new { token.FamilyId }, AuditSeverity.Critical, token.AccountId);
            await db.SaveChangesAsync(ct);
            return InvalidToken;
        }

        if (token.ExpiresAt <= now)
        {
            return InvalidToken;
        }

        var account = await db.Accounts.SingleAsync(a => a.Id == token.AccountId, ct);
        if (account.IsBanned)
        {
            return Error.Forbidden("auth.banned", "This account has been suspended.");
        }

        var profile = await db.Profiles.SingleAsync(p => p.AccountId == account.Id, ct);
        var response = issuer.Issue(account, profile, token.FamilyId);

        token.RevokedAt = now;
        token.ReplacedByHash = TokenService.HashRefreshToken(response.RefreshToken);
        account.LastSeenAt = now;

        await db.SaveChangesAsync(ct);
        return response;
    }
}

public sealed class LogoutHandler(AppDbContext db, ICurrentUser currentUser, AuditLog audit, TimeProvider clock) : IHandler
{
    public async Task<Result<Unit>> Handle(LogoutRequest request, CancellationToken ct)
    {
        var hash = TokenService.HashRefreshToken(request.RefreshToken);
        var token = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash && t.AccountId == currentUser.AccountId, ct);
        if (token is not null)
        {
            var now = clock.GetUtcNow().UtcDateTime;
            await db.RefreshTokens
                .Where(t => t.FamilyId == token.FamilyId && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
            audit.Record(AuditCategories.Auth, "logout");
            await db.SaveChangesAsync(ct);
        }

        return Unit.Value;
    }
}
