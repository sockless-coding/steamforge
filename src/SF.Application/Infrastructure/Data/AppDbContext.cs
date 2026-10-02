using Microsoft.EntityFrameworkCore;
using SF.Application.Features.Accounts;
using SF.Application.Features.Content;
using SF.Application.Features.Profiles;
using SF.Application.Features.SaveGames;
using SF.Application.Features.Statistics;
using SF.Application.Infrastructure.Audit;

namespace SF.Application.Infrastructure.Data;

/// <summary>
/// The single EF Core context. Feature slices query it directly (no repositories).
/// Provider-specific subclasses exist only so each provider keeps its own migrations.
/// </summary>
public abstract partial class AppDbContext(DbContextOptions options) : DbContext(options)
{
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<PlayerProfile> Profiles => Set<PlayerProfile>();
    public DbSet<ContentDocument> ContentDocuments => Set<ContentDocument>();
    public DbSet<SaveGame> SaveGames => Set<SaveGame>();
    public DbSet<ColonyRecord> ColonyRecords => Set<ColonyRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        foreach (var entity in modelBuilder.Model.GetEntityTypes().Where(e => typeof(IVersioned).IsAssignableFrom(e.ClrType)))
        {
            modelBuilder.Entity(entity.ClrType).Property(nameof(IVersioned.Version)).IsConcurrencyToken();
        }
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries<IVersioned>().Where(e => e.State == EntityState.Modified))
        {
            entry.Entity.Version++;
        }

        return base.SaveChangesAsync(cancellationToken);
    }
}

public sealed class SqliteAppDbContext(DbContextOptions<SqliteAppDbContext> options) : AppDbContext(options);

public sealed class PostgresAppDbContext(DbContextOptions<PostgresAppDbContext> options) : AppDbContext(options);

/// <summary>Optimistic concurrency: the version is incremented on every update and checked on save.</summary>
public interface IVersioned
{
    long Version { get; set; }
}
