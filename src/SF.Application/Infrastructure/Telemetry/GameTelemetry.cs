using System.Diagnostics;
using System.Diagnostics.Metrics;
using OpenTelemetry.Logs;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;

namespace SF.Application.Infrastructure.Telemetry;

/// <summary>Custom game metrics and traces, exported through OpenTelemetry.</summary>
public sealed class GameTelemetry : IDisposable
{
    public const string SourceName = "SteamForge";

    public static readonly ActivitySource ActivitySource = new(SourceName);

    private readonly Meter _meter;

    public GameTelemetry(IMeterFactory meterFactory)
    {
        _meter = meterFactory.Create(SourceName);
        AccountsCreated = _meter.CreateCounter<long>("sf.accounts.created", description: "Accounts created, tagged by kind");
        SavesWritten = _meter.CreateCounter<long>("sf.saves.written", description: "Cloud colony saves written");
        SaveSize = _meter.CreateHistogram<long>("sf.saves.size", unit: "By", description: "Compressed size of written colony saves");
    }

    public Counter<long> AccountsCreated { get; }
    public Counter<long> SavesWritten { get; }
    public Histogram<long> SaveSize { get; }

    public void Dispose() => _meter.Dispose();
}

public static class TelemetryExtensions
{
    public static WebApplicationBuilder AddAppTelemetry(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<GameTelemetry>();

        // The OTLP exporter reads OTEL_EXPORTER_OTLP_ENDPOINT itself; we only decide whether to enable it.
        var useOtlp = !string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]);
        var useConsole = builder.Configuration.GetValue("Telemetry:ConsoleExporter", false);

        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
            if (useOtlp) logging.AddOtlpExporter();
        });

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(r => r.AddService("steamforge-api"))
            .WithTracing(tracing =>
            {
                tracing.AddSource(GameTelemetry.SourceName)
                    .AddAspNetCoreInstrumentation(o => o.RecordException = true)
                    .AddHttpClientInstrumentation()
                    .AddEntityFrameworkCoreInstrumentation();
                if (useOtlp) tracing.AddOtlpExporter();
                if (useConsole) tracing.AddConsoleExporter();
            })
            .WithMetrics(metrics =>
            {
                metrics.AddMeter(GameTelemetry.SourceName, "System.Runtime")
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation();
                if (useOtlp) metrics.AddOtlpExporter();
                if (useConsole) metrics.AddConsoleExporter();
            });

        return builder;
    }
}
