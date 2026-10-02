@echo off
rem Builds the client into the backend's wwwroot, then runs the backend (SQLite) at http://localhost:5220.
setlocal
set "ROOT=%~dp0"

pushd "%ROOT%src\SF.Client" || goto :fail
if not exist node_modules (
  echo Installing client dependencies...
  call npm install || goto :fail_pop
)
echo Building client...
call npm run build || goto :fail_pop
popd

echo Building backend...
dotnet build "%ROOT%SF.slnx" || goto :fail

echo Starting backend at http://localhost:5220 ...
dotnet run --no-build --project "%ROOT%src\SF.Application" --launch-profile http
goto :eof

:fail_pop
popd
:fail
echo.
echo Build failed.
pause
exit /b 1
