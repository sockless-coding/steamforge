using System.Text.Json;
using SF.Application.Features.Accounts;

namespace SF.Application.Features.Profiles;

public sealed record ProfileDto(
    Guid AccountId,
    string DisplayName,
    AccountKind Kind,
    JsonElement Settings,
    long Version);

public sealed record UpdateProfileRequest(string DisplayName, long ExpectedVersion);

public sealed record UpdateSettingsRequest(JsonElement Settings);
