@echo off
set PORT=8080

echo Killing any process using port %PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') do (
    taskkill /f /pid %%a 2>nul
)

echo Starting Backend...
cd /d "%~dp0backend"
go run main.go
