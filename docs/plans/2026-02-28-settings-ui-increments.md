# 用户设置 UI 增量 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补全 4 项缺失的设置/交互功能：主题跟随系统、侧栏默认开关、清空会话、会话重命名。

**Architecture:** 在现有 useSettings hook + SettingsContext + localStorage 体系上扩展。Theme 类型加 "system"，AppSettings 加 sidebarDefaultOpen 字段，ChatPage 加清空按钮，Sidebar 加 inline 重命名。不涉及后端改动（除会话重命名调已有 API）。

**Tech Stack:** React 19, Vite, Tailwind CSS, existing useSettings/SettingsContext

---

### Task 1: 主题加「跟随系统」— 类型与存储层

**Files:**
- Modify: `mycc-web-react/src/types/settings.ts`
- Modify: `mycc-web-react/src/utils/storage.ts`

**Step 1: 扩展 Theme 类型和默认值**

在 `types/settings.ts` 中：

```typescript
export type Theme = "light" | "dark" | "system";
```

`DEFAULT_SETTINGS.theme` 改为 `"system"`，`CURRENT_SETTINGS_VERSION` 改为 `3`。

`SettingsContextType` 新增：
```typescript
resolvedTheme: "light" | "dark";
setTheme: (theme: Theme) => void;
```

**Step 2: 更新 migration 逻辑**

在 `utils/storage.ts` 的 `migrateSettings` 中，旧版本的 `"light"` / `"dark"` 值保持不变（向前兼容），不需要特殊迁移。

**Step 3: 确认类型检查通过**

Run: `cd mycc-web-react && npx tsc --noEmit 2>&1 | head -20`
Expected: 会有 SettingsContext.tsx 和 GeneralSettings.tsx 报错（下个 Task 修）

**Step 4: Commit**

```bash
git add mycc-web-react/src/types/settings.ts mycc-web-react/src/utils/storage.ts
git commit -m "feat(settings): extend Theme type with system mode, bump version to 3"
```

---

### Task 2: 主题「跟随系统」— Context 和 UI

**Files:**
- Modify: `mycc-web-react/src/contexts/SettingsContext.tsx`
- Modify: `mycc-web-react/src/components/settings/GeneralSettings.tsx`

**Step 1: SettingsContext 新增 resolvedTheme 和 setTheme**

在 `SettingsContext.tsx` 中：

1. 新增 `resolvedTheme` state：
```typescript
const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
);
```

2. 新增 useEffect 监听系统主题变化：
```typescript
useEffect(() => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}, []);
```

3. 计算 `resolvedTheme`：
```typescript
const resolvedTheme = settings.theme === "system" ? systemTheme : settings.theme;
```

4. 主题应用 useEffect 改用 `resolvedTheme`：
```typescript
useEffect(() => {
  if (!isInitialized) return;
  const root = window.document.documentElement;
  if (resolvedTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  setSettings(settings);
}, [settings, resolvedTheme, isInitialized]);
```

5. `toggleTheme` 改为 `setTheme`：
```typescript
const setTheme = useCallback((theme: Theme) => {
  updateSettings({ theme });
}, [updateSettings]);
```

6. value 中暴露 `resolvedTheme` 和 `setTheme`，保留 `toggleTheme`（向后兼容，三态循环 light→dark→system）。

**Step 2: GeneralSettings 主题区改为三选一**

替换主题切换按钮为三选一按钮组（复用字号选择器样式）：

```tsx
const themeOptions: [Theme, string][] = [
  ["light", "浅色"],
  ["dark", "深色"],
  ["system", "跟随系统"],
];
```

用 `grid grid-cols-3` 按钮组渲染，选中项高亮。

**Step 3: 类型检查 + 构建**

Run: `cd mycc-web-react && npx tsc --noEmit`
Expected: PASS

Run: `cd mycc-web-react && npm run build`
Expected: 构建成功

**Step 4: Commit**

```bash
git add mycc-web-react/src/contexts/SettingsContext.tsx mycc-web-react/src/contexts/SettingsContextTypes.ts mycc-web-react/src/components/settings/GeneralSettings.tsx mycc-web-react/src/hooks/useSettings.ts
git commit -m "feat(settings): implement system theme mode with live media query listener"
```

---

### Task 3: 侧栏默认开关（P0 修订：设置项与运行时状态拆开）

**语义拆分：**
- `sidebarDefaultOpen`（设置项）— 持久化在 localStorage，只影响页面初始加载时的值
- `isDesktopSidebarVisible`（运行时状态）— ChatPage 内的 state，用户可随时 toggle，不写回设置

**Files:**
- Modify: `mycc-web-react/src/types/settings.ts`
- Modify: `mycc-web-react/src/components/settings/GeneralSettings.tsx`
- Modify: `mycc-web-react/src/components/ChatPage.tsx`
- Modify: `mycc-web-react/src/components/layout/Sidebar.tsx`

**Step 1: AppSettings 新增字段**

在 `types/settings.ts`：
```typescript
// AppSettings 新增
sidebarDefaultOpen: boolean;
```

`DEFAULT_SETTINGS` 新增 `sidebarDefaultOpen: true`。

`SettingsContextType` 新增：
```typescript
sidebarDefaultOpen: boolean;
```

**Step 2: GeneralSettings 新增 ToggleRow**

在外观区新增：
```tsx
<ToggleRow
  title="侧栏默认展开"
  description="控制页面加载时桌面端侧栏是否默认展开。移动端始终默认收起。"
  checked={sidebarDefaultOpen}
  onToggle={() => updateSettings({ sidebarDefaultOpen: !sidebarDefaultOpen })}
/>
```

**Step 3: ChatPage — 用设置初始化运行时状态**

两个独立 state，语义明确：
```typescript
const { sidebarDefaultOpen } = useSettings();

// 运行时状态：用户可随时 toggle，不写回设置
const [isDesktopSidebarVisible, setIsDesktopSidebarVisible] = useState(sidebarDefaultOpen);
// 移动端抽屉：始终默认关闭
const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
```

原有 `isSidebarOpen` 拆成上面两个。修改所有引用：
- 汉堡按钮 → `setIsMobileSidebarOpen(true)`
- Sidebar `isOpen` prop → `isMobileSidebarOpen`
- Sidebar `onClose` prop → `() => setIsMobileSidebarOpen(false)`

**Step 4: Sidebar props 新增 `desktopVisible`**

```typescript
interface SidebarProps {
  // ...existing
  desktopVisible: boolean;
}
```

桌面端 aside className 改为：
```tsx
className={`panel-surface border-r ${desktopVisible ? 'hidden lg:flex' : 'hidden'} flex-col shrink-0`}
```

**Step 5: ChatPage header 新增桌面端 toggle 按钮**

```tsx
{/* 桌面端侧栏 toggle（仅 lg 以上显示） */}
<button
  onClick={() => setIsDesktopSidebarVisible(v => !v)}
  className="hidden lg:inline-flex p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
  aria-label={isDesktopSidebarVisible ? "收起侧栏" : "展开侧栏"}
>
  <svg className="w-5 h-5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
</button>
```

**Step 6: 类型检查 + 构建**

Run: `cd mycc-web-react && npx tsc --noEmit && npm run build`
Expected: PASS

**Step 7: Commit**

```bash
git add mycc-web-react/src/types/settings.ts mycc-web-react/src/components/settings/GeneralSettings.tsx mycc-web-react/src/components/ChatPage.tsx mycc-web-react/src/components/layout/Sidebar.tsx
git commit -m "feat(settings): add sidebar default open toggle, split setting vs runtime state"
```

---

### Task 4: 清空当前会话（P0 修订：直接重置 state，不仅靠 URL）

**P0 问题：** `handleNewChat()` 只做 `navigate({ search: "" })`，依赖 URL 变化触发 `useChatState` 重新初始化。但如果当前已经没有 sessionId query，URL 不会变化，state 不会重置。必须直接清空 state。

**方案：** `handleClearChat` 先重置 `useChatState` 暴露的所有 state setter，再清 URL。

**Files:**
- Modify: `mycc-web-react/src/components/ChatPage.tsx`

**Step 1: Header 新增清空按钮**

在 header 按钮区（HistoryButton 之前）新增：
```tsx
{messages.length > 0 && !isHistoryView && (
  <button
    onClick={handleClearChat}
    className="px-3 py-2 rounded-lg panel-surface border text-sm text-slate-600 dark:text-slate-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
  >
    清空
  </button>
)}
```

**Step 2: handleClearChat 回调 — 直接重置 state**

```typescript
const handleClearChat = useCallback(() => {
  if (!window.confirm("确定清空当前会话？")) return;
  // 直接重置聊天 state，不依赖 URL 变化
  setMessages([]);
  setCurrentSessionId(null);
  setHasShownInitMessage(false);
  setHasReceivedInit(false);
  setCurrentAssistantMessage(null);
  clearInput();
  // 同时清 URL query（确保 sessionId 参数被移除）
  navigate({ search: "" });
}, [
  setMessages, setCurrentSessionId, setHasShownInitMessage,
  setHasReceivedInit, setCurrentAssistantMessage, clearInput, navigate,
]);
```

注意：`setMessages` 等 setter 均由 `useChatState` 在 ChatPage 中解构而出，已在作用域内。

**Step 3: 类型检查**

Run: `cd mycc-web-react && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add mycc-web-react/src/components/ChatPage.tsx
git commit -m "feat(chat): add clear conversation button with direct state reset"
```

---

### Task 5: 会话重命名（P0 修订：避免 button 嵌套）

**P0 问题：** 原方案在 `<button>` 内嵌套 `<button>`（编辑按钮），违反 HTML 规范，导致交互冲突。

**方案：** 对话条目外层从 `<button>` 改为 `<div role="button" tabIndex={0}>`，用 `onClick` + `onKeyDown(Enter)` 模拟按钮语义。这样内部的编辑 `<button>` 就不再是嵌套 button。

**Files:**
- Modify: `mycc-web-react/src/components/layout/Sidebar.tsx`

**Step 1: 新增 inline 编辑状态**

```typescript
const [editingId, setEditingId] = useState<string | null>(null);
const [editTitle, setEditTitle] = useState("");
```

**Step 2: 对话条目改为 div，避免 button 嵌套**

将原有的 `<button>` 改为 `<div>`：
```tsx
<div
  key={conv.sessionId}
  role="button"
  tabIndex={0}
  onClick={() => handleSelectSession(conv.sessionId)}
  onKeyDown={(e) => {
    if (e.key === "Enter") handleSelectSession(conv.sessionId);
  }}
  className="group w-full text-left rounded-lg px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
>
```

注意加了 `group` class 以支持内部 `group-hover`。

**Step 3: 标题行加编辑按钮**

标题 div 改为 flex 布局，右侧加编辑按钮：
```tsx
<div className="flex items-center gap-1">
  <div className="font-medium text-slate-700 dark:text-slate-200 truncate flex-1">
    {editingId === conv.sessionId ? (
      <input
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleRename(conv.sessionId);
          if (e.key === "Escape") setEditingId(null);
        }}
        onBlur={() => handleRename(conv.sessionId)}
        autoFocus
        className="w-full text-xs font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 outline-none"
      />
    ) : (
      conv.customTitle || conv.lastMessagePreview || conv.sessionId.substring(0, 8)
    )}
  </div>
  {editingId !== conv.sessionId && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditingId(conv.sessionId);
        setEditTitle(conv.customTitle || conv.lastMessagePreview || "");
      }}
      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-opacity shrink-0"
    >
      ✎
    </button>
  )}
</div>
```

关键点：
- `input` 的 `onClick` 加 `e.stopPropagation()` 防止点击 input 触发 session 切换
- `onBlur` 时也调用 `handleRename`（保存），而非直接取消
- 编辑模式时隐藏编辑按钮

**Step 4: handleRename 回调**

```typescript
const handleRename = useCallback(async (sessionId: string) => {
  const trimmed = editTitle.trim();
  if (!trimmed || !token) {
    setEditingId(null);
    return;
  }
  try {
    const res = await fetch(getChatSessionRenameUrl(sessionId), {
      method: "PUT",
      headers: getAuthHeaders(token),
      body: JSON.stringify({ title: trimmed }),
    });
    if (res.ok) {
      setConversations((prev) =>
        prev.map((c) =>
          c.sessionId === sessionId ? { ...c, customTitle: trimmed } : c
        )
      );
    }
  } catch {
    // 静默失败
  }
  setEditingId(null);
}, [editTitle, token]);
```

需要新增 import：`getChatSessionRenameUrl` from `../../config/api`。

**Step 5: 类型检查 + 构建**

Run: `cd mycc-web-react && npx tsc --noEmit && npm run build`
Expected: PASS

**Step 6: Commit**

```bash
git add mycc-web-react/src/components/layout/Sidebar.tsx
git commit -m "feat(sidebar): add inline conversation rename, div-based to avoid button nesting"
```

---

### Task 6: 最终构建验证

**Step 1: TypeScript + Build**

Run: `cd mycc-web-react && npx tsc --noEmit && npm run build`
Expected: PASS

**Step 2: Dev server 人工验收**

Run: `cd mycc-web-react && npx vite --port 3002`

验证清单：
1. [ ] 设置 → 主题三选一（浅色/深色/跟随系统），跟随系统实时响应
2. [ ] 设置 → 侧栏默认展开 toggle 生效
3. [ ] 聊天有消息时 header 显示「清空」按钮，点击确认后回到空白
4. [ ] Sidebar 对话条目 hover 出现编辑图标，点击进入编辑，回车保存
5. [ ] 刷新页面设置恢复正确
