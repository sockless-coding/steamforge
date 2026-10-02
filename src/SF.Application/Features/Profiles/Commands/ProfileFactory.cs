namespace SF.Application.Features.Profiles;

public static class ProfileFactory
{
    public static PlayerProfile Create(Guid accountId, string displayName, DateTime now) => new()
    {
        AccountId = accountId,
        DisplayName = displayName,
        CreatedAt = now,
        UpdatedAt = now,
    };
}
