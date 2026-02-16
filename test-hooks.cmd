@echo off
REM Test script to verify hooks are working
echo Testing PreToolUse hook: smart-memory-search
echo.
C:\Users\wannago\.ralph\.claude\hooks\smart-memory-search.cmd
echo.
echo Testing PostToolUse hook: plan-sync-post-step
echo.
C:\Users\wannago\.ralph\.claude\hooks\plan-sync-post-step.cmd
echo.
echo Testing missing hooks (should output allow JSON):
echo.
C:\Users\wannago\.ralph\.claude\hooks\pre-commit-command-validation.cmd
echo.
C:\Users\wannago\.ralph\.claude\hooks\post-commit-command-verify.cmd
echo.
pause
