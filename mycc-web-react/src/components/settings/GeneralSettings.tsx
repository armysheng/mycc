import { useEffect, useMemo, useState } from "react";
import {
  SunIcon,
  MoonIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon,
  EyeIcon,
  UserCircleIcon,
  InformationCircleIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";
import { useSettings } from "../../hooks/useSettings";
import { useAuth } from "../../contexts/AuthContext";
import type { FontSize } from "../../types/settings";
import {
  getBillingPlans,
  getBillingSubscription,
  upgradePlan,
  type BillingPlan,
  type BillingPlansResponse,
  type BillingSubscription,
} from "../../api/billing";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        {icon}
      </div>
      <h3 className="text-sm font-semibold tracking-wide text-slate-700 dark:text-slate-200">
        {title}
      </h3>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group w-full rounded-xl border border-slate-200 bg-white/90 p-3 text-left transition-all hover:border-amber-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800/80 dark:hover:border-amber-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</div>
        </div>
        <span
          className={`mt-0.5 inline-flex h-5 w-9 rounded-full p-[2px] transition-colors ${
            checked ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"
          }`}
        >
          <span
            className={`h-4 w-4 rounded-full bg-white transition-transform ${
              checked ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </span>
      </div>
    </button>
  );
}

export function GeneralSettings() {
  const {
    theme,
    enterBehavior,
    showToolCalls,
    autoExpandThinking,
    fontSize,
    profileNickname,
    toggleTheme,
    toggleEnterBehavior,
    toggleShowToolCalls,
    toggleAutoExpandThinking,
    setFontSize,
    setProfileNickname,
  } = useSettings();
  const { user, token, refreshUser } = useAuth();

  const [nicknameDraft, setNicknameDraft] = useState(profileNickname || user?.nickname || "");
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [plansData, setPlansData] = useState<BillingPlansResponse | null>(null);
  const [upgradingPlan, setUpgradingPlan] = useState<"basic" | "pro" | null>(null);

  const accountName = useMemo(() => {
    return user?.nickname || user?.email || user?.phone || user?.linux_user || "未登录用户";
  }, [user]);

  const avatarChar = (nicknameDraft || accountName).charAt(0).toUpperCase();

  const handleSaveNickname = () => {
    setProfileNickname(nicknameDraft.trim());
  };

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const loadBillingData = async () => {
      setBillingLoading(true);
      setBillingError(null);
      try {
        const [subscriptionData, plans] = await Promise.all([
          getBillingSubscription(token),
          getBillingPlans(token),
        ]);
        if (!cancelled) {
          setSubscription(subscriptionData);
          setPlansData(plans);
        }
      } catch (error) {
        if (!cancelled) {
          setBillingError(error instanceof Error ? error.message : "加载套餐信息失败");
        }
      } finally {
        if (!cancelled) {
          setBillingLoading(false);
        }
      }
    };

    void loadBillingData();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleUpgradePlan = async (plan: BillingPlan["id"]) => {
    if (!token || (plan !== "basic" && plan !== "pro")) return;
    setUpgradingPlan(plan);
    setBillingError(null);
    try {
      await upgradePlan(token, plan);
      const [subscriptionData, plans] = await Promise.all([
        getBillingSubscription(token),
        getBillingPlans(token),
      ]);
      setSubscription(subscriptionData);
      setPlansData(plans);
      await refreshUser();
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "升级失败，请稍后重试");
    } finally {
      setUpgradingPlan(null);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle icon={<BanknotesIcon className="h-4 w-4" />} title="套餐与额度" />
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/65">
          {billingLoading && (
            <p className="text-xs text-slate-500 dark:text-slate-400">正在加载套餐信息...</p>
          )}
          {billingError && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              {billingError}
            </p>
          )}

          {subscription && (
            <div className="rounded-lg border border-amber-200/80 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    当前套餐：{subscription.plan_name}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    本月剩余 {subscription.tokens_remaining.toLocaleString()} / {subscription.tokens_limit.toLocaleString()} tokens
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    ¥{subscription.monthly_price_cny}/月
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    每千 tokens 约 ¥{subscription.cny_per_1k_tokens}
                  </p>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${Math.min(100, Math.max(0, subscription.usage_percentage))}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                额度重置时间：{new Date(subscription.reset_at).toLocaleString("zh-CN")}
              </p>
            </div>
          )}

          {plansData && (
            <>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                推荐：{plansData.recommendation.reason}
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                {plansData.plans.map((plan) => (
                  <div
                    key={plan.id}
                    className={`rounded-lg border p-3 ${
                      plan.is_current
                        ? "border-amber-400 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/20"
                        : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{plan.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{plan.description}</p>
                      </div>
                      {plan.is_recommended && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      ¥{plan.monthly_price_cny}/月
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {plan.tokens_limit.toLocaleString()} tokens / 月
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      约可完成 {plan.estimated_deep_tasks} 次深度任务
                    </p>
                    <ul className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                      {plan.highlights.slice(0, 2).map((highlight) => (
                        <li key={highlight}>- {highlight}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={!plan.can_upgrade || plan.is_current || upgradingPlan === plan.id}
                      onClick={() => handleUpgradePlan(plan.id)}
                      className={`mt-3 w-full rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                        plan.can_upgrade && !plan.is_current
                          ? "bg-slate-900 text-white hover:bg-slate-700 dark:bg-amber-600 dark:hover:bg-amber-500"
                          : "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                      }`}
                    >
                      {plan.is_current ? "当前套餐" : upgradingPlan === plan.id ? "升级中..." : "升级到此套餐"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section>
        <SectionTitle icon={<UserCircleIcon className="h-4 w-4" />} title="个人信息" />
        <div className="rounded-xl border border-slate-200 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/65">
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200/70 bg-gradient-to-r from-amber-50 to-stone-50 p-3 dark:border-amber-800/40 dark:from-amber-950/20 dark:to-slate-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-amber-100 dark:text-slate-900">
              {avatarChar || "U"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{accountName}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.linux_user || "local-user"}</p>
            </div>
          </div>

          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">昵称</label>
          <div className="flex gap-2">
            <input
              value={nicknameDraft}
              onChange={(event) => setNicknameDraft(event.target.value)}
              placeholder="输入你的显示昵称"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-amber-700 dark:focus:ring-amber-900/30"
            />
            <button
              type="button"
              onClick={handleSaveNickname}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
            >
              保存
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            昵称保存在本地浏览器，用于前端显示。
          </p>
        </div>
      </section>

      <section>
        <SectionTitle icon={<CommandLineIcon className="h-4 w-4" />} title="对话偏好" />
        <div className="space-y-2">
          <ToggleRow
            title="发送方式"
            description={
              enterBehavior === "send"
                ? "Enter 发送，Shift+Enter 换行"
                : "Enter 换行，Shift+Enter 发送"
            }
            checked={enterBehavior === "send"}
            onToggle={toggleEnterBehavior}
          />

          <ToggleRow
            title="显示工具调用"
            description="关闭后隐藏 tool call 与 tool result 消息。"
            checked={showToolCalls}
            onToggle={toggleShowToolCalls}
          />

          <ToggleRow
            title="自动展开思考"
            description="开启后，思考过程消息默认展开。"
            checked={autoExpandThinking}
            onToggle={toggleAutoExpandThinking}
          />
        </div>
      </section>

      <section>
        <SectionTitle icon={<EyeIcon className="h-4 w-4" />} title="外观" />
        <div className="space-y-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white/90 p-3 transition-all hover:border-amber-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800/80 dark:hover:border-amber-700"
          >
            <div className="flex items-center gap-2">
              {theme === "light" ? (
                <SunIcon className="h-5 w-5 text-amber-500" />
              ) : (
                <MoonIcon className="h-5 w-5 text-sky-400" />
              )}
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {theme === "light" ? "浅色模式" : "深色模式"}
              </span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">点击切换</span>
          </button>

          <div className="rounded-xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-slate-800/80">
            <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">字号</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ["sm", "小"],
                ["md", "中"],
                ["lg", "大"],
              ] as [FontSize, string][]).map(([size, label]) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setFontSize(size)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    fontSize === size
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:border-amber-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-amber-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle icon={<InformationCircleIcon className="h-4 w-4" />} title="关于" />
        <div className="space-y-1 rounded-xl border border-slate-200 bg-white/90 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
          <p>MyCC Web</p>
          <p>Version: {APP_VERSION}</p>
          <p className="text-slate-500 dark:text-slate-400">与 Claude Code 协同的多用户前端。</p>
        </div>
      </section>

      <section>
        <SectionTitle icon={<WrenchScrewdriverIcon className="h-4 w-4" />} title="无障碍提示" />
        <div aria-live="polite" className="rounded-xl border border-slate-200 bg-white/90 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
          当前主题：{theme === "light" ? "浅色" : "深色"}；发送方式：
          {enterBehavior === "send" ? "Enter 发送" : "Enter 换行"}；字号：{fontSize}
        </div>
      </section>
    </div>
  );
}
