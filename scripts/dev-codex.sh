#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_URL="http://127.0.0.1:8081"
FRONTEND_URL="http://127.0.0.1:3001"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start local Postgres and Redis." >&2
  exit 127
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker, then rerun scripts/dev-codex.sh." >&2
  exit 1
fi

echo "[mycc] starting backend dependencies"
(cd "$ROOT_DIR/mycc-backend" && npm run dev:infra)

echo "[mycc] applying backend migrations"
(cd "$ROOT_DIR/mycc-backend" && npm run db:migrate)

echo "[mycc] backend:  $BACKEND_URL"
echo "[mycc] frontend: $FRONTEND_URL"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "${FRONTEND_PID:-}" ]; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if curl -fsS --max-time 2 "$BACKEND_URL/health" >/dev/null 2>&1; then
  echo "[mycc] backend already running; reusing $BACKEND_URL"
else
  (cd "$ROOT_DIR/mycc-backend" \
    && MYCC_AGENT_RUNTIME="${MYCC_AGENT_RUNTIME:-e2b-claude-agent-sdk}" \
      MYCC_IDE_PROVIDER="${MYCC_IDE_PROVIDER:-e2b}" \
      MYCC_WORKSPACE_PROVIDER="${MYCC_WORKSPACE_PROVIDER:-e2b}" \
      MYCC_AGENT_RUN_STORE="${MYCC_AGENT_RUN_STORE:-postgres}" \
      PORT=8081 npm run dev) &
  BACKEND_PID=$!
fi

if curl -fsSI --max-time 2 "$FRONTEND_URL/" >/dev/null 2>&1; then
  echo "[mycc] frontend already running; reusing $FRONTEND_URL"
else
  (cd "$ROOT_DIR/mycc-web-react" && npm run dev:codex) &
  FRONTEND_PID=$!
fi

if [ -z "${BACKEND_PID:-}" ] && [ -z "${FRONTEND_PID:-}" ]; then
  echo "[mycc] services are already running"
  exit 0
fi

echo "[mycc] services started; press Ctrl+C to stop"
while true; do
  if [ -n "${BACKEND_PID:-}" ] && ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    break
  fi
  if [ -n "${FRONTEND_PID:-}" ] && ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

wait ${BACKEND_PID:-} ${FRONTEND_PID:-}
