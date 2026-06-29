@echo off
cd /d "%~dp0.."

if not exist node_modules (
  echo Installing dependencies...
  npm install
)

if "%SEED_DEMO_DATA%"=="1" (
  echo Seeding database...
  node database\seed.js
)

echo Starting ERO System on http://localhost:3000
node server.js
