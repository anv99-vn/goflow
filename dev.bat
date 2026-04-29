@echo off
echo Starting GoFlow Development Environment...

:: Start Backend in a new window
echo Starting Backend...
start "GoFlow Backend" cmd /c "run_backend.bat"

:: Wait a moment for backend to initialize
timeout /t 2 /nobreak > nul

:: Start Frontend in a new window
echo Starting Frontend...
start "GoFlow Frontend" cmd /c "run_frontend.bat"

echo.
echo Both services are starting in separate windows.
echo Backend: http://localhost:8080
echo Frontend: http://localhost:5173 (or as shown in frontend window)
pause
