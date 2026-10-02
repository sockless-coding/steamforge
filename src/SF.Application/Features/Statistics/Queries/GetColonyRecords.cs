using Microsoft.EntityFrameworkCore;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;

namespace SF.Application.Features.Statistics;

public sealed class GetColonyRecordsHandler(AppDbContext db, ICurrentUser currentUser) : IHandler
{
    public async Task<IReadOnlyList<ColonyRecordDto>> Handle(CancellationToken ct)
    {
        var accountId = currentUser.AccountId;
        var records = await db.ColonyRecords.AsNoTracking().Where(r => r.AccountId == accountId).ToListAsync(ct);
        return records.OrderBy(r => r.Difficulty).Select(ToDto).ToList();
    }

    internal static ColonyRecordDto ToDto(ColonyRecord r) => new(r.Difficulty, r.ColoniesFounded, r.BestYears, r.PeakPopulation, r.UpdatedAt);
}
