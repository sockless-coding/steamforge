using FluentValidation;

namespace SF.Application.Features.Statistics;

public sealed class ReportColonyRequestValidator : AbstractValidator<ReportColonyRequest>
{
    public ReportColonyRequestValidator()
    {
        RuleFor(r => r.Difficulty).NotEmpty().MaximumLength(32);
        RuleFor(r => r.Years).InclusiveBetween(0, 100_000);
        RuleFor(r => r.Population).InclusiveBetween(0, 1_000_000);
    }
}
