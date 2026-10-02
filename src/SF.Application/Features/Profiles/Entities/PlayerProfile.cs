using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SF.Application.Features.Accounts;
using SF.Application.Infrastructure.Data;

namespace SF.Application.Features.Profiles;

/// <summary>The player's profile. One per account; the primary key is the account id.</summary>
public sealed class PlayerProfile : IVersioned
{
    public Guid AccountId { get; set; }
    public required string DisplayName { get; set; }

    /// <summary>Client preferences (audio, graphics, controls) synced across devices.</summary>
    public string SettingsJson { get; set; } = "{}";

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public long Version { get; set; }
}

public sealed class PlayerProfileConfiguration : IEntityTypeConfiguration<PlayerProfile>
{
    public void Configure(EntityTypeBuilder<PlayerProfile> builder)
    {
        builder.HasKey(p => p.AccountId);
        builder.Property(p => p.DisplayName).HasMaxLength(32);
        builder.Property(p => p.SettingsJson).HasMaxLength(8192);
        builder.HasOne<Account>().WithOne().HasForeignKey<PlayerProfile>(p => p.AccountId).OnDelete(DeleteBehavior.Cascade);
    }
}
