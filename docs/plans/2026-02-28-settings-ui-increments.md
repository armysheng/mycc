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

### Task 3: 侧栏默认开关

**Files:**
- Modify: `mycc-web-react/src/types/settings.ts`
- Modify: `mycc-web-react/src/components/settings/GeneralSettings.tsx`
- Modify: `mycc-web-react/src/components/ChatPage.tsx`

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
  description="关闭后桌面端默认收起侧栏。移动端始终默认收起。"
  checked={sidebarDefaultOpen}
  onToggle={() => updateSettings({ sidebarDefaultOpen: !sidebarDefaultOpen })}
/>
```

**Step 3: ChatPage 读取设置**

`isSidebarOpen` 初始值改为从 settings 读取：
```typescript
const { sidebarDefaultOpen } = useSettings();
const [isSidebarOpen, setIsSidebarOpen] = useState(false);

// 仅桌面端使用默认值（Sidebar 在桌面端是 hidden lg:flex，不受此 state 控制）
// 移动端抽屉始终默认关闭
```

注意：当前 Sidebar 桌面端用 `hidden lg:flex` CSS 控制始终可见，和 `isSidebarOpen` state 无关。`isSidebarOpen` 只控制移动端抽屉。所以实际上这个设置需要改 Sidebar 桌面端可见性逻辑。

桌面端改为：如果 `sidebarDefaultOpen` 为 false，桌面端 aside 也隐藏，通过一个 `isDesktopSidebarVisible` state 控制：
```typescript
const [isDesktopSidebarVisible, setIsDesktopSidebarVisible] = useState(sidebarDefaultOpen);
```

Sidebar props 新增 `desktopVisible: boolean`，桌面端 aside className 改为：
```
className={`panel-surface border-r ${desktopVisible ? 'hidden lg:flex' : 'hidden'} flex-col shrink-0`}
```

ChatPage header 新增桌面端 toggle 按钮（仅当侧栏隐藏时显示）。

**Step 4: 类型检查 + 构建**

Run: `cd mycc-web-react && npx tsc --noEmit && npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add mycc-web-react/src/types/settings.ts mycc-web-react/src/components/settings/GeneralSettings.tsx mycc-web-react/src/components/ChatPage.tsx mycc-web-react/src/components/layout/Sidebar.tsx
git commit -m "feat(settings): add sidebar default open toggle with desktop visibility control"
```

---

### Task 4: 清空当前会话

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

**Step 2: handleClearChat 回调**

```typescript
const handleClearChat = useCallback(() => {
  if (!window.confirm("确定清空当前会话？")) return;
  // 利用 handleNewChat 已有的逻辑跳到空白状态
  handleNewChat();
}, [handleNewChat]);
```

注意：`handleNewChat` 已经会 `navigate({ search: "" })`，加上 useChatState 的 initialMessages/initialSessionId 会因 URL 变化重新初始化为空。确认这个路径是否生效，如果不够需要额外清除 state。

**Step 3: 类型检查**

Run: `cd mycc-web-react && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add mycc-web-react/src/components/ChatPage.tsx
git commit -m "feat(chat): add clear conversation button with confirmation"
```

---

### Task 5: 会话重命名

**Files:**
- Modify: `mycc-web-react/src/components/layout/Sidebar.tsx`

**Step 1: 新增 inline 编辑状态**

```typescript
const [editingId, setEditingId] = useState<string | null>(null);
const [editTitle, setEditTitle] = useState("");
```

**Step 2: 对话条目 hover 时显示编辑图标**

在对话 button 内部，标题 div 右侧新增编辑按钮：
```tsx
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
```

对话 button 加 `group` class 以支持 `group-hover`。

**Step 3: 编辑模式渲染**

当 `editingId === conv.sessionId` 时，标题区替换为 input：
```tsx
{editingId === conv.sessionId ? (
  <input
    value={editTitle}
    onChange={(e) => setEditTitle(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") handleRename(conv.sessionId);
      if (e.key === "Escape") setEditingId(null);
    }}
    onBlur={() => setEditingId(null)}
    autoFocus
    className="w-full text-xs font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 outline-none"
  />
) : (
  // 原标题渲染
)}
```

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
git commit -m "feat(sidebar): add inline conversation rename with API call"
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
