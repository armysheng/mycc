import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..');
const catalogRoot = process.env.MYCC_SKILL_CATALOG_ROOT
  || path.join(repoRoot, 'mycc-backend/src/skills/catalog');
const targetRoot = process.env.MYCC_SANDBOX_SKILLS_ROOT
  || path.join(root, 'templates/e2b-assistant-sandbox/skills');
const preloadManifestPath = process.env.MYCC_IMAGE_PRELOAD_MANIFEST
  || path.join(repoRoot, 'mycc-backend/src/skills/image-preload-skills.json');

const preloadManifest = readJsonFile(preloadManifestPath);
const preloadSkills = normalizePreloadSkills(preloadManifest);
const baseSkillSet = new Set(preloadSkills.map((skill) => skill.id));

mkdirSync(targetRoot, { recursive: true });
removeStaleSkillDirs(targetRoot, baseSkillSet);

for (const skill of preloadSkills) {
  const source = path.join(catalogRoot, skill.id);
  const target = path.join(targetRoot, skill.id);
  if (skill.source === 'sandbox') {
    if (!existsSync(path.join(target, 'SKILL.md'))) {
      throw new Error(`Missing sandbox skill: ${skill.id}`);
    }
    stripTrailingWhitespace(target);
    continue;
  }

  if (!existsSync(path.join(source, 'SKILL.md'))) {
    throw new Error(`Missing catalog skill: ${skill.id}`);
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

writeFileSync(
  path.join(targetRoot, '.mycc-preload-skills.json'),
  `${JSON.stringify({
    version: 1,
    source: path.relative(repoRoot, preloadManifestPath),
    skills: preloadSkills,
  }, null, 2)}\n`
);

console.log(`[ok] synced ${preloadSkills.length} registry preload skills into assistant sandbox`);

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizePreloadSkills(manifest) {
  if (!manifest || !Array.isArray(manifest.skills)) {
    throw new Error(`Invalid image preload manifest: ${preloadManifestPath}`);
  }

  const seen = new Set();
  const skills = [];
  for (const skill of manifest.skills) {
    const id = skill?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid image preload skill id: ${String(id)}`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const source = skill?.source ?? 'catalog';
    if (source !== 'catalog' && source !== 'sandbox') {
      throw new Error(`Invalid image preload skill source for ${id}: ${String(source)}`);
    }
    skills.push({ id, source });
  }
  return skills;
}

function removeStaleSkillDirs(directory, allowedIds) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(directory, entry.name);
    if (allowedIds.has(entry.name) || !existsSync(path.join(skillDir, 'SKILL.md'))) {
      continue;
    }
    rmSync(skillDir, { recursive: true, force: true });
  }
}

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
