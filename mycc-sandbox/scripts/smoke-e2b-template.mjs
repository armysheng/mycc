#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Sandbox } from 'e2b';

const root = path.resolve(import.meta.dirname, '..');
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.resolve(root, '..', 'mycc-backend', '.env'));

const templateName = process.env.MYCC_SANDBOX_TEMPLATE || 'mycc-assistant-sandbox-dev';
const apiKey = process.env.MYCC_E2B_API_KEY || process.env.E2B_API_KEY;

if (!apiKey) {
  console.error('[error] Missing MYCC_E2B_API_KEY or E2B_API_KEY. Value hidden when present.');
  process.exit(1);
}

let sandbox;

try {
  console.log('[run] create-sandbox');
  sandbox = await Sandbox.create(templateName, {
    apiKey,
    timeoutMs: 10 * 60 * 1000,
    metadata: {
      app: 'mycc',
      capability: 'assistant-sandbox-smoke',
    },
    network: {
      allowPublicTraffic: false,
    },
  });
  console.log('[ok] create-sandbox');

  await runChecked('full-contract', '/opt/mycc/contracts/template-contract.sh --full', {
    timeoutMs: 180_000,
  });

  await runBackground('code-server-start', 'mycc-start-code-server', {
    cwd: '/home/mycc/workspace',
    timeoutMs: 10_000,
  });
  await waitFor('code-server-health', 'curl -fsS http://127.0.0.1:18080/healthz >/dev/null', {
    timeoutMs: 120_000,
  });

  await runBackground('desktop-start', 'mycc-start-desktop', {
    timeoutMs: 10_000,
  });
  await waitFor('desktop-health', 'mycc-health-desktop >/dev/null', {
    timeoutMs: 120_000,
  });

  await runChecked('desktop-browser-only-mode', [
    'for _ in $(seq 1 30); do',
    '  pgrep -af "[x]fwm4" >/dev/null',
    '  has_wm="$?"',
    '  pgrep -af "[c]hromium.*--password-store=basic.*--remote-debugging-address=127.0.0.1.*--remote-debugging-port=9222" >/dev/null',
    '  has_browser="$?"',
    '  curl -fsS http://127.0.0.1:9222/json/version >/dev/null',
    '  has_cdp="$?"',
    '  pgrep -af "[x]fce4-panel" >/dev/null',
    '  has_panel="$?"',
    '  if [ "$has_wm" -eq 0 ] && [ "$has_browser" -eq 0 ] && [ "$has_cdp" -eq 0 ] && [ "$has_panel" -ne 0 ]; then exit 0; fi',
    '  sleep 1',
    'done',
    'pgrep -af "[x]fwm4|[c]hromium|[x]fce4-panel" >&2 || true',
    'exit 1',
  ].join('\n'), {
    timeoutMs: 60_000,
  });

  await runChecked('desktop-browser-open', [
    'export DISPLAY=:99',
    'export MYCC_DESKTOP_CHROMIUM_PROFILE=/tmp/mycc-desktop/chromium-profile-smoke',
    'export MYCC_DESKTOP_BROWSER_WINDOW_SIZE=1360,820',
    'export MYCC_DESKTOP_BROWSER_CDP_PORT=9233',
    'mkdir -p "$MYCC_DESKTOP_CHROMIUM_PROFILE"',
    'timeout 30s exo-open --launch WebBrowser about:blank >/tmp/mycc-desktop/xfce-web-browser-smoke.log 2>&1',
    'for _ in $(seq 1 30); do pgrep -af "[c]hromium.*--password-store=basic.*--remote-debugging-port=9233.*chromium-profile-smoke" >/dev/null && curl -fsS http://127.0.0.1:9233/json/version >/dev/null && exit 0; sleep 1; done',
    'cat /tmp/mycc-desktop/xfce-web-browser-smoke.log >&2',
    'exit 1',
  ].join('; '), {
    timeoutMs: 60_000,
  });

  await runChecked('browser-automation', `timeout 60s /opt/mycc/browser-agent/venv/bin/python - <<'PY'
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page()
    page.set_content("<title>mycc smoke</title>")
    assert page.title() == "mycc smoke"
    browser.close()

print("mycc-playwright-ok")
PY`, {
    timeoutMs: 70_000,
  });

  console.log('[ok] e2b-template-smoke');
} catch (error) {
  console.error(`[error] ${sanitize(String(error instanceof Error ? error.message : error))}`);
  process.exitCode = 1;
} finally {
  if (sandbox) {
    try {
      await sandbox.kill();
      console.log('[ok] cleanup');
    } catch {
      console.error('[warn] cleanup failed');
      process.exitCode = process.exitCode || 1;
    }
  }
}

async function runBackground(label, command, options = {}) {
  await sandbox.commands.run(command, {
    ...options,
    background: true,
  });
  console.log(`[ok] ${label}`);
}

async function runChecked(label, command, options = {}) {
  const result = await runForeground(command, options);

  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit ${result.exitCode}: ${resultSummary(result)}`);
  }

  console.log(`[ok] ${label}`);
  return result;
}

async function waitFor(label, command, { timeoutMs, intervalMs = 2_000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;

  while (Date.now() < deadline) {
    lastResult = await runForeground(command, { timeoutMs: 5_000 });

    if (lastResult.exitCode === 0) {
      console.log(`[ok] ${label}`);
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(`${label} timed out: ${resultSummary(lastResult)}`);
}

async function runForeground(command, options = {}) {
  let stdout = '';
  let stderr = '';

  try {
    const result = await sandbox.commands.run(command, {
      ...options,
      background: false,
      onStdout: (data) => {
        stdout += data;
      },
      onStderr: (data) => {
        stderr += data;
      },
    });

    return {
      ...result,
      stdout: result.stdout || stdout,
      stderr: result.stderr || stderr,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout,
      stderr,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resultSummary(result) {
  if (!result) return 'no command result';
  const source = result.stderr || result.error || result.stdout || '';
  return sanitize(source).split(/\r?\n/).filter(Boolean).slice(-12).join(' | ') || 'no output';
}

function sanitize(value) {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/g, '[redacted-url]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|e2b_[A-Za-z0-9_-]{16,}|claude_[A-Za-z0-9_-]{20,}|anthropic_[A-Za-z0-9_-]{20,})\b/g, '[redacted-secret]');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const source = readFileSync(filePath, 'utf8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
