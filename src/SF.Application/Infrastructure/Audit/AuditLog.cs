using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;

namespace SF.Application.Infrastructure.Audit;

public enum AuditSeverity
{
    Info,
    Warning,
    Critical,
}

public sealed class AuditEntry
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? AccountId { get; set; }
    public required string Category { get; set; }
    public required string Action { get; set; }
    public AuditSeverity Severity { get; set; }
    public string? Details { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class AuditEntryConfiguration : IEntityTypeConfiguration<AuditEntry>
{
    public void Configure(EntityTypeBuilder<AuditEntry> builder)
    {
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Category).HasMaxLength(64);
        builder.Property(e => e.Action).HasMaxLength(128);
        builder.Property(e => e.IpAddress).HasMaxLength(64);
        builder.HasIndex(e => new { e.AccountId, e.CreatedAt });
        builder.HasIndex(e => new { e.Category, e.CreatedAt });
    }
}

public static class AuditCategories
{
    public const string Auth = "auth";
    public const string SaveGame = "savegame";
}

/// <summary>
/// Adds audit entries to the current <see cref="AppDbContext"/> so they commit atomically with the handler's changes.
/// </summary>
public sealed class AuditLog(AppDbContext db, ICurrentUser currentUser, IHttpContextAccessor http, TimeProvider clock)
{
    public void Record(string category, string action, object? details = null, AuditSeverity severity = AuditSeverity.Info, Guid? accountId = null)
    {
        db.AuditEntries.Add(new AuditEntry
        {
            AccountId = accountId ?? currentUser.AccountIdOrNull,
            Category = category,
            Action = action,
            Severity = severity,
            Details = details is null ? null : JsonSerializer.Serialize(details),
            IpAddress = http.HttpContext?.Connection.RemoteIpAddress?.ToString(),
            CreatedAt = clock.GetUtcNow().UtcDateTime,
        });
    }
}
