using FluentValidation;

namespace SF.Application.Features.SaveGames;

public sealed class PutSaveGameRequestValidator : AbstractValidator<PutSaveGameRequest>
{
    public PutSaveGameRequestValidator()
    {
        RuleFor(r => r.Name).NotEmpty().MaximumLength(48);
        RuleFor(r => r.Summary).MaximumLength(256);
        RuleFor(r => r.Difficulty).NotEmpty().MaximumLength(32);
        RuleFor(r => r.Year).InclusiveBetween(1, 100_000);
        RuleFor(r => r.Population).InclusiveBetween(0, 1_000_000);
        RuleFor(r => r.ContentVersion).NotEmpty().MaximumLength(32);
        RuleFor(r => r.SaveVersion).GreaterThan(0);
        RuleFor(r => r.Data)
            .NotEmpty()
            .MaximumLength(SaveLimits.MaxDataChars)
            .Must(BeBase64).WithMessage("Save data must be base64.");
    }

    private static bool BeBase64(string data) =>
        data.Length % 4 == 0 && data.All(c => char.IsAsciiLetterOrDigit(c) || c is '+' or '/' or '=');
}
