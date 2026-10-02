using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SF.Application.Features.Accounts;

namespace SF.Application.Features.Statistics;

/// <summary>A player's best colony results per difficulty preset.</summary>
public sealed class ColonyRecord
{
    public Guid AccountId { get; set; }
    public required string Difficulty { get; set; }
    public int ColoniesFounded { get; set; }
    public int BestYears { get; set; }
    public int PeakPopulation { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ColonyRecordConfiguration : IEntityTypeConfiguration<ColonyRecord>
{
    public void Configure(EntityTypeBuilder<ColonyRecord> builder)
    {
        builder.HasKey(r => new { r.AccountId, r.Difficulty });
        builder.Property(r => r.Difficulty).HasMaxLength(32);
        builder.HasOne<Account>().WithMany().HasForeignKey(r => r.AccountId).OnDelete(DeleteBehavior.Cascade);
    }
}
