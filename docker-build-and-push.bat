@echo off
setlocal

set REGISTRY=docker-registry.sockless.local
set IMAGE=steamforge
set TAG=latest
set FULL_IMAGE=%REGISTRY%/%IMAGE%:%TAG%

cd /d "%~dp0"

echo ========================================
echo  Building and publishing Docker image
echo  Image: %FULL_IMAGE%
echo ========================================
echo.

echo [1/4] Pulling latest base images...
docker pull node:22-alpine || goto :pull_fail
docker pull mcr.microsoft.com/dotnet/sdk:10.0 || goto :pull_fail
docker pull mcr.microsoft.com/dotnet/aspnet:10.0 || goto :pull_fail

echo.
echo [2/4] Building Docker image...
set DOCKER_BUILDKIT=1
docker build -t %FULL_IMAGE% .
if errorlevel 1 (
    echo ERROR: Docker build failed.
    pause
    exit /b 1
)

echo.
echo [3/4] Pushing to registry %REGISTRY%...
docker push %FULL_IMAGE%
if errorlevel 1 (
    echo ERROR: Failed to push image.
    pause
    exit /b 1
)

echo.
echo [4/4] Done! Image published: %FULL_IMAGE%
echo ========================================
pause
exit /b 0

:pull_fail
echo ERROR: Failed to pull base images.
pause
exit /b 1
