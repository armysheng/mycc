import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..');
const catalogRoot = path.join(repoRoot, 'mycc-backend/src/skills/catalog');
const targetRoot = path.join(root, 'templates/e2b-assistant-sandbox/skills');

const baseSkillIds = [
  'browser',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'data-analysis',
  'deep-research',
  'skill-installer',
  'skill-creator',
];

for (const skillId of baseSkillIds) {
  const source = path.join(catalogRoot, skillId);
  const target = path.join(targetRoot, skillId);
  if (!existsSync(path.join(source, 'SKILL.md'))) {
    throw new Error(`Missing catalog skill: ${skillId}`);
  }

  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, {
    recursive: true,
    filter: (sourcePath) => {
      const relative = path.relative(source, sourcePath);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      return !parts.includes('node_modules')
        && !parts.includes('.git')
        && !parts.includes('__pycache__')
        && !relative.endsWith('.pyc');
    },
  });
  stripTrailingWhitespace(target);
}

console.log(`[ok] synced ${baseSkillIds.length} base skills into assistant sandbox`);

function stripTrailingWhitespace(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      stripTrailingWhitespace(filePath);
      continue;
    }
    if (!isTextFile(entry.name)) continue;

    const original = readFileSync(filePath, 'utf8');
    const cleaned = original.replace(/[ \t]+$/gm, '');
    if (cleaned !== original) {
      writeFileSync(filePath, cleaned);
    }
  }
}

function isTextFile(fileName) {
  return /\.(css|csv|html|js|json|md|mjs|py|svg|ts|tsx|txt|xml|xsd|ya?ml)$/i.test(fileName)
    || fileName === 'LICENSE';
}
