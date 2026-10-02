using System.Security.Cryptography;
using SF.Application.Features.Profiles;
using SF.Application.Infrastructure.Audit;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;
using SF.Application.Infrastructure.Telemetry;

namespace SF.Application.Features.Accounts;

public sealed class CreateGuestAccountHandler(
    AppDbContext db,
    AuthSessionIssuer issuer,
    AuditLog audit,
    GameTelemetry telemetry,
    TimeProvider clock) : IHandler
{
    public async Task<Result<AuthResponse>> Handle(CreateGuestRequest request, CancellationToken ct)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var account = new Account
        {
            Kind = AccountKind.Guest,
            DeviceId = request.DeviceId,
            CreatedAt = now,
            LastSeenAt = now,
        };
        var displayName = request.DisplayName?.Trim() ?? $"Engineer-{RandomNumberGenerator.GetInt32(1000, 10000)}";
        var profile = ProfileFactory.Create(account.Id, displayName, now);

        db.Accounts.Add(account);
        db.Profiles.Add(profile);
        var response = issuer.Issue(account, profile);
        audit.Record(AuditCategories.Auth, "guest.created", new { account.DeviceId }, accountId: account.Id);

        await db.SaveChangesAsync(ct);
        telemetry.AccountsCreated.Add(1, new KeyValuePair<string, object?>("kind", "guest"));
        return response;
    }
}
