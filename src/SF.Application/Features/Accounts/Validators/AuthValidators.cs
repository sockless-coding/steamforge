using FluentValidation;

namespace SF.Application.Features.Accounts;

internal static class AccountRules
{
    public const int MinPasswordLength = 10;
    public const int MaxPasswordLength = 128;

    public static IRuleBuilderOptions<T, string> ValidEmail<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().MaximumLength(256).EmailAddress();

    public static IRuleBuilderOptions<T, string> ValidPassword<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty()
            .MinimumLength(MinPasswordLength)
            .MaximumLength(MaxPasswordLength)
            .Must(p => p.Any(char.IsLetter) && p.Any(c => !char.IsLetter(c)))
            .WithMessage("Password must contain letters and at least one digit or symbol.");

    public static IRuleBuilderOptions<T, string?> ValidDisplayName<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Length(3, 24)
            .Matches(@"^[\p{L}\p{N} _\-\.]+$")
            .WithMessage("Display name may contain letters, digits, spaces, '-', '_' and '.'.");
}

public sealed class CreateGuestRequestValidator : AbstractValidator<CreateGuestRequest>
{
    public CreateGuestRequestValidator()
    {
        RuleFor(r => r.DeviceId).MaximumLength(128);
        RuleFor(r => r.DisplayName).ValidDisplayName().When(r => r.DisplayName is not null);
    }
}

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(r => r.Email).ValidEmail();
        RuleFor(r => r.Password).ValidPassword();
        RuleFor(r => r.DisplayName).NotEmpty().ValidDisplayName();
    }
}

public sealed class UpgradeGuestRequestValidator : AbstractValidator<UpgradeGuestRequest>
{
    public UpgradeGuestRequestValidator()
    {
        RuleFor(r => r.Email).ValidEmail();
        RuleFor(r => r.Password).ValidPassword();
        RuleFor(r => r.DisplayName).ValidDisplayName().When(r => r.DisplayName is not null);
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty().MaximumLength(256);
        RuleFor(r => r.Password).NotEmpty().MaximumLength(AccountRules.MaxPasswordLength);
    }
}

public sealed class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator() => RuleFor(r => r.RefreshToken).NotEmpty().MaximumLength(256);
}

public sealed class LogoutRequestValidator : AbstractValidator<LogoutRequest>
{
    public LogoutRequestValidator() => RuleFor(r => r.RefreshToken).NotEmpty().MaximumLength(256);
}
