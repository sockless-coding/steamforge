using System.Text.Json.Serialization;
using FluentValidation;
using Microsoft.AspNetCore.HttpOverrides;
using SF.Application.Features.Content;
using SF.Application.Features.SaveGames;
using SF.Application.Infrastructure.Audit;
using SF.Application.Infrastructure.Auth;
using SF.Application.Infrastructure.Data;
using SF.Application.Infrastructure.Endpoints;
using SF.Application.Infrastructure.RateLimiting;
using SF.Application.Infrastructure.Telemetry;

var builder = WebApplication.CreateBuilder(args);
var assembly = typeof(Program).Assembly;

// Compressed colony snapshots are the largest payload; leave headroom over the per-save cap.
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = SaveLimits.MaxRequestBytes);

builder.AddAppTelemetry();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddAppDatabase(builder.Configuration);
builder.Services.AddAppAuthentication(builder.Configuration);
builder.Services.AddAppRateLimiting(builder.Configuration);
builder.Services.AddValidatorsFromAssembly(assembly, includeInternalTypes: true);
builder.Services.AddFeatureHandlers(assembly);
builder.Services.AddScoped<AuditLog>();
builder.Services.AddContent();
builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
});

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(allowedOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();

if (!app.Environment.IsDevelopment() && !app.Environment.IsEnvironment("Testing"))
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// Strict CSP: only same-origin scripts (Three.js needs no eval), inline style attributes for React,
// and blob workers/images for procedural textures.
const string ContentSecurityPolicy =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; media-src 'self' blob:; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers.XContentTypeOptions = "nosniff";
    headers.XFrameOptions = "DENY";
    headers.ContentSecurityPolicy = ContentSecurityPolicy;
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
    headers["Cross-Origin-Opener-Policy"] = "same-origin";
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health").DisableRateLimiting();
app.MapFeatureEndpoints(assembly);

// Client-side routes fall back to the SPA shell; unknown API routes stay 404.
app.MapFallbackToFile("{*path:nonfile:regex(^(?!api/).*$)}", "index.html");

await app.Services.MigrateDatabaseAsync();
await app.Services.SeedContentAsync();
await app.RunAsync();

public partial class Program;
