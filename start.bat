@echo off
set PORT=8080

echo Killing any process using port %PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') do (
    taskkill /f /pid %%a 2>nul
)

echo Building frontend...
cd /d "%~dp0frontend"
call npm run build
xcopy /s /y /q dist "..\backend\dist\" > nul

echo Building backend...
cd /d "%~dp0backend"
go build -o goflow.exe .

echo.
echo Starting GoFlow at http://localhost:8080
start "" http://localhost:8080
goflow.exe
