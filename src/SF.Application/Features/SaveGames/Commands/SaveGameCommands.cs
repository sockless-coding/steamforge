using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Audit;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;
using SF.Application.Infrastructure.Telemetry;

namespace SF.Application.Features.SaveGames;

/// <summary>Writes a colony snapshot to a slot. The snapshot is opaque to the server; it is only size-checked.</summary>
public sealed class PutSaveGameHandler(AppDbContext db, ICurrentUser currentUser, AuditLog audit, GameTelemetry telemetry, TimeProvider clock) : IHandler
{
    public async Task<Result<SaveGameSummary>> Handle(int slot, PutSaveGameRequest request, CancellationToken ct)
    {
        if (!SaveLimits.IsValidSlot(slot))
        {
            return Error.Validation("save.slot", $"Slot must be between 1 and {SaveLimits.Slots}.");
        }

        var accountId = currentUser.AccountId;
        var save = await db.SaveGames.SingleOrDefaultAsync(s => s.AccountId == accountId && s.Slot == slot, ct);
        if (save is null)
        {
            save = new SaveGame
            {
                AccountId = accountId,
                Slot = slot,
                Name = request.Name,
                Summary = request.Summary,
                Difficulty = request.Difficulty,
                ContentVersion = request.ContentVersion,
                Data = string.Empty,
            };
            db.SaveGames.Add(save);
        }
        else if (request.ExpectedVersion is { } expected && expected != save.Version)
        {
            return Error.Conflict("save.version_conflict", "This slot was updated on another device.");
        }

        save.Name = request.Name.Trim();
        save.Summary = request.Summary;
        save.Difficulty = request.Difficulty;
        save.Year = request.Year;
        save.Population = request.Population;
        save.ContentVersion = request.ContentVersion;
        save.SaveVersion = request.SaveVersion;
        save.Data = request.Data;
        save.SizeBytes = request.Data.Length * 3 / 4;
        save.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        audit.Record(AuditCategories.SaveGame, "save.written", new { slot, save.SizeBytes, request.Year });

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Error.Conflict("save.version_conflict", "This slot was updated on another device.");
        }

        telemetry.SavesWritten.Add(1);
        telemetry.SaveSize.Record(save.SizeBytes);
        return SaveGameQueries.ToSummary(save);
    }
}

public sealed class DeleteSaveGameHandler(AppDbContext db, ICurrentUser currentUser) : IHandler
{
    public async Task<Result<Unit>> Handle(int slot, CancellationToken ct)
    {
        var accountId = currentUser.AccountId;
        await db.SaveGames.Where(s => s.AccountId == accountId && s.Slot == slot).ExecuteDeleteAsync(ct);
        return Unit.Value;
    }
}
