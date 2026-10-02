using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Audit;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;

namespace SF.Application.Features.Accounts;

/// <summary>Converts the calling guest into a registered account, keeping all progression.</summary>
public sealed class UpgradeGuestAccountHandler(
    AppDbContext db,
    ICurrentUser currentUser,
    AuthSessionIssuer issuer,
    AuditLog audit,
    TimeProvider clock) : IHandler
{
    public async Task<Result<AuthResponse>> Handle(UpgradeGuestRequest request, CancellationToken ct)
    {
        var account = await db.Accounts.SingleOrDefaultAsync(a => a.Id == currentUser.AccountId, ct);
        if (account is null)
        {
            return Error.NotFound("account.not_found", "Account not found.");
        }

        if (account.Kind != AccountKind.Guest)
        {
            return Error.Conflict("account.already_registered", "This account is already registered.");
        }

        var normalized = AuthSessionIssuer.NormalizeEmail(request.Email);
        if (await db.Accounts.AnyAsync(a => a.NormalizedEmail == normalized, ct))
        {
            return Error.Conflict("account.email_taken", "An account with this email already exists.");
        }

        var profile = await db.Profiles.SingleAsync(p => p.AccountId == account.Id, ct);
        var now = clock.GetUtcNow().UtcDateTime;

        account.Kind = AccountKind.Registered;
        account.Email = request.Email.Trim();
        account.NormalizedEmail = normalized;
        account.PasswordHash = AuthSessionIssuer.PasswordHasher.HashPassword(account, request.Password);
        account.LastSeenAt = now;
        if (request.DisplayName is not null)
        {
            profile.DisplayName = request.DisplayName.Trim();
            profile.UpdatedAt = now;
        }

        // Guest refresh tokens carry the guest role; revoke them so only registered-role tokens remain.
        // Tracked (not ExecuteUpdate) so revocation commits atomically with the upgrade.
        var activeTokens = await db.RefreshTokens.Where(t => t.AccountId == account.Id && t.RevokedAt == null).ToListAsync(ct);
        activeTokens.ForEach(t => t.RevokedAt = now);

        var response = issuer.Issue(account, profile);
        audit.Record(AuditCategories.Auth, "guest.upgraded");
        await db.SaveChangesAsync(ct);
        return response;
    }
}
