using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SF.Application.Infrastructure.Data;

namespace SF.Application.Features.SaveGames;

/// <summary>
/// A cloud save of a colony: a gzip-compressed, base64-encoded snapshot of the full simulation state produced by the
/// client, plus summary columns so the load screen can list slots without downloading snapshots.
/// </summary>
public sealed class SaveGame : IVersioned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AccountId { get; set; }
    public int Slot { get; set; }
    public required string Name { get; set; }
    public required string Summary { get; set; }
    public required string Difficulty { get; set; }
    public int Year { get; set; }
    public int Population { get; set; }
    public required string ContentVersion { get; set; }
    public int SaveVersion { get; set; }
    public required string Data { get; set; }
    public int SizeBytes { get; set; }
    public DateTime UpdatedAt { get; set; }
    public long Version { get; set; }
}

public sealed class SaveGameConfiguration : IEntityTypeConfiguration<SaveGame>
{
    public void Configure(EntityTypeBuilder<SaveGame> builder)
    {
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Name).HasMaxLength(48);
        builder.Property(s => s.Summary).HasMaxLength(256);
        builder.Property(s => s.Difficulty).HasMaxLength(32);
        builder.Property(s => s.ContentVersion).HasMaxLength(32);
        builder.HasIndex(s => new { s.AccountId, s.Slot }).IsUnique();
    }
}
