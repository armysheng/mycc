import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getImagePreloadSkills, getReadySkills, getTriggersForSkill } from './skill-registry.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const catalogRoot = path.join(currentDir, 'catalog');
const imagePreloadManifestPath = path.join(currentDir, 'image-preload-skills.json');

describe('skill registry image preload contract', () => {
  it('exposes the skill set that must be preloaded into the assistant image', () => {
    const preloadSkills = getImagePreloadSkills();

    expect(new Set(preloadSkills.map((skill) => skill.id))).toEqual(new Set([
      'browser-use',
      'browser',
      'pdf',
      'docx',
      'xlsx',
      'pptx',
      'data-analysis',
      'deep-research',
      'skill-installer',
      'skill-creator',
    ]));

    for (const skill of preloadSkills) {
      expect(skill.preloadInImage).toBe(true);
      expect(fs.existsSync(path.join(catalogRoot, skill.mdPath))).toBe(true);
    }
  });

  it('keeps the sandbox preload manifest in sync with the registry', () => {
    const manifest = JSON.parse(fs.readFileSync(imagePreloadManifestPath, 'utf8')) as {
      skills: Array<{ id: string }>;
    };

    expect(new Set(manifest.skills.map((skill) => skill.id))).toEqual(
      new Set(getImagePreloadSkills().map((skill) => skill.id))
    );
  });

  it('gives every ready skill both slash and natural language triggers', () => {
    for (const skill of getReadySkills()) {
      const triggers = getTriggersForSkill(skill.id);

      expect(triggers).toContain(skill.trigger);
      expect(triggers.some((trigger) => trigger.startsWith('/'))).toBe(true);
      expect(
        triggers.some((trigger) => !trigger.startsWith('/') && trigger.trim().length >= 2),
      ).toBe(true);
    }
  });
});
