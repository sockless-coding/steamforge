using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using SF.Application.Features.Accounts;

namespace SF.Application.Tests.Infrastructure;

/// <summary>Boots the real API against a throwaway SQLite database file.</summary>
public sealed class TestApp : WebApplicationFactory<Program>
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"sf-test-{Guid.NewGuid():N}.db");
    private readonly Dictionary<string, string?> _overrides;

    public TestApp()
        : this([])
    {
    }

    internal TestApp(Dictionary<string, string?> overrides)
    {
        _overrides = overrides;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // UseSetting (not ConfigureAppConfiguration) so values are visible while Program.cs registers services.
        var settings = new Dictionary<string, string?>
        {
            ["Database:Provider"] = "Sqlite",
            ["Database:ConnectionString"] = $"Data Source={_dbPath};Pooling=False",
            ["Jwt:SigningKey"] = "test-signing-key-0123456789abcdef0123456789",
            ["RateLimits:GlobalTokenLimit"] = "100000",
            ["RateLimits:AuthPerMinute"] = "100000",
            ["RateLimits:MutationPerMinute"] = "100000",
        };
        foreach (var (key, value) in _overrides)
        {
            settings[key] = value;
        }

        foreach (var (key, value) in settings)
        {
            builder.UseSetting(key, value);
        }
    }

    public async Task<(HttpClient Client, AuthResponse Auth)> CreateGuestClientAsync()
    {
        var client = CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/guest", new CreateGuestRequest(null, null), Json);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try
        {
            File.Delete(_dbPath);
        }
        catch (IOException)
        {
            // Best effort cleanup of the temp database.
        }
    }
}
