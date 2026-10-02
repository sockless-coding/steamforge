using System.Text.Json;
using FluentValidation;

namespace SF.Application.Features.Profiles;

public sealed class UpdateProfileRequestValidator : AbstractValidator<UpdateProfileRequest>
{
    public UpdateProfileRequestValidator()
    {
        RuleFor(r => r.DisplayName)
            .NotEmpty()
            .Length(3, 24)
            .Matches(@"^[\p{L}\p{N} _\-\.]+$");
        RuleFor(r => r.ExpectedVersion).GreaterThanOrEqualTo(0);
    }
}

public sealed class UpdateSettingsRequestValidator : AbstractValidator<UpdateSettingsRequest>
{
    public const int MaxSettingsBytes = 8192;

    public UpdateSettingsRequestValidator()
    {
        RuleFor(r => r.Settings)
            .Must(s => s.ValueKind == JsonValueKind.Object)
            .WithMessage("Settings must be a JSON object.")
            .Must(s => s.GetRawText().Length <= MaxSettingsBytes)
            .WithMessage($"Settings must be at most {MaxSettingsBytes} bytes.");
    }
}
