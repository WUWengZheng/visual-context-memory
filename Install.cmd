@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto no_node
node scripts\setup.mjs %*
set "VCM_INSTALL_STATUS=%ERRORLEVEL%"
goto done
:no_node
echo Please install Node.js 24+ from https://nodejs.org and open this installer again.
set "VCM_INSTALL_STATUS=1"
:done
pause
exit /b %VCM_INSTALL_STATUS%
