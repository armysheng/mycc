import { SKILL_REGISTRY } from '../src/skills/skill-registry.js';

const errors: string[] = [];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_TIMEOUT_MS = 8000;

function isValidDateFormat(value: string): boolean {
  return DATE_RE.test(value);
}

async function isUrlReachable(url: string): Promise<boolean> {
  const tryRequest = async (method: 'HEAD' | 'GET'): Promise<Response | null> => {
    try {
      return await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  };

  const headRes = await tryRequest('HEAD');
  if (headRes && headRes.ok) return true;
  if (headRes && headRes.status !== 405 && headRes.status !== 501) return false;

  const getRes = await tryRequest('GET');
  return Boolean(getRes && getRes.ok);
}

async function main(): Promise<void> {
  for (const skill of SKILL_REGISTRY) {
    if (!skill.origin_type) {
      errors.push(`[${skill.id}] 缺少 origin_type`);
    }

    if (!skill.last_verified_at) {
      errors.push(`[${skill.id}] 缺少 last_verified_at`);
    } else if (!isValidDateFormat(skill.last_verified_at)) {
      errors.push(`[${skill.id}] last_verified_at 格式错误，应为 YYYY-MM-DD`);
    }

    if (skill.origin_type !== 'internal-verified') {
      if (!skill.source_url || skill.source_url.trim() === '') {
        errors.push(`[${skill.id}] origin_type="${skill.origin_type}" 但 source_url 为空`);
      } else {
        const reachable = await isUrlReachable(skill.source_url);
        if (!reachable) {
          errors.push(`[${skill.id}] source_url 不可达: ${skill.source_url}`);
        }
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
}

void main();
