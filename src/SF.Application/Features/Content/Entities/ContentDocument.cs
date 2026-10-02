using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SF.Application.Features.Content;

/// <summary>
/// One persisted content document (e.g. kind "buildings"), merged from <c>Content/*.json</c> and any content packs.
/// <see cref="IsOverride"/> rows are edited by live-ops and are never overwritten by the seeder.
/// </summary>
public sealed class ContentDocument
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Kind { get; set; }
    public required string Json { get; set; }
    public required string Hash { get; set; }
    public bool IsOverride { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ContentDocumentConfiguration : IEntityTypeConfiguration<ContentDocument>
{
    public void Configure(EntityTypeBuilder<ContentDocument> builder)
    {
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Kind).HasMaxLength(32);
        builder.Property(d => d.Hash).HasMaxLength(64);
        builder.HasIndex(d => d.Kind).IsUnique();
    }
}
