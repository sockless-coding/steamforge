using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;

namespace SF.Application.Features.SaveGames;

public static class SaveGameQueries
{
    public static SaveGameSummary ToSummary(SaveGame s) =>
        new(s.Slot, s.Name, s.Summary, s.Difficulty, s.Year, s.Population, s.ContentVersion, s.SaveVersion, s.SizeBytes, s.UpdatedAt, s.Version);
}

public sealed class ListSaveGamesHandler(AppDbContext db, ICurrentUser currentUser) : IHandler
{
    public async Task<IReadOnlyList<SaveGameSummary>> Handle(CancellationToken ct)
    {
        var accountId = currentUser.AccountId;
        // Project the summary columns only: snapshots can be large.
        return await db.SaveGames.AsNoTracking()
            .Where(s => s.AccountId == accountId)
            .OrderBy(s => s.Slot)
            .Select(s => new SaveGameSummary(s.Slot, s.Name, s.Summary, s.Difficulty, s.Year, s.Population, s.ContentVersion, s.SaveVersion, s.SizeBytes, s.UpdatedAt, s.Version))
            .ToListAsync(ct);
    }
}

public sealed class GetSaveGameHandler(AppDbContext db, ICurrentUser currentUser) : IHandler
{
    public async Task<Result<SaveGameDetails>> Handle(int slot, CancellationToken ct)
    {
        var accountId = currentUser.AccountId;
        var s = await db.SaveGames.AsNoTracking().SingleOrDefaultAsync(x => x.AccountId == accountId && x.Slot == slot, ct);
        if (s is null)
        {
            return Error.NotFound("save.not_found", "That slot is empty.");
        }

        return new SaveGameDetails(s.Slot, s.Name, s.Summary, s.Difficulty, s.Year, s.Population, s.ContentVersion, s.SaveVersion, s.SizeBytes, s.UpdatedAt, s.Version, s.Data);
    }
}
