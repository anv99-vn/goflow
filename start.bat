@echo off
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
