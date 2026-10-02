# Multi-stage build: the Vite client is compiled into the ASP.NET Core app's wwwroot, then published.

FROM node:22-alpine AS client
WORKDIR /src/src/SF.Client
COPY src/SF.Client/package.json src/SF.Client/package-lock.json ./
RUN npm ci
COPY src/SF.Client/ ./
# Vite writes to ../SF.Application/wwwroot.
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /src
COPY SF.slnx ./
COPY src/SF.Application/ src/SF.Application/
COPY --from=client /src/src/SF.Application/wwwroot src/SF.Application/wwwroot
RUN dotnet publish src/SF.Application/SF.Application.csproj -c Release -o /app --nologo

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=server /app ./
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "SF.Application.dll"]
