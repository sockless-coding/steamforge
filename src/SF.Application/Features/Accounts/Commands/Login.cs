using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Audit;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;

namespace SF.Application.Features.Accounts;

public sealed class LoginHandler(AppDbContext db, AuthSessionIssuer issuer, AuditLog audit, TimeProvider clock) : IHandler
{
    public const int MaxFailedAttempts = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private static readonly Error InvalidCredentials = Error.Unauthorized("auth.invalid_credentials", "Invalid email or password.");

    public async Task<Result<AuthResponse>> Handle(LoginRequest request, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var normalized = AuthSessionIssuer.NormalizeEmail(request.Email);
        var account = await db.Accounts.SingleOrDefaultAsync(a => a.NormalizedEmail == normalized, ct);

        if (account?.PasswordHash is null)
        {
            // Hash anyway so response timing does not reveal whether the email exists.
            AuthSessionIssuer.PasswordHasher.HashPassword(new Account(), request.Password);
            return InvalidCredentials;
        }

        if (account.LockoutUntil > now)
        {
            audit.Record(AuditCategories.Auth, "login.locked_out", severity: AuditSeverity.Warning, accountId: account.Id);
            await db.SaveChangesAsync(ct);
            return Error.Unauthorized("auth.locked_out", "Too many failed attempts. Try again later.");
        }

        var verification = AuthSessionIssuer.PasswordHasher.VerifyHashedPassword(account, account.PasswordHash, request.Password);
        if (verification == PasswordVerificationResult.Failed)
        {
            account.FailedLoginCount++;
            if (account.FailedLoginCount >= MaxFailedAttempts)
            {
                account.LockoutUntil = now + LockoutDuration;
                account.FailedLoginCount = 0;
            }

            audit.Record(AuditCategories.Auth, "login.failed", severity: AuditSeverity.Warning, accountId: account.Id);
            await db.SaveChangesAsync(ct);
            return InvalidCredentials;
        }

        if (account.IsBanned)
        {
            return Error.Forbidden("auth.banned", "This account has been suspended.");
        }

        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
        {
            account.PasswordHash = AuthSessionIssuer.PasswordHasher.HashPassword(account, request.Password);
        }

        account.FailedLoginCount = 0;
        account.LockoutUntil = null;
        account.LastSeenAt = now;

        var profile = await db.Profiles.SingleAsync(p => p.AccountId == account.Id, ct);
        var response = issuer.Issue(account, profile);
        audit.Record(AuditCategories.Auth, "login.succeeded", accountId: account.Id);
        await db.SaveChangesAsync(ct);
        return response;
    }
}
