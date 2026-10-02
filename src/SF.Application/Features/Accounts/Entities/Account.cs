using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SF.Application.Features.Accounts;

public enum AccountKind
{
    Guest,
    Registered,
}

public sealed class Account
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public AccountKind Kind { get; set; }
    public string? Email { get; set; }
    public string? NormalizedEmail { get; set; }
    public string? PasswordHash { get; set; }

    /// <summary>Opaque client-generated device id; informational only, never used for authentication.</summary>
    public string? DeviceId { get; set; }

    public bool IsAdmin { get; set; }
    public bool IsBanned { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTime? LockoutUntil { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }

    public List<RefreshToken> RefreshTokens { get; set; } = [];
}

public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid AccountId { get; set; }

    /// <summary>SHA-256 hash of the token; the raw token is only ever held by the client.</summary>
    public required string TokenHash { get; set; }

    /// <summary>All tokens produced by rotating one login share a family; reuse of a rotated token revokes the family.</summary>
    public Guid FamilyId { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? ReplacedByHash { get; set; }
    public string? CreatedByIp { get; set; }
}

public sealed class AccountConfiguration : IEntityTypeConfiguration<Account>
{
    public void Configure(EntityTypeBuilder<Account> builder)
    {
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Email).HasMaxLength(256);
        builder.Property(a => a.NormalizedEmail).HasMaxLength(256);
        builder.Property(a => a.PasswordHash).HasMaxLength(512);
        builder.Property(a => a.DeviceId).HasMaxLength(128);
        builder.HasIndex(a => a.NormalizedEmail).IsUnique();
        builder.HasMany(a => a.RefreshTokens).WithOne().HasForeignKey(t => t.AccountId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.TokenHash).HasMaxLength(128);
        builder.Property(t => t.ReplacedByHash).HasMaxLength(128);
        builder.Property(t => t.CreatedByIp).HasMaxLength(64);
        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => t.FamilyId);
    }
}
