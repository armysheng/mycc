#!/bin/bash
# Windows-compatible wrapper for ralph SessionStart hooks
# Provides default JSON input if stdin is empty

DEFAULT_INPUT='{"source":"startup","session_id":"unknown","hook_event_name":"SessionStart"}'
HOOK_SCRIPT="$1"
shift

# Try to read from stdin with timeout
INPUT=$(timeout 0.1 cat 2>/dev/null || true)

if [ -z "$INPUT" ]; then
    # No stdin data, use default
    echo "$DEFAULT_INPUT" | bash "$HOOK_SCRIPT" "$@"
else
    # Has stdin data, pipe through
    echo "$INPUT" | bash "$HOOK_SCRIPT" "$@"
fi
