import { useState, useEffect } from "react";
import {
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon,
  EyeIcon,
  UserCircleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useSettings } from "../../hooks/useSettings";
import { useAuth } from "../../contexts/AuthContext";
import { updateProfile } from "../../api/auth";
import type { FontSize, Theme } from "../../types/settings";

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
    resolvedTheme,
    enterBehavior,
    showToolCalls,
    autoExpandThinking,
    fontSize,
    sidebarDefaultOpen,
    setTheme,
    toggleEnterBehavior,
    toggleShowToolCalls,
    toggleAutoExpandThinking,
    setFontSize,
    updateSettings,
  } = useSettings();
  const { user, token, refreshUser } = useAuth();

  const [assistantNameDraft, setAssistantNameDraft] = useState(user?.assistant_name || "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState("");
  const [profileSaveSuccess, setProfileSaveSuccess] = useState("");

  useEffect(() => {
    setAssistantNameDraft(user?.assistant_name || "");
  }, [user?.assistant_name]);

  const accountName = user?.email || user?.phone || user?.linux_user || "未登录用户";
  const assistantDisplayName = user?.assistant_name?.trim() || "cc";
  const avatarChar = accountName.charAt(0).toUpperCase();

  const handleSaveProfile = async () => {
    if (!token) {
      return;
    }

    setIsSavingProfile(true);
    setProfileSaveError("");
    setProfileSaveSuccess("");

    try {
      const response = await updateProfile(token, {
        assistantName: assistantNameDraft.trim(),
      });

      if (!response.success) {
        throw new Error(response.error || "保存失败");
      }

      await refreshUser();
      setProfileSaveSuccess("保存成功");
    } catch (error) {
      setProfileSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="space-y-6">
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

          <label className="mb-1 mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">助手名称</label>
          <input
            value={assistantNameDraft}
            onChange={(event) => setAssistantNameDraft(event.target.value)}
            placeholder="输入助手显示名称"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-amber-700 dark:focus:ring-amber-900/30"
          />

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              助手当前显示名：{assistantDisplayName}
            </p>
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingProfile ? "保存中..." : "保存"}
            </button>
          </div>

          {profileSaveError && (
            <p className="mt-2 text-[11px] text-red-500">{profileSaveError}</p>
          )}
          {profileSaveSuccess && (
            <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">{profileSaveSuccess}</p>
          )}
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
          <div className="rounded-xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-slate-800/80">
            <div className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">主题</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                ["light", "浅色", <SunIcon key="sun" className="h-4 w-4" />],
                ["dark", "深色", <MoonIcon key="moon" className="h-4 w-4" />],
                ["system", "跟随系统", <ComputerDesktopIcon key="desktop" className="h-4 w-4" />],
              ] as [Theme, string, React.ReactNode][]).map(([t, label, icon]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    theme === t
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:border-amber-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-amber-700"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

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

          <ToggleRow
            title="侧栏默认展开"
            description="控制页面加载时桌面端侧栏是否默认展开。移动端始终默认收起。"
            checked={sidebarDefaultOpen}
            onToggle={() => updateSettings({ sidebarDefaultOpen: !sidebarDefaultOpen })}
          />
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
          当前主题：{theme === "system" ? `跟随系统（${resolvedTheme === "light" ? "浅色" : "深色"}）` : resolvedTheme === "light" ? "浅色" : "深色"}；发送方式：
          {enterBehavior === "send" ? "Enter 发送" : "Enter 换行"}；字号：{fontSize}
        </div>
      </section>
    </div>
  );
}
