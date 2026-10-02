#!/usr/bin/env bash
# Adds an EF Core migration for both database providers.
# Usage: scripts/add-migration.sh <MigrationName>
set -euo pipefail
name="${1:?Usage: scripts/add-migration.sh <MigrationName>}"
cd "$(dirname "$0")/.."
project=src/SF.Application
dotnet ef migrations add "$name" --project "$project" --context SqliteAppDbContext --output-dir Migrations/Sqlite
dotnet ef migrations add "$name" --project "$project" --context PostgresAppDbContext --output-dir Migrations/Postgres
