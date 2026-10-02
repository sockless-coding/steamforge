namespace SF.Application.Features.SaveGames;

public static class SaveLimits
{
    public const int Slots = 6;

    /// <summary>Maximum base64 snapshot length. Large maps compress to well under 1 MB; this leaves ample headroom.</summary>
    public const int MaxDataChars = 8 * 1024 * 1024;

    public const long MaxRequestBytes = MaxDataChars + 64 * 1024;

    public static bool IsValidSlot(int slot) => slot is >= 1 and <= Slots;
}

public sealed record SaveGameSummary(
    int Slot,
    string Name,
    string Summary,
    string Difficulty,
    int Year,
    int Population,
    string ContentVersion,
    int SaveVersion,
    int SizeBytes,
    DateTime UpdatedAt,
    long Version);

public sealed record SaveGameDetails(
    int Slot,
    string Name,
    string Summary,
    string Difficulty,
    int Year,
    int Population,
    string ContentVersion,
    int SaveVersion,
    int SizeBytes,
    DateTime UpdatedAt,
    long Version,
    string Data);

/// <param name="ExpectedVersion">Optimistic concurrency: the version the device last saw, or null to overwrite.</param>
public sealed record PutSaveGameRequest(
    string Name,
    string Summary,
    string Difficulty,
    int Year,
    int Population,
    string ContentVersion,
    int SaveVersion,
    string Data,
    long? ExpectedVersion);
