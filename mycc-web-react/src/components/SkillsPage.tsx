import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BoltIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CloudArrowDownIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PuzzlePieceIcon,
  RectangleGroupIcon,
  ShieldCheckIcon,
  TagIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "./layout/Sidebar";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { InlineAlert } from "./ui/InlineAlert";
import { useAuth } from "../contexts/AuthContext";
import {
	  installSkill,
	  listSkills,
	  uninstallSkill,
	  updateSkill,
	  useSkill as recordSkillUse,
  type SkillActionResult,
  type SkillDetailResult,
  type SkillDebugSnapshot,
  type SkillInstallResult,
  type SkillItem,
  getSkillDebugSnapshot,
  getSkillDetail,
} from "../api/skills";
import { PRODUCT_COPY, toUserFacingSkillCopy } from "../utils/productCopy";

const CATEGORY_OPTIONS = [
  { key: "all", label: "全部", icon: PuzzlePieceIcon },
  { key: "browser", label: "浏览器", icon: RectangleGroupIcon },
  { key: "document", label: "文档", icon: DocumentTextIcon },
  { key: "data", label: "数据", icon: ChartBarIcon },
  { key: "develop", label: "开发", icon: CodeBracketIcon },
] as const;

type CategoryKey = (typeof CATEGORY_OPTIONS)[number]["key"];
type ViewKey = "market" | "installed";
type DetailTabKey =
  | "content"
  | "usage"
  | "examples"
  | "prompts"
  | "permissions"
  | "versions";

const DETAIL_TABS: Array<{ key: DetailTabKey; label: string }> = [
  { key: "usage", label: "使用指引" },
  { key: "examples", label: "示例场景" },
  { key: "prompts", label: "快捷提示词" },
  { key: "content", label: "能力说明" },
  { key: "permissions", label: "使用要求" },
  { key: "versions", label: "版本信息" },
];

const SHOW_SKILLS_DEBUG = import.meta.env.DEV;

type SkillActionMessage = {
  text: string;
  trialSkill?: SkillItem;
  skillName?: string;
};

function isRetryableLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("请求超时") ||
    error.message.includes("连接超时") ||
    error.message.includes("Not connected")
  );
}

function sourceLabel(source: string) {
  if (source === "catalog") return "官方技能库";
  if (source === "registry") return "远程技能库";
  if (source === "user") return "用户添加";
  return source || "未知来源";
}

function visibleTriggers(skill: SkillItem) {
  return skill.triggers?.length ? skill.triggers : [skill.trigger];
}

function skillDisplayName(skill: SkillItem) {
  return toUserFacingSkillCopy(skill.name || skill.id);
}

function skillDisplayDescription(skill: SkillItem) {
  return skill.description ? toUserFacingSkillCopy(skill.description) : "";
}

function skillCategory(skill: SkillItem): CategoryKey {
  const text = [
    skill.id,
    skill.name,
    skill.description,
    skill.trigger,
    ...visibleTriggers(skill),
  ]
    .join(" ")
    .toLowerCase();
  if (/(browser|browse|web|网页|网站|浏览器)/i.test(text)) return "browser";
  if (/(pdf|doc|word|document|文档|知识|读取|ppt|xlsx|excel)/i.test(text))
    return "document";
  if (/(data|csv|table|sheet|chart|数据|表格|可视化|分析)/i.test(text))
    return "data";
  if (/(code|dev|cli|api|debug|test|qa|开发|代码|运行|解释器|检查|诊断|creator|installer)/i.test(text))
    return "develop";
  return "all";
}

function categoryLabel(skill: SkillItem) {
  const labels: Record<string, string> = {
    builtin: "内置",
    productivity: "效率",
    content: "内容",
    learning: "学习",
    lifestyle: "生活",
    devtools: "开发",
    research: "研究",
  };
  return (
    labels[skill.category || ""] ||
    CATEGORY_OPTIONS.find((item) => item.key === skillCategory(skill))?.label ||
    "技能"
  );
}

function matchesSearch(skill: SkillItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    skill.id,
    skill.name,
    skillDisplayName(skill),
    skill.description,
    skillDisplayDescription(skill),
    skill.owner || "",
    categoryLabel(skill),
    ...visibleTriggers(skill),
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function categoryMatches(skill: SkillItem, activeCategory: CategoryKey) {
  if (activeCategory === "all") return true;
  return skillCategory(skill) === activeCategory;
}

function formatCompactNumber(value: number | undefined) {
  const normalized = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("zh-CN", {
    notation: normalized >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(normalized);
}

function formatSkillMetric(value: number | undefined) {
  if (!Number.isFinite(value) || Number(value) <= 0) return "暂无";
  return formatCompactNumber(Number(value));
}

function formatVersion(skill: SkillItem) {
  if (
    skill.installedVersion &&
    skill.installedVersion !== skill.latestVersion
  ) {
    return `${skill.installedVersion} -> ${skill.latestVersion}`;
  }
  return skill.installedVersion || skill.latestVersion || skill.version || "-";
}

function formatDate(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function skillRuntimeLabel(skill: SkillItem) {
  if (skill.preloadInImage) return "已预置";
  if (skill.imageRequired) return "专用环境";
  return "标准技能";
}

function skillDependencyLabel(skill: SkillItem, detail: SkillDetailResult | null) {
  if (skill.imageRequired) return "需要专用能力支持";
  if (detail?.definition?.deps?.length) return "已内置所需工具";
  return "无需额外准备";
}

function skillScopeLabel(riskLevel: "low" | "medium" | "high" | undefined) {
  if (riskLevel === "high") return "包含高影响操作";
  if (riskLevel === "medium") return "可能操作项目文件或网页";
  return "常规辅助任务";
}

function skillValidationLabel(detail: SkillDetailResult | null) {
  const verifiedAt = formatDate(detail?.definition?.lastVerifiedAt);
  if (verifiedAt !== "-") return `${verifiedAt} 已完成检查`;
  return "已完成基础检查";
}

function skillLibraryRoot() {
  return PRODUCT_COPY.assistantSkillLibrary;
}

function skillLibraryPath(skillName: string) {
  return `${PRODUCT_COPY.assistantSkillLibrary}/${skillName}`;
}

function popularityScore(skill: SkillItem) {
  const stats = skill.stats;
  return (
    (stats?.downloads ?? 0) +
    (stats?.uses ?? 0) * 0.7 +
    (stats?.installs ?? 0) * 2
  );
}

function sortSkills(skills: SkillItem[]) {
  return [...skills].sort((a, b) => {
    if (a.installed !== b.installed)
      return Number(b.installed) - Number(a.installed);
    return popularityScore(b) - popularityScore(a);
  });
}

function authorLabel(skill: SkillItem) {
  if (skill.owner === "system") return "MyCC";
  return skill.owner || sourceLabel(skill.source);
}

function skillLabels(skill: SkillItem) {
  return [
    categoryLabel(skill),
    skill.preloadInImage ? "预置可用" : null,
    skill.imageRequired ? "需要专用环境" : null,
    ...visibleTriggers(skill).slice(0, 2).map(toUserFacingSkillCopy),
  ].filter(Boolean) as string[];
}

function skillUsageExamples(skill: SkillItem) {
  const description = skillDisplayDescription(skill) || skillDisplayName(skill);
  return visibleTriggers(skill)
    .slice(0, 4)
    .map((trigger) => `${toUserFacingSkillCopy(trigger)} ${description}`);
}

function skillOutcome(skill: SkillItem) {
  const displayName = skillDisplayName(skill);
  const category = skillCategory(skill);
  if (skill.id === "browser-use") {
    return "在右侧助理浏览器里打开网页、检查流程、协助登录和自动操作";
  }
  if (skill.id === "deep-research") {
    return "把一个问题整理成带证据、引用和审阅过程的研究报告";
  }
  if (skill.id === "skill-creator") {
    return "把常用工作方式沉淀成可复用的新技能";
  }
  if (category === "browser") {
    return "打开网页、截图、填表、提取页面信息";
  }
  if (category === "document") {
    return "读取、创建、编辑和整理文档内容";
  }
  if (category === "data") {
    return "分析表格数据，生成摘要、图表和趋势判断";
  }
  if (category === "develop") {
    return "处理开发、检查、脚本和工具配置任务";
  }
  return skillDisplayDescription(skill) || `调用 ${displayName} 处理专项任务`;
}

function skillTrialPrompt(skill: SkillItem) {
  const trigger = visibleTriggers(skill)[0] || skill.trigger || `/${skill.id}`;
  const category = skillCategory(skill);
  if (skill.id === "browser-use") {
    return `${trigger} 打开官网，检查登录流程是否正常`;
  }
  if (skill.id === "deep-research") {
    return `${trigger} 帮我调研这个主题，并输出带引用的结论`;
  }
  if (skill.id === "skill-creator") {
    return `${trigger} 帮我把这个重复流程做成一个技能`;
  }
  if (category === "browser") {
    return `${trigger} 打开这个页面并总结主要信息`;
  }
  if (category === "document") {
    return `${trigger} 读取这份文档并总结重点`;
  }
  if (category === "data") {
    return `${trigger} 分析这份表格并给出趋势判断`;
  }
  if (category === "develop") {
    return `${trigger} 帮我检查这个工具流程`;
  }
  return `${trigger} ${skillDisplayDescription(skill) || "帮我完成这个任务"}`;
}

function runtimeUnavailableActionLabel(
  action: "install" | "upgrade" | "uninstall",
  displayName: string,
) {
  const verb =
    action === "install" ? "添加" : action === "upgrade" ? "更新" : "移除";
  return `等待环境，暂不能${verb} ${displayName}`;
}

function SkillGlyph({ skill }: { skill: SkillItem }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-subtle)] text-2xl text-[var(--accent)] shadow-[var(--shadow-sm)]"
    >
      {skill.icon || <PuzzlePieceIcon className="h-5 w-5" />}
    </span>
  );
}

function StatusPill({ skill }: { skill: SkillItem }) {
  if (skill.installed && skill.upgradable) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
        <ArrowPathIcon className="h-3 w-3" />
        可更新
      </span>
    );
  }
  if (skill.installed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
        <CheckCircleIcon className="h-3 w-3" />
        已启用
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
      可添加
    </span>
  );
}

type SkillCardProps = {
  skill: SkillItem;
  mode: ViewKey;
  processing: boolean;
  runtimeReady: boolean;
  onInstall: (skill: SkillItem) => void;
  onUpgrade: (skill: SkillItem) => void;
  onUse: (skill: SkillItem) => void;
  onUninstall: (skill: SkillItem) => void;
  onOpenDetails: (skill: SkillItem) => void;
};

function SkillCard({
  skill,
  mode,
  processing,
  runtimeReady,
  onInstall,
  onUpgrade,
  onUse,
  onUninstall,
  onOpenDetails,
}: SkillCardProps) {
  const labels = skillLabels(skill);
  const displayName = skillDisplayName(skill);
  const description = skillDisplayDescription(skill);
  const outcome = skillOutcome(skill);
  const trialPrompt = skillTrialPrompt(skill);
  const actionDisabled = processing || !runtimeReady;

  return (
    <article className="flex min-h-[258px] flex-col rounded-lg border panel-surface p-3.5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <SkillGlyph skill={skill} />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">
              {displayName}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              作者 {authorLabel(skill)}
            </p>
          </div>
        </div>
        <StatusPill skill={skill} />
      </div>

      <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-[var(--text-secondary)]">
        {description || "暂无说明"}
      </p>

      <div className="mt-3 space-y-2 border-t border-[var(--surface-border)] pt-3">
        <p className="line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
          <span className="mr-1 inline-flex items-center gap-1 font-semibold text-[var(--text-primary)]">
            <BoltIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
            可完成
          </span>
          {outcome}
        </p>
        <p className="line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
          <span className="mr-1 font-semibold text-[var(--text-secondary)]">
            试试
          </span>
          {trialPrompt}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {labels.slice(0, 4).map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
          >
            <TagIcon className="h-3 w-3" />
            {label}
          </span>
        ))}
      </div>

      <div className="mt-auto pt-4">
        <div className="mb-3 grid grid-cols-3 gap-2 text-xs text-[var(--text-muted)]">
          <div>
            <div className="font-semibold text-[var(--text-primary)]">
              {formatVersion(skill)}
            </div>
            <div>版本</div>
          </div>
          <div>
            <div className="font-semibold text-[var(--text-primary)]">
              {formatSkillMetric(
                skill.stats?.downloads ?? skill.stats?.installs,
              )}
            </div>
            <div>下载</div>
          </div>
          <div>
            <div className="font-semibold text-[var(--text-primary)]">
              {formatSkillMetric(skill.stats?.uses)}
            </div>
            <div>使用</div>
          </div>
        </div>

        {mode === "market" ? (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button
              type="button"
              aria-label={`查看 ${displayName} 详情`}
              onClick={() => onOpenDetails(skill)}
              className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
            >
              详情
            </button>
            {skill.installed ? (
              skill.upgradable ? (
                <button
                  type="button"
                  aria-label={
                    runtimeReady
                      ? `更新 ${displayName}`
                      : runtimeUnavailableActionLabel("upgrade", displayName)
                  }
                  onClick={() => onUpgrade(skill)}
                  disabled={actionDisabled}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  {!runtimeReady ? "需环境" : processing ? "更新中..." : "更新"}
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`已启用 ${displayName}`}
                  disabled
                  className="inline-flex items-center justify-center gap-2 rounded-lg border bg-[var(--bg-elevated)] px-3 py-2 text-sm font-semibold text-[var(--text-muted)]"
                >
                  <CheckCircleIcon className="h-4 w-4" />
                  已启用
                </button>
              )
            ) : (
              <button
                type="button"
                aria-label={
                  runtimeReady
                    ? `添加 ${displayName}`
                    : runtimeUnavailableActionLabel("install", displayName)
                }
                onClick={() => onInstall(skill)}
                disabled={actionDisabled}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--text-inverse)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                <CloudArrowDownIcon className="h-4 w-4" />
                {!runtimeReady ? "需环境" : processing ? "添加中..." : "添加"}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2">
            <button
              type="button"
              aria-label={`立即使用 ${displayName}`}
              onClick={() => onUse(skill)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--text-inverse)] hover:bg-[var(--accent-hover)]"
            >
              <PlayIcon className="h-4 w-4" />
              立即使用
            </button>
            {skill.upgradable && (
              <button
                type="button"
                aria-label={
                  runtimeReady
                    ? `更新 ${displayName}`
                    : runtimeUnavailableActionLabel("upgrade", displayName)
                }
                onClick={() => onUpgrade(skill)}
                disabled={actionDisabled}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <ArrowPathIcon className="h-4 w-4" />
                {runtimeReady ? "更新" : "需环境"}
              </button>
            )}
            <button
              type="button"
              aria-label={`查看 ${displayName} 详情`}
              onClick={() => onOpenDetails(skill)}
              className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
            >
              详情
            </button>
            <button
              type="button"
              aria-label={
                runtimeReady
                  ? `移除 ${displayName}`
                  : runtimeUnavailableActionLabel("uninstall", displayName)
              }
              onClick={() => onUninstall(skill)}
              disabled={processing || !runtimeReady}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/10"
            >
              <TrashIcon className="h-4 w-4" />
              {runtimeReady ? "移除" : "需环境"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function CapabilityOverview({
  skills,
  onUse,
  onOpenDetails,
  compact = false,
}: {
  skills: SkillItem[];
  onUse: (skill: SkillItem) => void;
  onOpenDetails: (skill: SkillItem) => void;
  compact?: boolean;
}) {
  const installedSkills = sortSkills(skills.filter((skill) => skill.installed));
  const availableSkills = sortSkills(skills.filter((skill) => !skill.installed));
  const featured = installedSkills.slice(0, compact ? 2 : 3);

  if (installedSkills.length === 0) return null;

  return (
    <section className="rounded-lg border panel-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            已拥有的能力
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            你的助理已经能处理这些任务，可以直接从这里试一条指令。
          </p>
        </div>
        {!compact && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs text-[var(--text-muted)] sm:min-w-[320px]">
            <div className="rounded-md border bg-[var(--bg-elevated)] px-3 py-2">
              <div className="text-base font-semibold text-[var(--text-primary)]">
                {installedSkills.length}
              </div>
              <div>已启用</div>
            </div>
            <div className="rounded-md border bg-[var(--bg-elevated)] px-3 py-2">
              <div className="text-base font-semibold text-[var(--text-primary)]">
                {availableSkills.length}
              </div>
              <div>可添加</div>
            </div>
            <div className="rounded-md border bg-[var(--bg-elevated)] px-3 py-2">
              <div className="text-base font-semibold text-[var(--text-primary)]">
                {formatCompactNumber(
                  skills.reduce(
                    (sum, skill) => sum + (skill.stats?.uses ?? 0),
                    0,
                  ),
                )}
              </div>
              <div>使用</div>
            </div>
          </div>
        )}
      </div>

      {featured.length > 0 && (
        <div
          className={`mt-4 grid gap-3 ${
            compact ? "lg:grid-cols-2" : "lg:grid-cols-3"
          }`}
        >
          {featured.map((skill) => (
            <div
              key={skill.id}
              className="flex min-w-0 flex-col gap-3 rounded-md border bg-[var(--bg-elevated)]/50 p-3"
            >
              <div className="flex items-center gap-3">
                <SkillGlyph skill={skill} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {skillDisplayName(skill)}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {skill.installed ? "已启用" : "可添加"} · {categoryLabel(skill)}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                {skillOutcome(skill)}
              </p>
              <p className="line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
                试试：{skillTrialPrompt(skill)}
              </p>
              <div className="mt-auto flex gap-2">
                {skill.installed && (
                  <button
                    type="button"
                    onClick={() => onUse(skill)}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-2 text-xs font-semibold text-[var(--text-inverse)] hover:bg-[var(--accent-hover)]"
                  >
                    <PlayIcon className="h-3.5 w-3.5" />
                    立即试用
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenDetails(skill)}
                  className="inline-flex h-8 flex-1 items-center justify-center rounded-md border px-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  查看用法
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type SkillDetailViewProps = {
  skill: SkillItem;
  detail: SkillDetailResult | null;
  detailLoading: boolean;
  detailError: string | null;
  activeTab: DetailTabKey;
  processing: boolean;
  runtimeReady: boolean;
  onBack: () => void;
  onRetry: () => void;
  onTabChange: (tab: DetailTabKey) => void;
  onInstall: (skill: SkillItem) => void;
  onUpgrade: (skill: SkillItem) => void;
  onUse: (skill: SkillItem) => void;
  onUninstall: (skill: SkillItem) => void;
};

function SkillDetailActions({
  skill,
  processing,
  runtimeReady,
  onInstall,
  onUpgrade,
  onUse,
  onUninstall,
}: Pick<
  SkillDetailViewProps,
  | "skill"
  | "processing"
  | "runtimeReady"
  | "onInstall"
  | "onUpgrade"
  | "onUse"
  | "onUninstall"
>) {
  const displayName = skillDisplayName(skill);

  if (!skill.installed) {
    return (
      <button
        type="button"
        aria-label={
          runtimeReady
            ? `添加 ${displayName}`
            : runtimeUnavailableActionLabel("install", displayName)
        }
        onClick={() => onInstall(skill)}
        disabled={processing || !runtimeReady}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--text-inverse)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        <CloudArrowDownIcon className="h-4 w-4" />
        {!runtimeReady ? "需环境" : processing ? "添加中..." : "添加"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {skill.upgradable && (
        <button
          type="button"
          aria-label={
            runtimeReady
              ? `更新 ${displayName}`
              : runtimeUnavailableActionLabel("upgrade", displayName)
          }
          onClick={() => onUpgrade(skill)}
          disabled={processing || !runtimeReady}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-amber-500 px-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          <ArrowPathIcon className="h-4 w-4" />
          {!runtimeReady ? "需环境" : processing ? "更新中..." : "更新"}
        </button>
      )}
      <button
        type="button"
        aria-label={
          runtimeReady
            ? `移除 ${displayName}`
            : runtimeUnavailableActionLabel("uninstall", displayName)
        }
        onClick={() => onUninstall(skill)}
        disabled={processing || !runtimeReady}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-400/10"
      >
        <TrashIcon className="h-4 w-4" />
        {runtimeReady ? "移除" : "需环境"}
      </button>
      <button
        type="button"
        onClick={() => onUse(skill)}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--text-inverse)] hover:bg-[var(--accent-hover)]"
      >
        <PlayIcon className="h-4 w-4" />
        立即使用
      </button>
    </div>
  );
}

function DetailMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]">
        {value || "-"}
      </div>
    </div>
  );
}

function SkillDetailTabContent({
  skill,
  detail,
  activeTab,
  runtimeReady,
}: {
  skill: SkillItem;
  detail: SkillDetailResult | null;
  activeTab: DetailTabKey;
  runtimeReady: boolean;
}) {
  const triggers = visibleTriggers(skill);
  const examples = skillUsageExamples(skill);
  const description = skillDisplayDescription(skill);

  if (activeTab === "content") {
    return (
      <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-md border bg-[var(--bg-page)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            能力概览
          </h3>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            {skillOutcome(skill)}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
            {description || "暂无更多说明"}
          </p>
        </section>
        <section className="rounded-md border bg-[var(--bg-page)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            适合场景
          </h3>
          <div className="mt-3 space-y-2">
            {examples.slice(0, 3).map((example) => (
              <p
                key={example}
                className="rounded-md bg-[var(--bg-elevated)] p-3 text-sm leading-6 text-[var(--text-secondary)]"
              >
                {example}
              </p>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (activeTab === "usage") {
    return (
      <div className="grid items-start gap-4 p-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <section className="rounded-md border bg-[var(--bg-page)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              能帮你完成
            </h3>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              {skillOutcome(skill)}
            </p>

            <h3 className="mt-5 text-sm font-semibold text-[var(--text-primary)]">
              触发方式
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {triggers.map((trigger) => (
                <code
                  key={trigger}
                  className="rounded-md border bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)]"
                >
                  {trigger}
                </code>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
              {description || "暂无说明"}
            </p>
          </section>
          <section className="rounded-md border bg-[var(--bg-page)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              推荐试用
            </h3>
            <p className="mt-3 rounded-md bg-[var(--bg-elevated)] p-3 text-sm leading-6 text-[var(--text-secondary)]">
              试试：{skillTrialPrompt(skill)}
            </p>
          </section>
        </div>
        <div className="space-y-4">
          <section className="rounded-md border bg-[var(--bg-page)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              上手路径
            </h3>
            <ol className="mt-3 space-y-3 text-sm leading-5 text-[var(--text-secondary)]">
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-[11px] font-semibold text-[var(--accent)]">
                  1
                </span>
                <span>
                  {skill.installed
                    ? `已在${PRODUCT_COPY.assistantSkillLibrary}中启用。`
                    : runtimeReady
                      ? `先添加到${PRODUCT_COPY.assistantSkillLibrary}。`
                      : `运行环境恢复后添加到${PRODUCT_COPY.assistantSkillLibrary}。`}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-[11px] font-semibold text-[var(--accent)]">
                  2
                </span>
                <span>在对话里输入触发词或自然描述任务。</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-[11px] font-semibold text-[var(--accent)]">
                  3
                </span>
                <span>cc 会按需调用技能，并把结果回到当前对话。</span>
              </li>
            </ol>
          </section>
          <section className="rounded-md border bg-[var(--bg-page)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              添加位置
            </h3>
            <p className="mt-3 rounded-md bg-[var(--bg-elevated)] p-3 font-mono text-xs leading-6 text-[var(--text-secondary)]">
              {skillLibraryPath(skill.assistantSkillName || skill.id)}
            </p>
            <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
              {skill.installed
                ? `已添加到${PRODUCT_COPY.assistantSkillLibrary}，cc 会在合适的对话中按需使用。`
                : runtimeReady
                  ? `添加后会进入${PRODUCT_COPY.assistantSkillLibrary}。`
                  : `当前只能浏览说明，运行环境恢复后会添加到${PRODUCT_COPY.assistantSkillLibrary}。`}
            </p>
          </section>
        </div>
      </div>
    );
  }

  if (activeTab === "examples" || activeTab === "prompts") {
    return (
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {examples.map((example, index) => (
          <div
            key={example}
            className="rounded-md border bg-[var(--bg-page)] p-4"
          >
            <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">
              {activeTab === "examples"
                ? `场景 ${index + 1}`
                : `提示词 ${index + 1}`}
            </div>
            <p className="text-sm leading-6 text-[var(--text-primary)]">
              {example}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (activeTab === "permissions") {
    return (
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <DetailMetaItem
          label="使用条件"
          value={skillDependencyLabel(skill, detail)}
        />
        <DetailMetaItem
          label="操作范围"
          value={skillScopeLabel(detail?.definition?.riskLevel)}
        />
        <DetailMetaItem
          label="默认状态"
          value={detail?.definition?.defaultEnabled ? "是" : "否"}
        />
        <DetailMetaItem
          label="能力准备"
          value={skillRuntimeLabel(skill)}
        />
        <DetailMetaItem label="来源" value={sourceLabel(skill.source)} />
        <DetailMetaItem
          label="检查状态"
          value={skillValidationLabel(detail)}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-3">
      <DetailMetaItem
        label="当前版本"
        value={skill.installedVersion || skill.version || "-"}
      />
      <DetailMetaItem label="最新版本" value={skill.latestVersion || "-"} />
      <DetailMetaItem
        label="版本状态"
        value={skill.upgradable ? "可更新" : "最新"}
      />
      <DetailMetaItem
        label="发布/验证日期"
        value={formatDate(detail?.definition?.lastVerifiedAt)}
      />
      <DetailMetaItem label="作者" value={authorLabel(skill)} />
      <DetailMetaItem label="来源说明" value={sourceLabel(skill.source)} />
    </div>
  );
}

function SkillDetailView({
  skill,
  detail,
  detailLoading,
  detailError,
  activeTab,
  processing,
  runtimeReady,
  onBack,
  onRetry,
  onTabChange,
  onInstall,
  onUpgrade,
  onUse,
  onUninstall,
}: SkillDetailViewProps) {
  const labels = skillLabels(skill);
  const displayName = skillDisplayName(skill);
  const description = skillDisplayDescription(skill);

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        返回{PRODUCT_COPY.assistantSkillLibrary}
      </button>

      <div className="rounded-lg border panel-surface shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-3">
              <SkillGlyph skill={skill} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                    {displayName}
                  </h2>
                  <StatusPill skill={skill} />
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  作者 {authorLabel(skill)} · {sourceLabel(skill.source)}
                </p>
              </div>
            </div>
            <p className="max-w-5xl text-sm leading-6 text-[var(--text-secondary)]">
              {description || "暂无说明"}
            </p>
          </div>
          <SkillDetailActions
            skill={skill}
            processing={processing}
            runtimeReady={runtimeReady}
            onInstall={onInstall}
            onUpgrade={onUpgrade}
            onUse={onUse}
            onUninstall={onUninstall}
          />
        </div>

        <div className="grid gap-4 border-t px-5 py-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailMetaItem label="技能分类" value={categoryLabel(skill)} />
          <DetailMetaItem label="最新版本" value={skill.latestVersion || "-"} />
          <DetailMetaItem
            label="添加状态"
            value={
              skill.installed
                ? `已添加到${PRODUCT_COPY.assistantSkillLibrary}`
                : "尚未添加"
            }
          />
          <DetailMetaItem
            label="最近验证"
            value={formatDate(detail?.definition?.lastVerifiedAt)}
          />
        </div>

        <div className="border-t px-5 py-3">
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-md border bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
              >
                <TagIcon className="h-3 w-3" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {detailError && (
        <InlineAlert severity="error" title="详情加载失败">
          <span>{detailError}</span>
          <button
            type="button"
            onClick={onRetry}
            className="ml-3 underline underline-offset-2"
          >
            重试
          </button>
        </InlineAlert>
      )}

      {!runtimeReady && (
        <InlineAlert severity="warning" title="技能运行环境未就绪">
          当前可以查看技能说明；添加、更新和移除会在运行环境恢复后可用。
        </InlineAlert>
      )}

      <div className="overflow-hidden rounded-lg border panel-surface shadow-[var(--shadow-sm)]">
        <div className="flex overflow-x-auto border-b px-4">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`relative whitespace-nowrap px-4 py-3 text-sm font-semibold ${
                activeTab === tab.key
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" />
              )}
            </button>
          ))}
          {detailLoading && (
            <div className="ml-auto flex items-center gap-2 whitespace-nowrap px-4 py-3 text-xs text-[var(--text-muted)]">
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              加载详情
            </div>
          )}
        </div>

        <SkillDetailTabContent
          skill={skill}
          detail={detail}
          activeTab={activeTab}
          runtimeReady={runtimeReady}
        />
      </div>
    </section>
  );
}

export function SkillsPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogAvailable, setCatalogAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<ViewKey>("market");
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("all");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] =
    useState<SkillActionMessage | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<SkillDebugSnapshot | null>(
    null,
  );
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetailResult | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] =
    useState<DetailTabKey>("usage");
  const [uninstallTarget, setUninstallTarget] = useState<SkillItem | null>(
    null,
  );

  const loadSkills = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      let data = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          data = await listSkills(token);
          break;
        } catch (e) {
          lastError = e;
          if (attempt === 0 && isRetryableLoadError(e)) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            continue;
          }
          throw e;
        }
      }

      if (!data) {
        throw lastError instanceof Error
          ? lastError
          : new Error("加载技能失败");
      }
      setCatalogAvailable(data.catalogAvailable);
      setSkills(data.skills || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载技能失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const callSkillAction = useCallback(
    async (skillId: string, action: "install" | "upgrade" | "uninstall") => {
      if (!token) return;
      if (!catalogAvailable) {
        setError("技能运行环境尚未就绪，请稍后重试");
        setActionMessage(null);
        return;
      }
      const actionSkill = skills.find((skill) => skill.id === skillId);
      const actionSkillName = actionSkill
        ? skillDisplayName(actionSkill)
        : skillId;
      setProcessingId(skillId);
      setError(null);
      setActionMessage(null);
      try {
        let result: SkillActionResult | SkillInstallResult;
        if (action === "install") {
          result = await installSkill(token, skillId);
        } else if (action === "upgrade") {
          result = await updateSkill(token, skillId);
        } else {
          result = await uninstallSkill(token, skillId);
        }

        if (
          (action === "install" || action === "upgrade") &&
          result.targetPath
        ) {
          setActionMessage({
            text:
              action === "upgrade"
                ? `已更新 ${actionSkillName}`
                : `已添加 ${actionSkillName}，已放入${PRODUCT_COPY.assistantSkillLibrary}`,
            trialSkill: actionSkill,
            skillName: actionSkillName,
          });
        }
        await loadSkills();
        if (selectedSkillId === skillId) {
          try {
            setSkillDetail(await getSkillDetail(token, skillId));
          } catch {
            setSkillDetail(null);
          }
        }
      } catch (e) {
        const actionLabel =
          action === "install"
            ? "添加"
            : action === "upgrade"
              ? "更新"
              : "移除";
        setError(e instanceof Error ? e.message : `${actionLabel}失败`);
      } finally {
        setProcessingId(null);
      }
    },
    [catalogAvailable, loadSkills, selectedSkillId, skills, token],
  );

  const confirmUninstall = useCallback(async () => {
    if (!uninstallTarget) return;
    const targetId = uninstallTarget.id;
    await callSkillAction(targetId, "uninstall");
    setUninstallTarget(null);
  }, [callSkillAction, uninstallTarget]);

  const handleUseSkill = useCallback(
    async (skill: SkillItem) => {
      if (token) {
	        try {
	          await recordSkillUse(token, skill.id);
        } catch {
          // 使用埋点失败不阻断跳转，用户的主动作是进入聊天试用。
        }
      }
      navigate("/", { state: { prefill: `${skill.trigger} ` } });
    },
    [navigate, token],
  );

  const loadDebugSnapshot = useCallback(async () => {
    if (!token) return;
    setDebugLoading(true);
    setDebugError(null);
    try {
      const snapshot = await getSkillDebugSnapshot(token);
      setDebugSnapshot(snapshot);
    } catch (e) {
      setDebugError(e instanceof Error ? e.message : "获取技能诊断信息失败");
    } finally {
      setDebugLoading(false);
    }
  }, [token]);

  const toggleDebugCenter = useCallback(() => {
    setDebugOpen((next) => {
      const willOpen = !next;
      if (willOpen && !debugSnapshot && !debugLoading) {
        void loadDebugSnapshot();
      }
      return willOpen;
    });
  }, [debugLoading, debugSnapshot, loadDebugSnapshot]);

  const loadSkillDetail = useCallback(
    async (skillId: string) => {
      if (!token) return;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const detail = await getSkillDetail(token, skillId);
        setSkillDetail(detail);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : "获取技能详情失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  const openSkillDetail = useCallback(
    (skill: SkillItem) => {
      setSelectedSkillId(skill.id);
      setSkillDetail(null);
      setDetailError(null);
      setActiveDetailTab("usage");
      void loadSkillDetail(skill.id);
    },
    [loadSkillDetail],
  );

  const closeSkillDetail = useCallback(() => {
    setSelectedSkillId(null);
    setSkillDetail(null);
    setDetailError(null);
  }, []);

  const visibleSkills = useMemo(() => {
    const base =
      activeView === "market"
        ? skills
        : skills.filter((skill) => skill.installed);
    return sortSkills(
      base
        .filter((skill) => categoryMatches(skill, activeCategory))
        .filter((skill) => matchesSearch(skill, query)),
    );
  }, [activeCategory, activeView, query, skills]);

  const selectedSkill = useMemo(() => {
    if (!selectedSkillId) return null;
    return (
      skillDetail?.skill ||
      skills.find((skill) => skill.id === selectedSkillId) ||
      null
    );
  }, [selectedSkillId, skillDetail, skills]);

  const viewTitle =
    activeView === "market"
      ? PRODUCT_COPY.availableSkills
      : PRODUCT_COPY.enabledSkills;
  const viewSubtitle =
    activeView === "market"
      ? `浏览技能市场；已启用的技能会保留状态，未启用的可以添加到${PRODUCT_COPY.assistantSkillLibrary}。`
      : `管理已经启用的技能，cc 会在合适的对话中使用它们。`;
  const showCapabilityOverview =
    !selectedSkill && !loading && activeView === "installed";
  const assistantSkillRoot = skillLibraryRoot();

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar
        onNewChat={() => navigate("/")}
        isOpen={false}
        onClose={() => {}}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 sm:p-6">
          <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                <PuzzlePieceIcon className="h-3.5 w-3.5" />
                {PRODUCT_COPY.assistantSkillLibrary}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
                {PRODUCT_COPY.assistantSkillLibrary}
              </h1>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
	                给 cc 添加可用能力；添加后进入{" "}
	                <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-xs">
	                  {assistantSkillRoot}
	                </code>
                ，已启用的技能会在对话中按需使用。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SHOW_SKILLS_DEBUG && (
                <button
                  type="button"
                  onClick={toggleDebugCenter}
                  className="inline-flex items-center gap-2 rounded-lg border panel-surface px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-[var(--shadow-sm)] hover:bg-[var(--bg-hover)]"
                >
                  <WrenchScrewdriverIcon className="h-4 w-4" />
                  技能诊断
                </button>
              )}
              <button
                type="button"
                onClick={loadSkills}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border panel-surface px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-[var(--shadow-sm)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
              >
                <ArrowPathIcon
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                刷新
              </button>
            </div>
          </header>

          {!selectedSkill && (
            <section className="rounded-lg border panel-surface p-3 shadow-[var(--shadow-sm)]">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="inline-flex w-full rounded-lg border bg-[var(--bg-elevated)] p-1 xl:w-auto">
                  <button
                    type="button"
                    onClick={() => setActiveView("market")}
                    aria-pressed={activeView === "market"}
                    className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition xl:flex-none ${
                      activeView === "market"
                        ? "bg-[var(--accent)] text-[var(--text-inverse)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {PRODUCT_COPY.availableSkills}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveView("installed")}
                    aria-pressed={activeView === "installed"}
                    className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition xl:flex-none ${
                      activeView === "installed"
                        ? "bg-[var(--accent)] text-[var(--text-inverse)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {PRODUCT_COPY.enabledSkills}
                  </button>
                </div>

                <label className="relative block min-w-[260px] flex-1">
                  <span className="sr-only">搜索技能</span>
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                      activeView === "market"
                        ? "搜索技能、作者、标签或触发词"
                        : "搜索我的技能"
                    }
                    className="w-full rounded-lg border bg-[var(--bg-input)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition focus:ring-2 focus:ring-[var(--accent)]/35"
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((option) => {
                  const CategoryIcon = option.icon;
                  const active = activeCategory === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setActiveCategory(option.key)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--text-inverse)]"
                          : "panel-surface text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <CategoryIcon className="h-4 w-4" />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-col gap-2 rounded-md border bg-[var(--bg-elevated)]/45 px-3 py-2 text-xs text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
                <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                  <ShieldCheckIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
	                  添加位置
	                  <code className="font-mono text-[var(--text-secondary)]">
	                    {skillLibraryPath("{skillName}")}
	                  </code>
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 font-medium ${
                    catalogAvailable
                      ? "text-emerald-600 dark:text-emerald-300"
                      : "text-amber-600 dark:text-amber-300"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {catalogAvailable ? "运行环境已连接" : "当前只读浏览"}
                </span>
              </div>
              </section>
            )}

          {error && (
            <InlineAlert severity="error" title="系统错误">
              {error}
            </InlineAlert>
          )}
          {!selectedSkill && !loading && !error && !catalogAvailable && (
            <InlineAlert severity="warning" title="技能运行环境未就绪">
              可以先浏览技能说明；添加、更新和移除会在运行环境恢复后可用。
            </InlineAlert>
          )}
          {actionMessage && (
            <InlineAlert severity="success">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{actionMessage.text}</span>
                {actionMessage.trialSkill && actionMessage.skillName && (
                  <button
                    type="button"
                    aria-label={`立即试用 ${actionMessage.skillName}`}
                    onClick={() => handleUseSkill(actionMessage.trialSkill!)}
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <PlayIcon className="h-3.5 w-3.5" />
                    立即试用
                  </button>
                )}
              </div>
            </InlineAlert>
          )}

          {selectedSkill ? (
            <SkillDetailView
              skill={selectedSkill}
              detail={skillDetail}
              detailLoading={detailLoading}
              detailError={detailError}
              activeTab={activeDetailTab}
              processing={processingId === selectedSkill.id}
              runtimeReady={catalogAvailable}
              onBack={closeSkillDetail}
              onRetry={() => {
                if (selectedSkillId) void loadSkillDetail(selectedSkillId);
              }}
              onTabChange={setActiveDetailTab}
              onInstall={(item) => callSkillAction(item.id, "install")}
              onUpgrade={(item) => callSkillAction(item.id, "upgrade")}
              onUse={handleUseSkill}
              onUninstall={(item) => setUninstallTarget(item)}
            />
          ) : (
            <section>
              <div className="mb-3">
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                  {viewTitle}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {viewSubtitle}
                </p>
              </div>

              {showCapabilityOverview && (
                <div className="mb-4">
                  <CapabilityOverview
                    skills={skills}
                    onUse={handleUseSkill}
                    onOpenDetails={openSkillDetail}
                  />
                </div>
              )}

              {loading ? (
                <div className="rounded-lg border panel-surface p-6 text-sm text-[var(--text-muted)]">
                  加载中...
                </div>
              ) : visibleSkills.length === 0 ? (
                <div className="rounded-lg border border-dashed panel-surface p-8 text-center text-sm text-[var(--text-muted)]">
                  {query.trim() || activeCategory !== "all"
                    ? "当前筛选下没有结果，可以换个关键词或分类。"
                    : activeView === "market"
                      ? "技能市场暂无更多技能。"
                      : "暂无我的技能。"}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {visibleSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      mode={activeView}
                      processing={processingId === skill.id}
                      runtimeReady={catalogAvailable}
                      onInstall={(item) => callSkillAction(item.id, "install")}
                      onUpgrade={(item) => callSkillAction(item.id, "upgrade")}
                      onUse={handleUseSkill}
                      onUninstall={(item) => setUninstallTarget(item)}
                      onOpenDetails={openSkillDetail}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {SHOW_SKILLS_DEBUG && !selectedSkill && debugOpen && (
            <section className="rounded-lg border panel-surface p-4 shadow-[var(--shadow-sm)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">技能诊断</h2>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    查看 catalog、添加状态、版本、触发词和统计状态
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadDebugSnapshot}
                  disabled={debugLoading}
                  className="inline-flex items-center gap-2 rounded-lg border panel-surface px-3 py-1.5 text-sm disabled:opacity-60"
                >
                  <ArrowPathIcon
                    className={`h-4 w-4 ${debugLoading ? "animate-spin" : ""}`}
                  />
                  {debugLoading ? "刷新中..." : "刷新诊断"}
                </button>
              </div>

              {debugError && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                  {debugError}
                </div>
              )}

              {debugSnapshot && (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4 xl:grid-cols-7">
                    <div className="rounded-lg border px-3 py-2">
                      {debugSnapshot.catalogAvailable
                        ? "Catalog 可用"
                        : "Catalog 不可用"}
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      已启用 {debugSnapshot.installedCount}
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      可添加 {debugSnapshot.marketCount}
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      可用 {debugSnapshot.availableCount}
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      可更新 {debugSnapshot.upgradableCount}
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      预置可用 {debugSnapshot.imagePreloadCount}
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      专用环境 {debugSnapshot.imageRequiredCount}
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="text-[var(--text-muted)]">
                        <tr>
                          <th className="py-2 pr-4 font-medium">技能</th>
                          <th className="py-2 pr-4 font-medium">状态</th>
                          <th className="py-2 pr-4 font-medium">版本</th>
                          <th className="py-2 pr-4 font-medium">环境</th>
                          <th className="py-2 pr-4 font-medium">触发词</th>
                          <th className="py-2 pr-4 font-medium">统计</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debugSnapshot.skills.map((skill) => (
                          <tr
                            key={skill.id}
                            className="border-t border-[var(--surface-border)]"
                          >
                            <td className="py-2 pr-4">
                              <div className="font-medium text-[var(--text-primary)]">
                                {skill.name}
                              </div>
                              <div className="text-[var(--text-muted)]">
                                {skill.id} · {sourceLabel(skill.source)}
                              </div>
                            </td>
                            <td className="py-2 pr-4">
                              {skill.status}
                              {skill.enabled === false ? " · disabled" : ""}
                            </td>
                            <td className="py-2 pr-4">
                              {skill.installedVersion || "-"} /{" "}
                              {skill.latestVersion}
                            </td>
                            <td className="py-2 pr-4">
                              <div className="flex flex-wrap gap-1">
                                {skill.preloadInImage && (
                                  <span className="rounded-full border px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                                    预置可用
                                  </span>
                                )}
                                {skill.imageRequired && (
                                  <span className="rounded-full border px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                                    专用环境
                                  </span>
                                )}
                                {!skill.preloadInImage &&
                                  !skill.imageRequired && (
                                    <span className="text-[var(--text-muted)]">
                                      -
                                    </span>
                                  )}
                              </div>
                            </td>
                            <td className="py-2 pr-4">
                              {(skill.triggers || []).map((trigger) => (
                                <code key={trigger} className="mr-1">
                                  {trigger}
                                </code>
                              ))}
                            </td>
                            <td className="py-2 pr-4">
                              添加 {skill.stats?.installs ?? 0} · 更新{" "}
                              {skill.stats?.updates ?? 0} · 使用{" "}
                              {skill.stats?.uses ?? 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </main>

      <ConfirmDialog
        isOpen={Boolean(uninstallTarget)}
        title="移除这个技能？"
        description={
          uninstallTarget
            ? `“${skillDisplayName(uninstallTarget)}” 会从${PRODUCT_COPY.assistantSkillLibrary}移除，之后可重新添加。`
            : undefined
        }
        confirmLabel="移除技能"
        variant="destructive"
        isProcessing={Boolean(
          uninstallTarget && processingId === uninstallTarget.id,
        )}
        onConfirm={confirmUninstall}
        onCancel={() => setUninstallTarget(null)}
      />
    </div>
  );
}
