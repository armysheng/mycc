# 用户设置 UI 增量 Design

**Goal:** 补全 4 项缺失的设置/交互功能（纯前端，不涉及后端持久化）。

**Tech Stack:** React 19, Vite, Tailwind CSS, 现有 useSettings hook + AppSettings 类型

---

## 现有基础设施

- `types/settings.ts` — `AppSettings` 接口、`Theme`/`EnterBehavior`/`FontSize` 类型
- `utils/storage.ts` — `getSettings()`/`setSettings()` localStorage 读写
- `hooks/useSettings.ts` — settings context hook
- `components/settings/GeneralSettings.tsx` — 设置面板 UI
- `config/api.ts` — `getChatSessionRenameUrl(sessionId)` 已有

---

## Task 1: 主题加「跟随系统」

**Files:**
- Modify: `types/settings.ts`
- Modify: `hooks/useSettings.ts`
- Modify: `components/settings/GeneralSettings.tsx`
- Modify: `utils/storage.ts`

**改动：**

1. `Theme` 类型扩展：`"light" | "dark"` → `"light" | "dark" | "system"`
2. `DEFAULT_SETTINGS.theme` 改为 `"system"`
3. useSettings hook 新增 `resolvedTheme` 计算属性：
   - `system` 时读 `window.matchMedia("(prefers-color-scheme: dark)")`
   - 监听 `change` 事件实时切换
4. GeneralSettings 主题区改为三选一按钮组（浅色/深色/跟随系统），复用字号选择器样式
5. `CURRENT_SETTINGS_VERSION` 升级到 3，migration 兼容旧值

**验证：** 切换到「跟随系统」后，修改系统主题偏好，页面实时跟随。

---

## Task 2: 侧栏默认开关

**Files:**
- Modify: `types/settings.ts`
- Modify: `components/settings/GeneralSettings.tsx`
- Modify: `components/ChatPage.tsx`

**改动：**

1. `AppSettings` 新增 `sidebarDefaultOpen: boolean`，默认 `true`
2. GeneralSettings 外观区新增 ToggleRow「侧栏默认展开」
3. ChatPage `isSidebarOpen` 初始值从 settings 读取，移动端（`< lg`）始终 `false`

**验证：** 设置关闭后刷新页面，桌面端 Sidebar 默认收起。

---

## Task 3: 清空当前会话

**Files:**
- Modify: `components/ChatPage.tsx`

**改动：**

1. Header 按钮区新增「清空」按钮（仅当有消息时显示）
2. 点击弹 `window.confirm("确定清空当前会话？")`
3. 确认后：`messages` 清空、`currentSessionId` 置 null、URL search 清空
4. 不调后端删除 API，仅前端重置状态

**验证：** 有消息时显示按钮，点击确认后回到空白新对话状态。

---

## Task 4: 会话重命名

**Files:**
- Modify: `components/layout/Sidebar.tsx`

**改动：**

1. 对话条目 hover 时右侧显示编辑图标按钮
2. 点击编辑进入 inline 编辑模式（input 替换标题文字）
3. Enter 保存、Escape 取消
4. 保存时调 `getChatSessionRenameUrl(sessionId)` PUT 请求
5. 成功后更新本地 conversations 状态

**验证：** 点击编辑 → 输入新标题 → 回车 → 标题更新且刷新后保持。

---

## 验证清单

1. [ ] 主题三选一正常工作，「跟随系统」实时响应
2. [ ] 侧栏默认开关设置生效，移动端不受影响
3. [ ] 清空会话按钮正常工作，带确认弹窗
4. [ ] 会话重命名 inline 编辑，调后端 API 持久化
5. [ ] `npm run build` 零错误
6. [ ] 刷新页面设置恢复正确
