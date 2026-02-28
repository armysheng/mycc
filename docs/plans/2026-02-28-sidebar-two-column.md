# 三栏→两栏布局重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将三栏布局（Sidebar + Chat + RightPanel）重构为两栏（Sidebar + Chat），技能/自动化合入左侧 Sidebar，补全用户信息/退出按钮，适配移动端。

**Architecture:** 删除 RightPanel，Sidebar 改为三 tab（对话/技能/自动化）+ 底部用户区。Tab 状态由 ChatPage 持有并通过 props 下发，避免状态不同步。移动端 Sidebar 默认隐藏，通过抽屉+遮罩交互。数据页面进入即并行加载，tab 切换用缓存。

**Tech Stack:** React 19, Vite, Tailwind CSS, react-router-dom

---

### 数据加载策略

- **页面进入即加载**（ChatPage mount 时触发），不依赖 Sidebar 可见/抽屉打开
- 会话列表 + 技能 + 自动化一次并行请求
- Tab 切换不重复请求，使用已缓存数据
- 手动刷新按钮才重新拉取（带 loading 状态）
- 失败时保留旧数据，显示错误提示

### 移动端策略

- Sidebar 桌面端 `hidden lg:flex`，移动端通过 `isOpen` prop 抽屉滑入
- 聊天区默认全宽
- 技能入口：打开抽屉并切到 skills tab（`setSidebarActiveTab("skills")` + `setIsSidebarOpen(true)`）
- 抽屉打开时加半透明遮罩，点击遮罩关闭

---

### Task 1: 重构 Sidebar — 合并 RightPanel 只读功能 + 用户信息

**Files:**
- Modify: `mycc-web-react/src/components/layout/Sidebar.tsx` (全面重写)

**关键数据来源：**
- 会话列表：`getChatSessionsUrl()` + `ConversationSummary` 类型（同 `HistoryView.tsx:22-41`）
- 技能列表：`getSkillsUrl()` + `SkillItem` 接口（同 `RightPanel.tsx:16-29`）
- 自动化列表：`getAutomationsUrl()` + `AutomationItem` 接口（同 `RightPanel.tsx:31-39`）
- 用户信息：`useAuth()` → `user`（`nickname`, `email`, `phone`, `plan`）+ `logout()`

**新 Props 接口：**

```typescript
interface SidebarProps {
  onNewChat: () => void;
  currentPathLabel?: string;
  // Tab 状态由 ChatPage 持有
  activeTab: "conversations" | "skills" | "automations";
  onTabChange: (tab: "conversations" | "skills" | "automations") => void;
  // 技能使用回调
  onSkillUse?: (trigger: string) => void;
  // 移动端抽屉
  isOpen: boolean;
  onClose: () => void;
}
```

**Step 1: 编写新 Sidebar 完整代码**

```tsx
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ConversationSummary } from "../../types";
import {
  getChatSessionsUrl,
  getSkillsUrl,
  getAutomationsUrl,
  getAuthHeaders,
} from "../../config/api";
import { useAuth } from "../../contexts/AuthContext";

type SidebarTab = "conversations" | "skills" | "automations";

interface SidebarProps {
  onNewChat: () => void;
  currentPathLabel?: string;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onSkillUse?: (trigger: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  icon: string;
  status: "installed" | "available" | "disabled";
  installed: boolean;
}

interface AutomationItem {
  id: string;
  name: string;
  scheduleText: string;
  skill: string;
  description: string;
  status: "healthy" | "paused" | "error";
  enabled: boolean;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHr < 24) return `${diffHr}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return date.toLocaleDateString();
}

export function Sidebar({
  onNewChat,
  activeTab,
  onTabChange,
  onSkillUse,
  isOpen,
  onClose,
}: SidebarProps) {
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();

  // === 数据状态 ===
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // === 首次并行加载（页面进入即触发，不依赖抽屉） ===
  const loadAllData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [sessionsRes, skillsRes, automationsRes] = await Promise.all([
        fetch(`${getChatSessionsUrl()}?limit=30&offset=0`, {
          headers: getAuthHeaders(token),
        }),
        fetch(getSkillsUrl(), { headers: getAuthHeaders(token) }),
        fetch(getAutomationsUrl(), { headers: getAuthHeaders(token) }),
      ]);

      if (sessionsRes.ok) {
        const data = await sessionsRes.json();
        const rows = data?.data?.conversations || [];
        setConversations(
          rows.map((item: any) => ({
            sessionId: item.sessionId,
            startTime: item.createdAt,
            lastTime: item.updatedAt,
            messageCount: item.messageCount ?? 0,
            lastMessagePreview: item.title || "Untitled",
            customTitle: item.title || null,
          })),
        );
      }

      if (skillsRes.ok) {
        const data = await skillsRes.json();
        setSkills((data?.data?.skills || []) as SkillItem[]);
      }

      if (automationsRes.ok) {
        const data = await automationsRes.json();
        setAutomations(
          (data?.data?.automations || []) as AutomationItem[],
        );
      }

      setDataLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token && !dataLoaded) {
      loadAllData();
    }
  }, [token, dataLoaded, loadAllData]);

  // === 手动刷新 ===
  const handleRefresh = useCallback(() => {
    setDataLoaded(false);
  }, []);

  // token 变化时重置
  useEffect(() => {
    if (!token) {
      setConversations([]);
      setSkills([]);
      setAutomations([]);
      setDataLoaded(false);
    }
  }, [token]);

  const handleSelectSession = (sessionId: string) => {
    const searchParams = new URLSearchParams();
    searchParams.set("sessionId", sessionId);
    navigate({ search: searchParams.toString() });
    onClose(); // 移动端关闭抽屉
  };

  const installedSkills = useMemo(
    () => skills.filter((s) => s.installed),
    [skills],
  );

  // === 用户信息 ===
  const userInitial = user?.nickname?.charAt(0)?.toUpperCase() || "U";
  const userDisplayName =
    user?.nickname || user?.email || user?.phone || "用户";

  // === Tab 配置 ===
  const tabs: { key: SidebarTab; label: string }[] = [
    { key: "conversations", label: "对话" },
    { key: "skills", label: "技能" },
    { key: "automations", label: "自动化" },
  ];

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="p-4 border-b panel-surface">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-lg text-white flex items-center justify-center font-semibold"
            style={{ background: "var(--accent)" }}
          >
            cc
          </div>
          <div>
            <div className="text-sm font-semibold">MyCC</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              多用户助手
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-700 text-white transition-colors"
        >
          + 新对话
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 pb-2 border-b panel-surface">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              className={`flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors ${
                activeTab === t.key
                  ? "text-[var(--text-inverse)]"
                  : "panel-surface hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
              style={
                activeTab === t.key
                  ? {
                      background: "var(--accent)",
                      borderColor: "var(--accent)",
                    }
                  : undefined
              }
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleRefresh}
            className="px-2 py-1 text-xs rounded border panel-surface hover:bg-slate-100 dark:hover:bg-slate-800"
            title="刷新"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 p-2 text-xs text-red-600 dark:text-red-400 mb-2">
            {error}
          </div>
        )}

        {/* 对话 Tab */}
        {!loading && activeTab === "conversations" && (
          <>
            {conversations.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500 py-2">
                暂无对话记录
              </div>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <button
                    key={conv.sessionId}
                    type="button"
                    onClick={() => handleSelectSession(conv.sessionId)}
                    className="w-full text-left rounded-lg px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="font-medium text-slate-700 dark:text-slate-200 truncate">
                      {conv.customTitle ||
                        conv.lastMessagePreview ||
                        conv.sessionId.substring(0, 8)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-slate-400 dark:text-slate-500">
                      <span>
                        {formatTime(conv.lastTime || conv.startTime)}
                      </span>
                      <span>{conv.messageCount} 条</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* 技能 Tab（只读：已安装 + 使用） */}
        {!loading && activeTab === "skills" && (
          <>
            {installedSkills.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500 py-2">
                暂无已安装技能
              </div>
            ) : (
              <div className="space-y-2">
                {installedSkills.map((skill) => (
                  <div key={skill.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span>{skill.icon}</span>
                      <div className="font-medium text-sm flex-1 truncate">
                        {skill.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onSkillUse?.(skill.trigger);
                          onClose();
                        }}
                        className="px-2 py-1 text-xs rounded border panel-surface hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                      >
                        使用
                      </button>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 truncate">
                      {skill.description || "无描述"}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      触发词: <code>{skill.trigger}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 自动化 Tab（只读） */}
        {!loading && activeTab === "automations" && (
          <>
            {automations.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500 py-2">
                暂无自动化任务
              </div>
            ) : (
              <div className="space-y-2">
                {automations.map((item) => (
                  <div key={item.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-sm">{item.name}</div>
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded border">
                        {item.enabled ? "启用中" : "已暂停"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {item.scheduleText}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {item.skill} · {item.description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部用户信息 */}
      <div className="p-4 border-t panel-surface">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full text-white flex items-center justify-center text-sm font-semibold shrink-0"
            style={{ background: "var(--accent)" }}
          >
            {userInitial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {userDisplayName}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-xs text-slate-500 hover:text-red-500 transition-colors shrink-0"
          >
            退出
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* 桌面端固定 Sidebar */}
      <aside
        className="panel-surface border-r hidden lg:flex flex-col shrink-0"
        style={{ width: "var(--sidebar-width)" }}
      >
        {sidebarContent}
      </aside>

      {/* 移动端抽屉 */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={onClose}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 lg:hidden flex flex-col panel-surface shadow-xl">
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  );
}
```

**Step 2: 确认文件保存，检查无语法错误**

Run: `cd mycc-web-react && npx tsc --noEmit 2>&1 | head -20`
Expected: 暂时有 ChatPage 引用旧 props 的错误（Task 2 修复）

**Step 3: Commit**

```bash
git add mycc-web-react/src/components/layout/Sidebar.tsx
git commit -m "feat(sidebar): three-tab layout with conversations, skills, automations + user info"
```

---

### Task 2: ChatPage 移除 RightPanel + 适配移动端

**Files:**
- Modify: `mycc-web-react/src/components/ChatPage.tsx`

**Step 1: 修改 ChatPage**

需要做的改动清单：

1. **删除引用：**
   - 删除 `import { RightPanel } from "./layout/RightPanel"`
   - 删除 `<RightPanel>` JSX
   - 删除 `isRightPanelCollapsed` 状态 + `handleRightPanelToggle`
   - 删除 header 中"收起/打开工具箱"按钮（两个 `lg:inline-flex` 按钮）

2. **新增状态：**
   ```typescript
   const [isSidebarOpen, setIsSidebarOpen] = useState(false);
   const [sidebarActiveTab, setSidebarActiveTab] = useState<
     "conversations" | "skills" | "automations"
   >("conversations");
   ```

3. **更新 Sidebar props：**
   ```tsx
   <Sidebar
     onNewChat={handleNewChat}
     currentPathLabel={workingDirectory}
     activeTab={sidebarActiveTab}
     onTabChange={setSidebarActiveTab}
     onSkillUse={handleSkillUse}
     isOpen={isSidebarOpen}
     onClose={() => setIsSidebarOpen(false)}
   />
   ```

4. **移动端 header 按钮：**
   - 新增汉堡按钮（`lg:hidden`）→ `setIsSidebarOpen(true)`
   - 移动端"技能"按钮改为：`setSidebarActiveTab("skills"); setIsSidebarOpen(true);`

5. **保留 SettingsButton 不动**

6. **删除不再需要的 imports：**
   - 删除 `handleOpenSkills` / `handleRightPanelToggle` 回调（如不再用）

**Step 2: 运行类型检查**

Run: `cd mycc-web-react && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add mycc-web-react/src/components/ChatPage.tsx
git commit -m "feat(chatpage): remove RightPanel, add sidebar drawer for mobile"
```

---

### Task 3: 删除 RightPanel 组件

**Files:**
- Delete: `mycc-web-react/src/components/layout/RightPanel.tsx`

**Step 1: 全局搜索确认无其他引用**

Run: `grep -r "RightPanel" mycc-web-react/src/ --include="*.ts" --include="*.tsx"`
Expected: 无匹配结果（ChatPage 已在 Task 2 中删除引用）

**Step 2: 删除文件**

```bash
rm mycc-web-react/src/components/layout/RightPanel.tsx
```

**Step 3: Commit**

```bash
git add mycc-web-react/src/components/layout/RightPanel.tsx
git commit -m "chore: remove RightPanel component (merged into Sidebar)"
```

---

### Task 4: 构建验证

**Step 1: TypeScript 类型检查**

Run: `cd mycc-web-react && npx tsc --noEmit`
Expected: PASS，零错误

**Step 2: 生产构建**

Run: `cd mycc-web-react && npm run build`
Expected: 构建成功

**Step 3: 启动 dev server 人工验证**

Run: `cd mycc-web-react && npx vite --port 3002`

---

## 验证清单

### 桌面端
1. 左侧 Sidebar 三个 tab 正常切换（对话/技能/自动化）
2. 会话列表展示 + 点击加载历史
3. 技能 tab 展示已安装技能 + "使用"按钮触发斜杠命令
4. 自动化 tab 展示任务列表
5. 底部显示用户昵称 + 退出按钮，点击退出回到登录页
6. 右侧面板完全消失，聊天区全宽
7. 刷新页面消息恢复

### 移动端
8. Sidebar 默认隐藏，聊天区全宽
9. 汉堡按钮点击 → Sidebar 抽屉滑入 + 遮罩
10. 点击遮罩 → 抽屉关闭
11. 输入框完整可见，无水平滚动

### API 级检查（DevTools Network 验收）
12. 首屏加载：sessions + skills + automations 共 3 个并行请求（仅 1 次）
13. 切换 tab：Network 无新请求
14. 点击刷新按钮：对应 API 重新请求（带 loading spinner）

---

## PR2（P1，后续）

- 用户菜单弹窗（套餐展示/升级入口/设置入口）
- 技能安装/升级整合到 Sidebar（或保留 /skills 页面）
- 设置入口从 header 迁移到用户菜单
