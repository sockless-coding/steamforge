using Microsoft.EntityFrameworkCore;
using SF.Application.Features.Content;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.Errors;

namespace SF.Application.Features.Statistics;

/// <summary>
/// Records colony milestones. The game is single-player and runs on the client, so these are personal records, not
/// competitive scores: values are bounds-checked and only ever raise the stored bests.
/// </summary>
public sealed class ReportColonyHandler(AppDbContext db, ICurrentUser currentUser, ContentCatalog content, TimeProvider clock) : IHandler
{
    public async Task<Result<ColonyRecordDto>> Handle(ReportColonyRequest request, CancellationToken ct)
    {
        if (!content.Current.HasPreset(request.Difficulty))
        {
            return Error.Validation("stats.difficulty", "Unknown difficulty.");
        }

        var accountId = currentUser.AccountId;
        var record = await db.ColonyRecords.SingleOrDefaultAsync(r => r.AccountId == accountId && r.Difficulty == request.Difficulty, ct);
        if (record is null)
        {
            record = new ColonyRecord { AccountId = accountId, Difficulty = request.Difficulty };
            db.ColonyRecords.Add(record);
        }

        if (request.Founded)
        {
            record.ColoniesFounded++;
        }

        record.BestYears = Math.Max(record.BestYears, request.Years);
        record.PeakPopulation = Math.Max(record.PeakPopulation, request.Population);
        record.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(ct);
        return GetColonyRecordsHandler.ToDto(record);
    }
}
