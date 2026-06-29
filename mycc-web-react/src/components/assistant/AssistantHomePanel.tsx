import type React from "react";
import type {
  AssistantDeliverableCard,
  AssistantHomeData,
  AssistantTaskCard,
} from "../../types";
import { PRODUCT_COPY, toProjectSpaceLabel } from "../../utils/productCopy";

type AssistantHomePanelProps = {
  assistantName: string;
  data: AssistantHomeData | null;
  loading?: boolean;
  error?: string | null;
  onStartPrompt?: (prompt: string) => void;
  onContinueTask?: (task: AssistantTaskCard) => void;
  onOpenWorkspace?: () => void;
  onOpenDeliverable?: (deliverable: AssistantDeliverableCard) => void;
  inputSlot?: React.ReactNode;
  workspaceName?: string;
  workspaceLabel?: string;
  modeLabel?: string;
};

export function AssistantHomePanel({
  assistantName,
  data,
  loading = false,
  error = null,
  onStartPrompt,
  onContinueTask,
  onOpenWorkspace,
  onOpenDeliverable,
  inputSlot,
  workspaceName,
  workspaceLabel,
  modeLabel = "本地模式",
}: AssistantHomePanelProps) {
  const tasks = selectVisibleTasks(data?.tasks ?? []);
  const rawDeliverables = data?.deliverables ?? [];
  const deliverables = (data?.deliverables ?? []).filter(isReadyDeliverable);
  const primaryDeliverable = deliverables[0] ?? null;
  const hasUnreadyDeliverables =
    deliverables.length === 0 &&
    rawDeliverables.some((deliverable) => deliverable.status !== "ready");
  const memoryAvailable = (data?.memory.sources ?? []).some(
    (source) => source.status !== "missing",
  );
  const workspaceChip =
    workspaceLabel ||
    workspaceName ||
    toProjectSpaceLabel(data?.workspace?.label) ||
    "当前项目";
  const headline = workspaceName
    ? `我们应该在 ${workspaceName} 中构建什么？`
    : `今天想让 ${assistantName} 帮你做什么？`;

  return (
    <section className="mx-auto flex min-h-[min(640px,70vh)] w-full max-w-5xl flex-col items-center justify-center px-2 py-10 text-center sm:px-6 sm:py-14">
      <div className="relative w-full max-w-3xl">
        <div className="pointer-events-none absolute -right-4 -top-10 hidden text-[132px] font-semibold leading-none text-slate-950 opacity-[0.035] dark:text-white sm:block">
          道
        </div>
        <div className="relative inline-flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm shadow-slate-200/30 dark:border-slate-700/80 dark:bg-slate-900/55 dark:text-slate-400 dark:shadow-none">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-slate-300 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">
            问
          </span>
          <span>{PRODUCT_COPY.brandName} 个人助理</span>
        </div>
        <p className="mt-3 text-xs font-medium text-slate-400 dark:text-slate-500">
          {PRODUCT_COPY.brandProofLine}
        </p>
        <h2 className="relative mt-5 text-4xl font-semibold text-slate-950 dark:text-slate-50">
          {headline}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          直接描述你想完成的事，{assistantName} 会帮你拆解、执行，并在需要时打开
          {PRODUCT_COPY.resultsSpace}让你查看和编辑。
        </p>

        <div className="mt-8">
          {inputSlot ?? (
            <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/70 p-5 text-left text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
              输入框加载中...
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
          <ContextChip label={workspaceChip} />
          <ContextChip label={modeLabel} />
          {memoryAvailable && <ContextChip label="个人记忆已启用" />}
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="rounded-full border border-slate-200 bg-white/75 px-3 py-1.5 font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-50"
          >
            打开{PRODUCT_COPY.resultsSpace}
          </button>
        </div>

        {(tasks.length > 0 ||
          primaryDeliverable ||
          hasUnreadyDeliverables ||
          loading ||
          error) && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {tasks.slice(0, 3).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  if (onContinueTask) {
                    onContinueTask(task);
                    return;
                  }
                  onStartPrompt?.(`继续：${task.title}`);
                }}
                className="max-w-[240px] truncate rounded-full border border-slate-200 bg-white/60 px-3 py-1.5 text-left hover:bg-white dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-900"
              >
                继续：{task.title}
              </button>
            ))}
            {primaryDeliverable && deliverables.length === 1 && (
              <DeliverablePill
                deliverable={primaryDeliverable}
                onOpenDeliverable={onOpenDeliverable}
              />
            )}
            {hasUnreadyDeliverables && (
              <DeliverableProgressPill onOpenWorkspace={onOpenWorkspace} />
            )}
            {loading && (
              <span className="rounded-full border border-slate-200 px-3 py-1.5 dark:border-slate-700">
                正在同步上下文...
              </span>
            )}
            {error && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                首页状态暂不可用
              </span>
            )}
          </div>
        )}
        {deliverables.length > 1 && (
          <div className="mx-auto mt-5 w-full max-w-3xl rounded-[24px] border border-slate-200/80 bg-white/55 p-3 text-left shadow-sm shadow-slate-200/30 dark:border-slate-700/80 dark:bg-slate-900/45 dark:shadow-none">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                最近成果
              </span>
              <button
                type="button"
                onClick={onOpenWorkspace}
                className="text-xs font-medium text-slate-400 transition hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
              >
                到成果空间查看
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {deliverables.slice(0, 4).map((deliverable) => (
                <button
                  key={deliverable.id}
                  type="button"
                  onClick={() => onOpenDeliverable?.(deliverable)}
                  className="min-w-[180px] max-w-[220px] rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-left transition hover:border-slate-300 hover:bg-white dark:border-slate-700/80 dark:bg-slate-950/45 dark:hover:border-slate-600"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {getDeliverableKindLabel(deliverable.kind)}
                  </span>
                  <span className="mt-1 block truncate text-xs font-semibold text-slate-700 dark:text-slate-100">
                    {deliverable.title}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-slate-400">
                    {getDeliverableSourceLabel(deliverable.source)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ContextChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-slate-200 bg-white/55 px-3 py-1.5 font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
      {label}
    </span>
  );
}

function DeliverableProgressPill({
  onOpenWorkspace,
}: {
  onOpenWorkspace?: () => void;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2 py-1 dark:border-slate-700 dark:bg-slate-900/50">
      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        成果还在整理
      </span>
      <span className="hidden text-slate-400 sm:inline">
        完成后会出现在{PRODUCT_COPY.resultsSpace}。
      </span>
      <button
        type="button"
        onClick={onOpenWorkspace}
        className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        查看{PRODUCT_COPY.resultsSpace}
      </button>
    </div>
  );
}

function DeliverablePill({
  deliverable,
  onOpenDeliverable,
}: {
  deliverable: AssistantDeliverableCard;
  onOpenDeliverable?: (deliverable: AssistantDeliverableCard) => void;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2 py-1 dark:border-slate-700 dark:bg-slate-900/50">
      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {getDeliverableKindLabel(deliverable.kind)}
      </span>
      <span className="max-w-[220px] truncate text-slate-600 dark:text-slate-300">
        {deliverable.title}
      </span>
      <span className="hidden text-slate-400 sm:inline">
        {getDeliverableSourceLabel(deliverable.source)}
      </span>
      <button
        type="button"
        onClick={() => onOpenDeliverable?.(deliverable)}
        className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        打开成果
      </button>
      {deliverable.updatedAt && (
        <span className="sr-only">
          {formatDeliverableTime(deliverable.updatedAt)}
        </span>
      )}
    </div>
  );
}

function getDeliverableKindLabel(kind: AssistantDeliverableCard["kind"]) {
  const labels: Record<AssistantDeliverableCard["kind"], string> = {
    document: "文档",
    code_change: "修改记录",
    diff: "变更说明",
    report: "报告",
    link: "链接",
    preview: "预览",
    screenshot: "截图",
    log: "处理记录",
    pr: "协作记录",
    dataset: "数据集",
  };
  return labels[kind] ?? "成果";
}

function getDeliverableSourceLabel(source: AssistantDeliverableCard["source"]) {
  if (source === "current_workspace")
    return `来自当前${PRODUCT_COPY.projectFiles}`;
  return "来自当前对话";
}

function isUserVisibleTask(task: AssistantTaskCard) {
  const title = task.title.trim();
  const lowerTitle = title.toLowerCase();
  const hiddenMarkers = [
    "你正在执行用户工作区首次初始化",
    "初始化票据",
    "初始化尚未完成",
    "初始化流程执行失败",
    "BOOTSTRAP.md",
    "onboarding bootstrap",
  ];

  if (!title) return false;
  if (lowerTitle === "continue" || lowerTitle === "accept") return false;
  if (hiddenMarkers.some((marker) => lowerTitle.includes(marker.toLowerCase())))
    return false;

  return true;
}

function selectVisibleTasks(tasks: AssistantTaskCard[]) {
  const seenTitles = new Set<string>();
  const selected: AssistantTaskCard[] = [];

  for (const task of tasks) {
    if (!isUserVisibleTask(task)) continue;
    if (isLowSignalTask(task)) continue;

    const signalKey = normalizeTaskTitle(task.title);
    if (seenTitles.has(signalKey)) continue;

    seenTitles.add(signalKey);
    selected.push(task);
  }

  return selected;
}

function isLowSignalTask(task: AssistantTaskCard) {
  if (typeof task.messageCount !== "number" || task.messageCount > 1) {
    return false;
  }

  return LOW_SIGNAL_TASK_TITLES.has(normalizeTaskTitle(task.title));
}

const LOW_SIGNAL_TASK_TITLES = new Set([
  "最近会话",
  "新会话",
  "未命名会话",
  "untitled",
  "newchat",
]);

function normalizeTaskTitle(title?: string | null) {
  return (title || "")
    .trim()
    .toLowerCase()
    .replace(/[\s.。!！?？:：,，_-]+/g, "");
}

function isReadyDeliverable(deliverable: AssistantDeliverableCard) {
  return deliverable.status === "ready";
}

function formatDeliverableTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
