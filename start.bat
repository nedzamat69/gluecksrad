@echo off
setlocal

REM In den server-Ordner wechseln (relativ zum .bat Speicherort)
cd /d "%~dp0server"

REM Server starten (öffnet ein eigenes Fenster, damit das Script weiterläuft)
start "Wheel Server" cmd /k npm start

REM Kurz warten, damit der Server hochfährt (2 Sekunden)
timeout /t 2 /nobreak >nul

REM Browser öffnen
start "" "http://localhost:3000/"

endlocal
