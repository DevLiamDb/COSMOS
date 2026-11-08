@echo off
rem COSMOS Manager: keeps the web app and MCP server on, manages storage.
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" manager\cosmos_manager.py %*
) else (
  python manager\cosmos_manager.py %*
)
