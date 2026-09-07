@echo off
setlocal

cd /d "%~dp0"
title Travel Agent

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22 or later.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js 22 or later.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [ERROR] Dependencies are missing. Run npm install first.
  pause
  exit /b 1
)

if not exist "mcp-servers\deepseek-web-search\.venv\Scripts\deepseek-web-search-mcp.exe" (
  echo [WARN] DeepSeek Search MCP is not provisioned.
  echo [WARN] The app can start, but SRC_SEARCH will stay unavailable.
  echo [WARN] Run: cd mcp-servers\deepseek-web-search ^&^& uv sync --frozen
  echo.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-existing-travel-agent-dev.ps1" -ProjectRoot "%~dp0."
if errorlevel 1 (
  echo [ERROR] The previous Travel Agent development instance could not be stopped safely.
  pause
  exit /b 1
)

echo Starting Travel Agent from current source...
echo [INFO] Project: %CD%
echo [INFO] UI: electron-vite development renderer
echo.
call npm run dev
set "START_EXIT_CODE=%ERRORLEVEL%"

if not "%START_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Travel Agent exited with code %START_EXIT_CODE%.
  pause
)

exit /b %START_EXIT_CODE%
