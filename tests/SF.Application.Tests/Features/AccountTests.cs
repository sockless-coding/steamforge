using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using SF.Application.Features.Accounts;
using SF.Application.Features.Profiles;
using SF.Application.Tests.Infrastructure;

namespace SF.Application.Tests.Features;

public sealed class AccountTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;

    public AccountTests(TestApp app) => _app = app;

    [Fact]
    public async Task Guest_can_play_then_upgrade_and_keep_profile()
    {
        var (client, guest) = await _app.CreateGuestClientAsync();
        Assert.Equal(AccountKind.Guest, guest.Kind);

        var profile = await client.GetFromJsonAsync<ProfileDto>("/api/profile", TestApp.Json);
        Assert.Equal(guest.AccountId, profile!.AccountId);

        var email = $"upgrade-{Guid.NewGuid():N}@example.com";
        var upgrade = await client.PostAsJsonAsync("/api/auth/upgrade", new UpgradeGuestRequest(email, "brass-gears-42", "Artificer"), TestApp.Json);
        upgrade.EnsureSuccessStatusCode();
        var registered = (await upgrade.Content.ReadFromJsonAsync<AuthResponse>(TestApp.Json))!;

        Assert.Equal(guest.AccountId, registered.AccountId);
        Assert.Equal(AccountKind.Registered, registered.Kind);
        Assert.Equal("Artificer", registered.DisplayName);

        // The guest refresh token no longer works after the upgrade.
        var oldRefresh = await _app.CreateClient().PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(guest.RefreshToken), TestApp.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, oldRefresh.StatusCode);

        var login = await _app.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "brass-gears-42"), TestApp.Json);
        login.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Register_rejects_weak_password_and_duplicate_email()
    {
        var client = _app.CreateClient();
        var weak = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest("weak@example.com", "short", "Tinker"), TestApp.Json);
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);

        var email = $"dup-{Guid.NewGuid():N}@example.com";
        var first = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "valid-password-1", "Tinker"), TestApp.Json);
        first.EnsureSuccessStatusCode();
        var second = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email.ToUpperInvariant(), "valid-password-1", "Tinker"), TestApp.Json);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Refresh_rotates_and_reuse_revokes_family()
    {
        var (_, guest) = await _app.CreateGuestClientAsync();
        var client = _app.CreateClient();

        var first = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(guest.RefreshToken), TestApp.Json);
        first.EnsureSuccessStatusCode();
        var rotated = (await first.Content.ReadFromJsonAsync<AuthResponse>(TestApp.Json))!;
        Assert.NotEqual(guest.RefreshToken, rotated.RefreshToken);

        // Replaying the original token is treated as theft...
        var replay = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(guest.RefreshToken), TestApp.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        // ...which also kills the legitimately rotated token.
        var afterReuse = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(rotated.RefreshToken), TestApp.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, afterReuse.StatusCode);
    }

    [Fact]
    public async Task Login_locks_out_after_repeated_failures()
    {
        var client = _app.CreateClient();
        var email = $"lock-{Guid.NewGuid():N}@example.com";
        (await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "correct-horse-1", "Locksmith"), TestApp.Json)).EnsureSuccessStatusCode();

        for (var i = 0; i < LoginHandler.MaxFailedAttempts; i++)
        {
            var bad = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "wrong-password-1"), TestApp.Json);
            Assert.Equal(HttpStatusCode.Unauthorized, bad.StatusCode);
        }

        var locked = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "correct-horse-1"), TestApp.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
    }

    [Fact]
    public async Task Profile_requires_authentication_and_detects_version_conflicts()
    {
        var anonymous = await _app.CreateClient().GetAsync("/api/profile");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        var (client, _) = await _app.CreateGuestClientAsync();
        var profile = (await client.GetFromJsonAsync<ProfileDto>("/api/profile", TestApp.Json))!;

        var ok = await client.PutAsJsonAsync("/api/profile", new UpdateProfileRequest("Gearwright", profile.Version), TestApp.Json);
        ok.EnsureSuccessStatusCode();

        var stale = await client.PutAsJsonAsync("/api/profile", new UpdateProfileRequest("Stale Name", profile.Version), TestApp.Json);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task Tampered_access_token_is_rejected()
    {
        var (_, guest) = await _app.CreateGuestClientAsync();
        var client = _app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", guest.AccessToken[..^4] + "AAAA");
        var response = await client.GetAsync("/api/profile");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

public sealed class RateLimitTests
{
    [Fact]
    public async Task Auth_endpoints_are_rate_limited()
    {
        using var app = new TestApp(new() { ["RateLimits:AuthPerMinute"] = "3" });
        var client = app.CreateClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest("nobody@example.com", "whatever-123"), TestApp.Json);
            statuses.Add(response.StatusCode);
        }

        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
    }
}
