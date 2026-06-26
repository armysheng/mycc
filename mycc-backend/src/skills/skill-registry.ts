import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import type { SkillDefinition } from './types.js';

const runtimeCatalogDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog');
const assistantSkillNameCache = new Map<string, string>();

export const SKILL_REGISTRY: SkillDefinition[] = [
  // ── 内置技能 (9) ──────────────────────────────────────────
  {
    id: 'tell-me',
    name: '飞书通知',
    description: '总结对话并推送到飞书群',
    trigger: '/tell-me',
    triggers: ['/tell-me', '通知我', '飞书通知', '告诉我'],
    icon: '💬',
    category: 'builtin',
    builtin: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'tell-me/SKILL.md',
    source_url: '',
    origin_type: 'internal-verified',
    validation_note: 'MyCC 原创技能，从 .claude/skills/tell-me 迁入',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'scheduler',
    name: '定时任务',
    description: '定时执行任务（提醒、汇总）',
    trigger: '/scheduler',
    triggers: ['/scheduler', '定时任务', '启动定时', '查看定时'],
    icon: '⏰',
    category: 'builtin',
    builtin: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'scheduler/SKILL.md',
    source_url: '',
    origin_type: 'internal-verified',
    validation_note: 'MyCC 原创技能，从 .claude/skills/scheduler 迁入',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'browser-use',
    name: '可见浏览器自动化',
    description: '在 MyCC 右侧 CC 电脑里打开、检查、登录和自动操作网页',
    trigger: '/browser-use',
    triggers: ['/browser-use', '打开网页', '访问网站', '浏览器', '可见浏览器'],
    icon: '🌐',
    category: 'builtin',
    builtin: true,
    preloadInImage: true,
    imageRequired: true,
    readiness: 'L1',
    deps: ['browser-use', 'playwright', 'chromium'],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'browser-use/SKILL.md',
    source_url: '',
    origin_type: 'internal-verified',
    validation_note: 'MyCC assistant sandbox 原创技能，约束可见浏览器和 browser-use 运行方式',
    last_verified_at: '2026-06-02',
  },
  {
    id: 'browser',
    name: '浏览器',
    description: '打开网页、截图、填表、提取内容',
    trigger: '/browser',
    triggers: ['/browser', '浏览器', '打开网页', '网页测试'],
    icon: '🌐',
    category: 'builtin',
    builtin: true,
    preloadInImage: true,
    imageRequired: true,
    readiness: 'L1',
    deps: ['playwright'],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'browser/SKILL.md',
    source_url: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing',
    origin_type: 'community',
    validation_note: '基于 anthropics/skills webapp-testing 改造，非同名',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'pdf',
    name: 'PDF 工具',
    description: 'PDF 文档读取、提取、摘要与转换',
    trigger: '/pdf',
    triggers: ['/pdf', 'PDF', '读取PDF', 'PDF转换'],
    icon: '📄',
    category: 'builtin',
    builtin: true,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'pdf/SKILL.md',
    source_url: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
    origin_type: 'official',
    validation_note: '1:1 clone from anthropics/skills',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'pptx',
    name: 'PPT 工具',
    description: '创建、编辑和分析演示文稿',
    trigger: '/pptx',
    triggers: ['/pptx', 'PPT', '演示文稿', '做幻灯片'],
    icon: '📊',
    category: 'builtin',
    builtin: true,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'pptx/SKILL.md',
    source_url: 'https://github.com/anthropics/skills/tree/main/skills/pptx',
    origin_type: 'official',
    validation_note: '1:1 clone from anthropics/skills',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'xlsx',
    name: '表格工具',
    description: '电子表格创建、数据分析与可视化',
    trigger: '/xlsx',
    triggers: ['/xlsx', '表格', 'Excel', '电子表格'],
    icon: '📈',
    category: 'builtin',
    builtin: true,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'xlsx/SKILL.md',
    source_url: 'https://github.com/anthropics/skills/tree/main/skills/xlsx',
    origin_type: 'official',
    validation_note: '1:1 clone from anthropics/skills',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'docx',
    name: '文档工具',
    description: 'Word 文档创建、编辑与格式化',
    trigger: '/docx',
    triggers: ['/docx', 'Word文档', '写文档', '编辑文档'],
    icon: '📝',
    category: 'builtin',
    builtin: true,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'docx/SKILL.md',
    source_url: 'https://github.com/anthropics/skills/tree/main/skills/docx',
    origin_type: 'official',
    validation_note: '1:1 clone from anthropics/skills',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'skill-installer',
    name: '技能安装器',
    description: '从策展仓库安装社区技能',
    trigger: '/skill-installer',
    triggers: ['/skill-installer', '安装技能', '添加技能', '技能安装'],
    icon: '📦',
    category: 'builtin',
    builtin: true,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'skill-installer/SKILL.md',
    source_url: 'https://github.com/openai/skills/tree/main/skills/.system/skill-installer',
    origin_type: 'community',
    validation_note: '参考 OpenAI Codex skill-installer 实现，非同名 1:1',
    last_verified_at: '2026-03-02',
  },

  // ── 市场技能 (3) ────────────────────────────────────────────
  {
    id: 'skill-creator',
    name: '技能创建',
    description: '引导创建自定义技能',
    trigger: '/skill-creator',
    triggers: ['/skill-creator', '创建技能', '写技能', '自定义技能'],
    icon: '🔧',
    category: 'devtools',
    builtin: false,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'skill-creator/SKILL.md',
    source_url: 'https://github.com/anthropics/skills/tree/main/skills/skill-creator',
    origin_type: 'official',
    validation_note: '1:1 clone from anthropics/skills',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'data-analysis',
    name: '数据分析',
    description: 'CSV/表格数据分析 + 可视化',
    trigger: '/data-analysis',
    triggers: ['/data-analysis', '数据分析', '分析数据', '可视化数据'],
    icon: '📉',
    category: 'research',
    builtin: false,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'data-analysis/SKILL.md',
    source_url: '',
    origin_type: 'internal-verified',
    validation_note: 'Vendored spreadsheet/data-analysis skill; public upstream URL is no longer available, locally verified in catalog',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'deep-research',
    name: '深度调研',
    description: '格式可控的研究报告生成，含证据追踪、引用和多轮审阅',
    trigger: '/deep-research',
    triggers: ['/deep-research', '深度调研', '研究报告', '资料调研'],
    icon: '🔬',
    category: 'research',
    builtin: false,
    preloadInImage: true,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'deep-research/SKILL.md',
    source_url: 'https://github.com/daymade/claude-code-skills/tree/main/deep-research',
    origin_type: 'community',
    validation_note: '完整 clone from daymade/claude-code-skills，含 5 个 references 文件',
    last_verified_at: '2026-03-02',
  },
];

export function getBuiltinSkills(): SkillDefinition[] {
  return SKILL_REGISTRY.filter(s => s.builtin);
}

export function getMarketSkills(): SkillDefinition[] {
  return SKILL_REGISTRY.filter(s => !s.builtin);
}

export function getSkillById(id: string): SkillDefinition | undefined {
  return SKILL_REGISTRY.find(s => s.id === id);
}

export function getAssistantSkillNameForSkill(id: string): string {
  const cached = assistantSkillNameCache.get(id);
  if (cached) {
    return cached;
  }

  const skill = getSkillById(id);
  const resolved = skill ? readAssistantSkillName(skill) : id;
  assistantSkillNameCache.set(id, resolved);
  return resolved;
}

export function getSkillByAssistantSkillName(name: string): SkillDefinition | undefined {
  return SKILL_REGISTRY.find((skill) =>
    skill.id === name || getAssistantSkillNameForSkill(skill.id) === name
  );
}

export function getSkillsByCategory(category: string): SkillDefinition[] {
  return SKILL_REGISTRY.filter(s => s.category === category);
}

export function getReadySkills(): SkillDefinition[] {
  return SKILL_REGISTRY.filter(s => s.readiness === 'L1');
}

export function getImagePreloadSkills(): SkillDefinition[] {
  return SKILL_REGISTRY.filter(s => s.preloadInImage);
}

export function getIconForSkill(id: string): string {
  return getSkillById(id)?.icon ?? '⚡';
}

export function getTriggersForSkill(id: string, fallbackTrigger?: string, fallbackTriggers?: unknown): string[] {
  const registrySkill = getSkillById(id);
  const rawTriggers = registrySkill?.triggers || normalizeUnknownTriggers(fallbackTriggers);
  const trigger = registrySkill?.trigger || fallbackTrigger || `/${id}`;
  return Array.from(new Set([trigger, ...rawTriggers].map((item) => item.trim()).filter(Boolean)));
}

export function getImageMetadataForSkill(id: string): Pick<SkillDefinition, 'preloadInImage' | 'imageRequired'> {
  const registrySkill = getSkillById(id);
  return {
    preloadInImage: Boolean(registrySkill?.preloadInImage),
    imageRequired: Boolean(registrySkill?.imageRequired),
  };
}

export function getVersionForSkill(id: string): string {
  return getSkillById(id)?.version ?? '1.0.0';
}

function normalizeUnknownTriggers(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is string => typeof item === 'string');
  }
  if (typeof input === 'string') {
    return [input];
  }
  return [];
}

function readAssistantSkillName(skill: SkillDefinition): string {
  const mdFile = path.join(runtimeCatalogDir, skill.mdPath);
  try {
    const content = fs.readFileSync(mdFile, 'utf8');
    const parsed = extractFrontmatterName(content);
    if (parsed && isValidAssistantSkillName(parsed)) {
      return parsed;
    }
  } catch {
    // Registry id remains a safe fallback when the catalog file is not available.
  }
  return skill.id;
}

function extractFrontmatterName(content: string): string | null {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const nameMatch = line.match(/^name:\s*(.+?)\s*$/);
    if (!nameMatch) continue;
    return nameMatch[1].replace(/^["']|["']$/g, '').trim() || null;
  }
  return null;
}

function isValidAssistantSkillName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export function validateRegistry(catalogBasePath: string): string[] {
  const errors: string[] = [];
  for (const skill of SKILL_REGISTRY) {
    const mdFile = path.join(catalogBasePath, skill.mdPath);
    if (!fs.existsSync(mdFile)) {
      errors.push(`[MISSING] ${skill.id}: ${mdFile}`);
    }
  }
  return errors;
}
