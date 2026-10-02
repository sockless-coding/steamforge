using Microsoft.IdentityModel.JsonWebTokens;
using System.Security.Claims;

namespace SF.Application.Infrastructure.Auth;

public interface ICurrentUser
{
    Guid? AccountIdOrNull { get; }

    /// <summary>The authenticated account id. Only call from endpoints that require authorization.</summary>
    Guid AccountId { get; }

    bool IsInRole(string role);
}

public sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? AccountIdOrNull
    {
        get
        {
            var user = accessor.HttpContext?.User;
            var sub = user?.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? user?.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(sub, out var id) ? id : null;
        }
    }

    public Guid AccountId => AccountIdOrNull ?? throw new InvalidOperationException("No authenticated account.");

    public bool IsInRole(string role) => accessor.HttpContext?.User.IsInRole(role) ?? false;
}
