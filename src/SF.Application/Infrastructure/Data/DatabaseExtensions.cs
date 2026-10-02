using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace SF.Application.Infrastructure.Data;

public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>"Sqlite" (default, local development) or "Postgres".</summary>
    public string Provider { get; set; } = "Sqlite";

    public string ConnectionString { get; set; } = "Data Source=steamforge.db";

    public bool ApplyMigrationsOnStartup { get; set; } = true;

    public bool IsPostgres => Provider.Equals("Postgres", StringComparison.OrdinalIgnoreCase);
}

public static class DatabaseExtensions
{
    public static IServiceCollection AddAppDatabase(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(DatabaseOptions.SectionName).Get<DatabaseOptions>() ?? new DatabaseOptions();
        services.AddSingleton(options);

        if (options.IsPostgres)
        {
            services.AddDbContext<PostgresAppDbContext>(o => o.UseNpgsql(options.ConnectionString));
            services.AddScoped<AppDbContext>(sp => sp.GetRequiredService<PostgresAppDbContext>());
        }
        else
        {
            services.AddDbContext<SqliteAppDbContext>(o => o.UseSqlite(options.ConnectionString));
            services.AddScoped<AppDbContext>(sp => sp.GetRequiredService<SqliteAppDbContext>());
        }

        return services;
    }

    public static async Task MigrateDatabaseAsync(this IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var options = scope.ServiceProvider.GetRequiredService<DatabaseOptions>();
        if (!options.ApplyMigrationsOnStartup)
        {
            return;
        }

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync(ct);
    }
}

// Design-time factories so `dotnet ef migrations add` can target each provider:
//   dotnet ef migrations add <Name> --context SqliteAppDbContext --output-dir Migrations/Sqlite
//   dotnet ef migrations add <Name> --context PostgresAppDbContext --output-dir Migrations/Postgres
public sealed class SqliteDesignTimeFactory : IDesignTimeDbContextFactory<SqliteAppDbContext>
{
    public SqliteAppDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<SqliteAppDbContext>().UseSqlite("Data Source=design.db").Options);
}

public sealed class PostgresDesignTimeFactory : IDesignTimeDbContextFactory<PostgresAppDbContext>
{
    public PostgresAppDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<PostgresAppDbContext>().UseNpgsql("Host=localhost;Database=steamforge;Username=postgres").Options);
}
