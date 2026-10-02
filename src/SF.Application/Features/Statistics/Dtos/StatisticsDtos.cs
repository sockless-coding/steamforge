namespace SF.Application.Features.Statistics;

public sealed record ColonyRecordDto(string Difficulty, int ColoniesFounded, int BestYears, int PeakPopulation, DateTime UpdatedAt);

/// <param name="Founded">True when reporting a newly founded colony (increments the counter).</param>
public sealed record ReportColonyRequest(string Difficulty, bool Founded, int Years, int Population);
