import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const templateRoot = path.join(root, 'templates/e2b-assistant-sandbox');

const templateRequired = [
  'Dockerfile',
  'template.ts',
  'contracts/template-contract.sh',
  'bin/mycc-start-code-server',
  'bin/mycc-start-ccr',
  'bin/mycc-start-desktop',
  'bin/mycc-health-desktop',
  'scripts/agent-sdk-bridge.mjs',
  'skills/browser-use/SKILL.md',
];

const rootRequired = [
  'scripts/smoke-e2b-template.mjs',
];

for (const relativePath of templateRequired) {
  const filePath = path.join(templateRoot, relativePath);
  assert.ok(existsSync(filePath), `${relativePath} is missing`);
}

for (const relativePath of rootRequired) {
  const filePath = path.join(root, relativePath);
  assert.ok(existsSync(filePath), `${relativePath} is missing`);
}

for (const relativePath of [
  'contracts/template-contract.sh',
  'bin/mycc-start-code-server',
  'bin/mycc-start-ccr',
  'bin/mycc-start-desktop',
  'bin/mycc-health-desktop',
]) {
  accessSync(path.join(templateRoot, relativePath), constants.X_OK);
}

const sources = [
  ...templateRequired.map((relativePath) => readFileSync(path.join(templateRoot, relativePath), 'utf8')),
  ...rootRequired.map((relativePath) => readFileSync(path.join(root, relativePath), 'utf8')),
].join('\n');
assert.doesNotMatch(sources, /\b(?:sk-[A-Za-z0-9_-]{20,}|e2b_[A-Za-z0-9_-]{16,}|claude_[A-Za-z0-9_-]{20,}|anthropic_[A-Za-z0-9_-]{20,})\b/);
assert.doesNotMatch(sources, /BEGIN [A-Z ]*PRIVATE KEY/);

console.log('MyCC assistant sandbox local contract ok');
