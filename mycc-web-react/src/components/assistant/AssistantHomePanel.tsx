import type React from "react";
import type {
  AssistantCapabilityCard,
  AssistantDeliverableCard,
  AssistantHomeData,
  AssistantMemorySource,
  AssistantTaskCard,
} from "../../types";

type AssistantHomePanelProps = {
  assistantName: string;
  data: AssistantHomeData | null;
  loading?: boolean;
  error?: string | null;
  onStartPrompt?: (prompt: string) => void;
  onOpenWorkspace?: () => void;
};

const suggestedPrompts = [
  "整理一下当前项目状态",
  "继续上次的任务",
  "看看有什么需要我确认",
];

export function AssistantHomePanel({
  assistantName,
  data,
  loading = false,
  error = null,
  onStartPrompt,
  onOpenWorkspace,
}: AssistantHomePanelProps) {
  const tasks = data?.tasks ?? [];
  const memorySources = data?.memory.sources ?? [];
  const capabilities = (data?.capabilities ?? []).filter((capability) => !capability.hidden);
  const deliverables = data?.deliverables ?? [];

  return (
    <section className="w-full max-w-6xl mx-auto space-y-4 text-left">
      <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/80 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-300">
          MyCC Personal Assistant
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 sm:text-3xl">
          今天要我帮你做什么？
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          {assistantName} 可以继续任务、整理制品、记住项目背景；需要深度接管时再打开工作间。
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onStartPrompt?.(prompt)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:bg-sky-900/30"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
          正在整理助理首页...
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          助理首页暂时不可用：{error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <Panel title="最近可以继续" subtitle="当前版本把最近会话作为 task-like 卡片，不声明完成/失败等持久状态。">
            {tasks.length > 0 ? (
              <div className="grid gap-3">
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            ) : (
              <EmptyCopy>
                {data?.emptyStates?.tasks || "Start by asking your assistant to do something. Recent conversations will appear here."}
              </EmptyCopy>
            )}
          </Panel>

          <Panel title="最近制品" subtitle="报告、文件、预览、PR 和日志会逐步沉淀在这里。">
            {deliverables.length > 0 ? (
              <div className="grid gap-3">
                {deliverables.map((deliverable) => (
                  <DeliverableCard key={deliverable.id} deliverable={deliverable} />
                ))}
              </div>
            ) : (
              <EmptyCopy>
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {data?.deliverableEmptyState?.title || "还没有制品"}
                </span>
                <span className="mt-1 block">
                  {data?.deliverableEmptyState?.description || data?.emptyStates?.deliverables || "Useful outputs will appear here."}
                </span>
              </EmptyCopy>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="助理记忆" subtitle="把个人偏好、项目背景和长期记忆分开，让助理知道该从哪里理解你。">
            <div className="grid gap-3">
              {memorySources.length > 0 ? (
                memorySources.map((source) => (
                  <MemorySourceCard key={source.kind} source={source} />
                ))
              ) : (
                <EmptyCopy>
                  {data?.emptyStates?.memory || "Your assistant can become more useful when it knows your preferences and project context."}
                </EmptyCopy>
              )}
            </div>
          </Panel>

          <Panel title="高级工作间" subtitle="给需要接管的时刻使用；平时助理会替你处理。">
            <div className="grid gap-3">
              {data?.workspace && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100">
                  <div className="font-semibold">{data.workspace.label}</div>
                  <p className="mt-1 text-xs leading-5 opacity-80">{data.workspace.description}</p>
                </div>
              )}
              {capabilities.map((capability) => (
                <CapabilityCard
                  key={capability.id}
                  capability={capability}
                  onOpenWorkspace={onOpenWorkspace}
                />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function DeliverableCard({ deliverable }: { deliverable: AssistantDeliverableCard }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {deliverable.title}
          </div>
          {deliverable.description && (
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {deliverable.description}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
          {getDeliverableKindLabel(deliverable.kind)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">
          {getDeliverableSourceLabel(deliverable.source)}
        </span>
        {deliverable.path && (
          <code className="max-w-full truncate rounded-md bg-slate-100 px-2 py-1 font-mono dark:bg-slate-800">
            {deliverable.path}
          </code>
        )}
        {deliverable.updatedAt && (
          <span>{formatDeliverableTime(deliverable.updatedAt)}</span>
        )}
      </div>
    </article>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function getDeliverableKindLabel(kind: AssistantDeliverableCard["kind"]) {
  const labels: Record<AssistantDeliverableCard["kind"], string> = {
    document: "文档",
    code_change: "代码变更",
    diff: "Diff",
    report: "报告",
    link: "链接",
    preview: "预览",
    screenshot: "截图",
    log: "日志",
    pr: "PR",
    dataset: "数据集",
  };
  return labels[kind] ?? "制品";
}

function getDeliverableSourceLabel(source: AssistantDeliverableCard["source"]) {
  if (source === "current_workspace") return "来自当前工作区";
  return "来自当前对话";
}

function formatDeliverableTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function TaskCard({ task }: { task: AssistantTaskCard }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {task.title}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {task.description || "最近会话，可继续让助理接着处理。"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
          最近会话
        </span>
      </div>
      <div className="mt-3 text-[11px] text-slate-400">
        {task.messageCount} messages
      </div>
    </article>
  );
}

function MemorySourceCard({ source }: { source: AssistantMemorySource }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{source.label}</div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-900 dark:text-slate-300">
          {source.editable ? "可编辑" : "只读"}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{source.description}</p>
    </article>
  );
}

function CapabilityCard({
  capability,
  onOpenWorkspace,
}: {
  capability: AssistantCapabilityCard;
  onOpenWorkspace?: () => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{capability.label}</div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{capability.description}</p>
        </div>
        {capability.id === "code-server" && (
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200"
          >
            {capability.actionLabel || "打开"}
          </button>
        )}
      </div>
    </article>
  );
}

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
      {children}
    </div>
  );
}
