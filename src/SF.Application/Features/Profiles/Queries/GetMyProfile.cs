using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;

namespace SF.Application.Features.Profiles;

public sealed class GetMyProfileHandler(AppDbContext db, ICurrentUser currentUser) : IHandler
{
    public async Task<Result<ProfileDto>> Handle(CancellationToken ct)
    {
        var accountId = currentUser.AccountId;
        var row = await db.Profiles.AsNoTracking()
            .Where(p => p.AccountId == accountId)
            .Join(db.Accounts, p => p.AccountId, a => a.Id, (p, a) => new { Profile = p, a.Kind })
            .SingleOrDefaultAsync(ct);

        if (row is null)
        {
            return Error.NotFound("profile.not_found", "Profile not found.");
        }

        return ToDto(row.Profile, row.Kind);
    }

    internal static ProfileDto ToDto(PlayerProfile p, Accounts.AccountKind kind) => new(
        p.AccountId,
        p.DisplayName,
        kind,
        JsonSerializer.Deserialize<JsonElement>(p.SettingsJson),
        p.Version);
}
