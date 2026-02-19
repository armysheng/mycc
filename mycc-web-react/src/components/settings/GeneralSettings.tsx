import { useMemo, useState } from "react";
import {
  SunIcon,
  MoonIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon,
  EyeIcon,
  UserCircleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useSettings } from "../../hooks/useSettings";
import { useAuth } from "../../contexts/AuthContext";
import type { FontSize } from "../../types/settings";

const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="h-6 w-6 rounded-md bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
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
      className="w-full rounded-lg border panel-surface p-3 flex items-start justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
    >
      <div>
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {title}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {description}
        </div>
      </div>
      <span
        className={`mt-0.5 inline-flex h-5 w-9 rounded-full p-[2px] transition-colors ${
          checked ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-700"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
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
  const { user } = useAuth();

  const [nicknameDraft, setNicknameDraft] = useState(profileNickname || user?.nickname || "");

  const accountName = useMemo(() => {
    return user?.nickname || user?.email || user?.phone || user?.linux_user || "未登录用户";
  }, [user]);

  const avatarChar = (nicknameDraft || accountName).charAt(0).toUpperCase();

  const handleSaveNickname = () => {
    setProfileNickname(nicknameDraft.trim());
  };

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle
          icon={<UserCircleIcon className="w-4 h-4" />}
          title="个人信息"
        />
        <div className="rounded-lg border panel-surface p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm font-semibold">
              {avatarChar || "U"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                {accountName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {user?.linux_user || "local-user"}
              </p>
            </div>
          </div>

          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            昵称
          </label>
          <div className="flex gap-2">
            <input
              value={nicknameDraft}
              onChange={(event) => setNicknameDraft(event.target.value)}
              placeholder="输入你的显示昵称"
              className="flex-1 rounded-lg border panel-surface px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={handleSaveNickname}
              className="rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-3 py-2"
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
        <SectionTitle
          icon={<CommandLineIcon className="w-4 h-4" />}
          title="对话偏好"
        />
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
        <SectionTitle icon={<EyeIcon className="w-4 h-4" />} title="外观" />
        <div className="space-y-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-full rounded-lg border panel-surface p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/40"
          >
            <div className="flex items-center gap-2">
              {theme === "light" ? (
                <SunIcon className="w-5 h-5 text-amber-500" />
              ) : (
                <MoonIcon className="w-5 h-5 text-sky-400" />
              )}
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {theme === "light" ? "浅色模式" : "深色模式"}
              </span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">点击切换</span>
          </button>

          <div className="rounded-lg border panel-surface p-3">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 mb-2">
              字号
            </div>
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
                      ? "bg-sky-500 border-sky-500 text-white"
                      : "panel-surface text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40"
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
        <SectionTitle
          icon={<InformationCircleIcon className="w-4 h-4" />}
          title="关于"
        />
        <div className="rounded-lg border panel-surface p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <p>MyCC Web</p>
          <p>Version: {APP_VERSION}</p>
          <p className="text-slate-500 dark:text-slate-400">
            与 Claude Code 协同的多用户前端。
          </p>
        </div>
      </section>

      <section>
        <SectionTitle
          icon={<WrenchScrewdriverIcon className="w-4 h-4" />}
          title="无障碍提示"
        />
        <div aria-live="polite" className="rounded-lg border panel-surface p-3 text-xs text-slate-600 dark:text-slate-300">
          当前主题：{theme === "light" ? "浅色" : "深色"}；发送方式：
          {enterBehavior === "send" ? "Enter 发送" : "Enter 换行"}；字号：
          {fontSize}
        </div>
      </section>
    </div>
  );
}
