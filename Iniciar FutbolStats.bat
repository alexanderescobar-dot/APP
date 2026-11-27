@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instala Node.js y vuelve a intentar.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Creando archivo .env...
  (
    echo FOOTBALL_DATA_TOKEN=PEGA_AQUI_TU_TOKEN
    echo PORT=3002
  ) > .env
  echo.
  echo Abre .env y pega tu token de football-data.org donde dice PEGA_AQUI_TU_TOKEN.
  notepad .env
)
echo Iniciando servidor FutbolStats...
start "FutbolStats Server" cmd /k "cd /d ""%~dp0"" && npm.cmd start"
echo Esperando servidor...
timeout /t 3 /nobreak >nul
start "" "http://localhost:3002"
echo.
echo La pagina se abrira en tu navegador. No cierres la ventana "FutbolStats Server" mientras la uses.
echo Para cerrar, cierra esa ventana o presiona Ctrl+C en ella.
pause
