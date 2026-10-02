using Microsoft.EntityFrameworkCore;
using SF.Application.Features.Profiles;
using SF.Application.Infrastructure.Audit;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;
using SF.Application.Infrastructure.Telemetry;

namespace SF.Application.Features.Accounts;

public sealed class RegisterAccountHandler(
    AppDbContext db,
    AuthSessionIssuer issuer,
    AuditLog audit,
    GameTelemetry telemetry,
    TimeProvider clock) : IHandler
{
    public async Task<Result<AuthResponse>> Handle(RegisterRequest request, CancellationToken ct)
    {
        var normalized = AuthSessionIssuer.NormalizeEmail(request.Email);
        if (await db.Accounts.AnyAsync(a => a.NormalizedEmail == normalized, ct))
        {
            return Error.Conflict("account.email_taken", "An account with this email already exists.");
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var account = new Account
        {
            Kind = AccountKind.Registered,
            Email = request.Email.Trim(),
            NormalizedEmail = normalized,
            CreatedAt = now,
            LastSeenAt = now,
        };
        account.PasswordHash = AuthSessionIssuer.PasswordHasher.HashPassword(account, request.Password);
        var profile = ProfileFactory.Create(account.Id, request.DisplayName.Trim(), now);

        db.Accounts.Add(account);
        db.Profiles.Add(profile);
        var response = issuer.Issue(account, profile);
        audit.Record(AuditCategories.Auth, "account.registered", accountId: account.Id);

        await db.SaveChangesAsync(ct);
        telemetry.AccountsCreated.Add(1, new KeyValuePair<string, object?>("kind", "registered"));
        return response;
    }
}
