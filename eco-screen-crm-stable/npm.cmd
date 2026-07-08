@echo off
setlocal
set "NODE_EXE=C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
if "%1"=="run" (
  if "%2"=="lint" "%NODE_EXE%" scripts\lint.js
  if "%2"=="build" "%NODE_EXE%" scripts\build.js
  if "%2"=="test:workflow" "%NODE_EXE%" scripts\workflow-test.js
  if "%2"=="dev" "%NODE_EXE%" scripts\dev-server.js
  exit /b %ERRORLEVEL%
)
echo Supported commands: npm.cmd run lint, npm.cmd run build, npm.cmd run test:workflow, npm.cmd run dev
exit /b 1
