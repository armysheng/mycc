import { SKILL_REGISTRY } from '../src/skills/skill-registry.js';

const errors: string[] = [];

for (const skill of SKILL_REGISTRY) {
  if (!skill.origin_type) {
    errors.push(`[${skill.id}] 缺少 origin_type`);
  }
  if (!skill.last_verified_at) {
    errors.push(`[${skill.id}] 缺少 last_verified_at`);
  }
  if (skill.origin_type !== 'internal-verified') {
    if (!skill.source_url || skill.source_url.trim() === '') {
      errors.push(`[${skill.id}] origin_type="${skill.origin_type}" 但 source_url 为空`);
    }
  }
  if (!skill.validation_note || skill.validation_note.trim() === '') {
    errors.push(`[${skill.id}] 缺少 validation_note`);
  }
}

if (errors.length > 0) {
  console.error('❌ Skill provenance validation failed:\n');
  errors.forEach(e => console.error(`  ${e}`));
  process.exit(1);
} else {
  console.log(`✅ All ${SKILL_REGISTRY.length} skills passed provenance validation.`);
}
