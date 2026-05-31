import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs';
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
  'skills/browser/SKILL.md',
  'skills/pdf/SKILL.md',
  'skills/docx/SKILL.md',
  'skills/xlsx/SKILL.md',
  'skills/pptx/SKILL.md',
  'skills/data-analysis/SKILL.md',
  'skills/deep-research/SKILL.md',
  'skills/skill-installer/SKILL.md',
  'skills/skill-creator/SKILL.md',
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
  ...readTextFiles(path.join(templateRoot, 'skills')),
].join('\n');
assert.doesNotMatch(sources, /\b(?:sk-[A-Za-z0-9_-]{20,}|e2b_[A-Za-z0-9_-]{16,}|claude_[A-Za-z0-9_-]{20,}|anthropic_[A-Za-z0-9_-]{20,})\b/);
assert.doesNotMatch(sources, /BEGIN [A-Z ]*PRIVATE KEY/);

console.log('MyCC assistant sandbox local contract ok');

function readTextFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...readTextFiles(filePath));
      continue;
    }
    if (!isLikelyText(entry.name)) continue;
    output.push(readFileSync(filePath, 'utf8'));
  }
  return output;
}

function isLikelyText(fileName) {
  return /\.(md|txt|json|ya?ml|py|js|mjs|ts|tsx|html|css|csv|xml)$/i.test(fileName)
    || fileName === 'LICENSE';
}
