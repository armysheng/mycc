import { RemoteSkillStore } from './remote-skill-store.js';
import { SkillsService } from './skills-service.js';
import type { ISkillsService } from './contracts.js';

export function createSkillsService(): ISkillsService {
  return new SkillsService(new RemoteSkillStore());
}

export * from './types.js';
export * from './contracts.js';
export * from './errors.js';

