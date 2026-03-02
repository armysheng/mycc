import * as fs from 'fs';
import * as path from 'path';
import type { SkillDefinition } from './types.js';

export const SKILL_REGISTRY: SkillDefinition[] = [
  // ── 内置技能 (8) ──────────────────────────────────────────
  {
    id: 'tell-me',
    name: '飞书通知',
    description: '总结对话并推送到飞书群',
    trigger: '/tell-me',
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
    id: 'browser',
    name: '浏览器',
    description: '打开网页、截图、填表、提取内容',
    trigger: '/browser',
    icon: '🌐',
    category: 'builtin',
    builtin: true,
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
    icon: '📄',
    category: 'builtin',
    builtin: true,
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
    icon: '📊',
    category: 'builtin',
    builtin: true,
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
    icon: '📈',
    category: 'builtin',
    builtin: true,
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
    icon: '📝',
    category: 'builtin',
    builtin: true,
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
    icon: '📦',
    category: 'builtin',
    builtin: true,
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
    icon: '🔧',
    category: 'devtools',
    builtin: false,
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
    icon: '📉',
    category: 'research',
    builtin: false,
    readiness: 'L1',
    deps: [],
    riskLevel: 'low',
    defaultEnabled: true,
    owner: 'system',
    mdPath: 'data-analysis/SKILL.md',
    source_url: 'https://github.com/openai/skills/tree/main/skills/.curated/spreadsheet',
    origin_type: 'community',
    validation_note: '参考 OpenAI Codex spreadsheet skill 实现',
    last_verified_at: '2026-03-02',
  },
  {
    id: 'deep-research',
    name: '深度调研',
    description: '格式可控的研究报告生成，含证据追踪、引用和多轮审阅',
    trigger: '/deep-research',
    icon: '🔬',
    category: 'research',
    builtin: false,
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

export function getSkillsByCategory(category: string): SkillDefinition[] {
  return SKILL_REGISTRY.filter(s => s.category === category);
}

export function getReadySkills(): SkillDefinition[] {
  return SKILL_REGISTRY.filter(s => s.readiness === 'L1');
}

export function getIconForSkill(id: string): string {
  return getSkillById(id)?.icon ?? '⚡';
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
