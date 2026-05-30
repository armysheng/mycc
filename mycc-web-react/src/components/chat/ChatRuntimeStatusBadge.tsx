import { useEffect, useState } from "react";
import { getAuthHeaders, getChatRuntimeConfigUrl } from "../../config/api";

type RuntimeKind = "remote-claude" | "claude-agent-sdk" | "e2b-claude-cli" | "e2b-claude-agent-sdk";
type ProviderKind = "ccr" | "custom" | "anthropic" | "vps" | "none";

type RuntimeConfig = {
  kind: RuntimeKind;
  executionEnvironment: "vps" | "local" | "e2b";
  usesAgentSdk: boolean;
  usesCodeServerWorkspace: boolean;
  claudeProvider: {
    provider: ProviderKind;
    baseUrlConfigured: boolean;
    credentialConfigured: boolean;
  };
  e2bAgentPreflight?: {
    ok: boolean;
    errorCount: number;
    warnCount: number;
    skipCount?: number;
    checks?: Array<{
      id: string;
      label: string;
      status: "ok" | "warn" | "error" | "skip";
      message: string;
      action?: string;
    }>;
  };
};

type ChatRuntimeStatusBadgeProps = {
  token: string | null;
};

export function ChatRuntimeStatusBadge({ token }: ChatRuntimeStatusBadgeProps) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      setConfig(null);
      setFailed(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(getChatRuntimeConfigUrl(), {
          headers: getAuthHeaders(token),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.success) {
          throw new Error(json?.error || "runtime config request failed");
        }
        if (!cancelled) {
          setConfig(json.data as RuntimeConfig);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setConfig(null);
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) return null;

  const runtimeLabel = config ? runtimeKindLabel(config.kind) : "Runtime 待检测";
  const providerLabel = config ? providerStatusLabel(config.claudeProvider) : "Provider 待检测";
  const workspaceLabel = config?.usesCodeServerWorkspace ? "code-server workspace" : undefined;
  const e2bPreflightLabel = config?.usesCodeServerWorkspace && config.e2bAgentPreflight
    ? e2bPreflightStatusLabel(config.e2bAgentPreflight)
    : undefined;
  const e2bPreflightClass = config?.e2bAgentPreflight
    ? e2bPreflightStatusClass(config.e2bAgentPreflight)
    : "";
  const e2bPreflightGaps = config?.e2bAgentPreflight
    ? nonOkE2bPreflightChecks(config.e2bAgentPreflight)
    : [];

  return (
    <div className="mt-2 space-y-2 text-[11px] text-slate-500 dark:text-slate-400">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${failed ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200" : "border-slate-200 bg-white/70 text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"}`}>
          {runtimeLabel}
        </span>
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
          {providerLabel}
        </span>
        {workspaceLabel && (
          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
            {workspaceLabel}
          </span>
        )}
        {e2bPreflightLabel && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${e2bPreflightClass}`}>
            {e2bPreflightLabel}
          </span>
        )}
      </div>
      {e2bPreflightGaps.length > 0 && (
        <div className="w-full rounded-2xl border border-slate-200/80 bg-white/80 p-3 text-slate-600 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-300">
          <div className="mb-2 font-semibold text-slate-700 dark:text-slate-200">E2B preflight 缺口</div>
          <div className="space-y-2">
            {e2bPreflightGaps.map((check) => (
              <div key={check.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-100">{safePreflightText(check.label)}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${e2bPreflightCheckStatusClass(check.status)}`}>
                    {check.status}
                  </span>
                </div>
                <div className="mt-1 text-slate-600 dark:text-slate-300">{safePreflightText(check.message)}</div>
                {check.action && (
                  <div className="mt-1 text-slate-500 dark:text-slate-400">
                    下一步：<span>{safePreflightText(check.action)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function runtimeKindLabel(kind: RuntimeKind): string {
  if (kind === "e2b-claude-agent-sdk") return "E2B Agent SDK";
  if (kind === "e2b-claude-cli") return "E2B Claude CLI";
  if (kind === "claude-agent-sdk") return "Agent SDK";
  return "VPS Claude";
}

function providerStatusLabel(provider: RuntimeConfig["claudeProvider"]): string {
  if (provider.provider === "ccr") {
    return provider.baseUrlConfigured && provider.credentialConfigured ? "CCR 已配置" : "CCR 待配置";
  }
  if (provider.provider === "anthropic") {
    return provider.credentialConfigured ? "Anthropic 已配置" : "Anthropic 待配置";
  }
  if (provider.provider === "vps") return "VPS 凭证";
  if (provider.provider === "custom") return "自定义 Claude Provider";
  return "Provider 未配置";
}

function e2bPreflightStatusLabel(preflight: NonNullable<RuntimeConfig["e2bAgentPreflight"]>): string {
  if (preflight.errorCount > 0) return `E2B 缺配置 ${preflight.errorCount}`;
  if (preflight.warnCount > 0) return `E2B 待确认 ${preflight.warnCount}`;
  return "E2B 就绪";
}

function e2bPreflightStatusClass(preflight: NonNullable<RuntimeConfig["e2bAgentPreflight"]>): string {
  if (preflight.errorCount > 0) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200";
  }
  if (preflight.warnCount > 0) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200";
}

function nonOkE2bPreflightChecks(preflight: NonNullable<RuntimeConfig["e2bAgentPreflight"]>) {
  return (preflight.checks ?? []).filter((check) => check.status === "error" || check.status === "warn");
}

function e2bPreflightCheckStatusClass(status: "ok" | "warn" | "error" | "skip"): string {
  if (status === "error") {
    return "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200";
  }
  if (status === "warn") {
    return "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200";
  }
  if (status === "skip") {
    return "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
  return "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200";
}

function safePreflightText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[已隐藏 URL]")
    .replace(/\be2b_[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, "[已隐藏密钥]")
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{12,}\b/g, "[已隐藏密钥]");
}
