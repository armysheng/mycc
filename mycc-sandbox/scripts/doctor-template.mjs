import { accessSync, constants, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const templateRoot = path.join(root, 'templates/e2b-assistant-sandbox');
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.resolve(root, '..', 'mycc-backend', '.env'));

const templateName = process.env.MYCC_SANDBOX_TEMPLATE || 'mycc-assistant-sandbox-dev';

const checks = [];

function add(status, label, detail = '') {
  checks.push({ status, label, detail });
}

for (const relativePath of [
  'Dockerfile',
  'template.ts',
  'contracts/template-contract.sh',
  'bin/mycc-start-code-server',
  'bin/mycc-start-ccr',
  'bin/mycc-start-desktop',
  'bin/mycc-health-desktop',
]) {
  const filePath = path.join(templateRoot, relativePath);
  add(existsSync(filePath) ? 'ok' : 'error', `file:${relativePath}`);
}

for (const relativePath of [
  'contracts/template-contract.sh',
  'bin/mycc-start-code-server',
  'bin/mycc-start-ccr',
  'bin/mycc-start-desktop',
  'bin/mycc-health-desktop',
]) {
  try {
    accessSync(path.join(templateRoot, relativePath), constants.X_OK);
    add('ok', `executable:${relativePath}`);
  } catch {
    add('error', `executable:${relativePath}`, 'Run chmod +x on the sandbox service scripts.');
  }
}

const npx = spawnSync('npx', ['--version'], { encoding: 'utf8' });
add(npx.status === 0 ? 'ok' : 'error', 'npx', npx.status === 0 ? '' : 'npx is required for E2B CLI template creation.');

const hasCliToken = Boolean(process.env.E2B_ACCESS_TOKEN);
const hasApiKey = Boolean(process.env.MYCC_E2B_API_KEY || process.env.E2B_API_KEY);
if (hasCliToken || hasApiKey) {
  add('ok', 'e2b-credentials', 'Credential env is present; value hidden.');
} else {
  add('warn', 'e2b-credentials', 'Set E2B_ACCESS_TOKEN for template:create or MYCC_E2B_API_KEY for runtime checks.');
}

if (hasApiKey) {
  try {
    const { Template } = await import('e2b');
    const apiKey = process.env.MYCC_E2B_API_KEY || process.env.E2B_API_KEY;
    const exists = await Template.exists(templateName, { apiKey });
    add(exists ? 'ok' : 'warn', 'e2b-template-exists', exists ? `Template ${templateName} exists.` : `Template ${templateName} was not found.`);
  } catch (error) {
    add('warn', 'e2b-template-exists', `Could not query E2B template state: ${error instanceof Error ? error.message : String(error)}`);
  }
} else {
  add('skip', 'e2b-template-exists', 'No E2B API key provided.');
}

for (const check of checks) {
  const suffix = check.detail ? ` - ${check.detail}` : '';
  console.log(`[${check.status}] ${check.label}${suffix}`);
}

if (checks.some((check) => check.status === 'error')) {
  process.exitCode = 1;
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
