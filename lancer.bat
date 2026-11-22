@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installez Node.js 22.5 ou plus. & pause & exit /b 1)
if not exist "node_modules" call npm install
start "" http://localhost:3000
node server\index.js
pause
