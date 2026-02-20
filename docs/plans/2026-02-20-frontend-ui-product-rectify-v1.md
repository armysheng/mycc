# 前端 UI / 产品整改清单 v1（MyCC）

日期：2026-02-20
分支：codex/ui-prototype-alignment
目标：在不改业务能力的前提下，完成“可用 -> 好用 -> 像一个产品”的前端收敛。

## 0. 评审范围

覆盖页面：
- 聊天主页面（左侧栏 / 中间消息 / 右侧工具箱）
- 设置弹窗
- 移动端 overlay 交互

不包含：
- 新业务能力开发
- 后端接口协议变更

## 1. 设计系统收口（P0）

### 1.1 Token 统一
- 目标：所有核心容器统一使用同一套颜色、边框、阴影、圆角 token。
- 文件：
  - mycc-web-react/src/styles/theme.css
- 验收：
  - 不再出现“同级卡片不同阴影/不同圆角”的视觉冲突
  - 浅/深色切换后，文本对比度与边界仍清晰

### 1.2 组件基线统一
- 目标：按钮/输入框/卡片/标签有统一状态语义（default/hover/active/disabled/error）。
- 文件：
  - mycc-web-react/src/components/layout/Sidebar.tsx
  - mycc-web-react/src/components/layout/RightPanel.tsx
  - mycc-web-react/src/components/panel/PanelTabs.tsx
  - mycc-web-react/src/components/panel/SkillList.tsx
  - mycc-web-react/src/components/panel/AutomationList.tsx
- 验收：
  - 主次按钮对比明确
  - 选中态与 hover 态在各区一致

## 2. 信息架构收口（P0）

### 2.1 单一入口原则
- 目标：会话管理只在侧栏，设置入口只在侧栏底部，避免多入口冲突。
- 文件：
  - mycc-web-react/src/components/ChatPage.tsx
  - mycc-web-react/src/components/layout/Sidebar.tsx
- 验收：
  - Header 不再保留旧会话/旧设置入口
  - 新用户无需猜测“去哪里管理会话”

### 2.2 页面层级梳理
- 目标：标题、工作区信息、辅助信息层级清晰（主信息高可见，辅信息降噪）。
- 文件：
  - mycc-web-react/src/components/ChatPage.tsx
- 验收：
  - 主视觉聚焦消息区
  - 辅助字段（路径/状态）可见但不抢焦点

## 3. 消息体验优化（P1）

### 3.1 气泡与元信息
- 目标：用户/助手气泡具备明确角色识别，时间戳和正文可读性平衡。
- 文件：
  - mycc-web-react/src/components/MessageComponents.tsx
  - mycc-web-react/src/components/messages/MessageContainer.tsx
  - mycc-web-react/src/components/chat/ChatMessages.tsx
- 验收：
  - 3 秒内能分辨谁说的话
  - 长消息阅读不会“糊成一块”

### 3.2 工具消息语义化
- 目标：tool call/tool result 看起来像“过程节点”，而不是噪音块。
- 文件：
  - mycc-web-react/src/components/MessageComponents.tsx
  - mycc-web-react/src/components/messages/CollapsibleDetails.tsx
- 验收：
  - 折叠后不干扰主聊天流
  - 展开后结构完整且易扫描

## 4. 错误与状态设计（P1）

### 4.1 错误分层
- 目标：系统错误、额度错误、网络错误视觉与文案分层明确。
- 文件：
  - mycc-web-react/src/utils/apiError.ts
  - mycc-web-react/src/components/MessageComponents.tsx
- 验收：
  - 用户可一眼区分“可重试 / 需充值 / 服务异常”

### 4.2 空态与加载态
- 目标：空态、加载态、失败态文案统一中文且上下文一致。
- 文件：
  - mycc-web-react/src/components/chat/ChatMessages.tsx
  - mycc-web-react/src/components/ChatPage.tsx
  - mycc-web-react/src/components/layout/Sidebar.tsx
- 验收：
  - 不出现中英混杂
  - 每个状态都有下一步引导

## 5. 移动端体验打磨（P1）

### 5.1 Overlay 互斥与可关闭性
- 目标：Sidebar/RightPanel 互斥打开；Esc 和遮罩关闭稳定。
- 文件：
  - mycc-web-react/src/components/ChatPage.tsx
  - mycc-web-react/src/components/layout/Sidebar.tsx
  - mycc-web-react/src/components/layout/RightPanel.tsx
- 验收：
  - 多次快速切换无“遮罩残留”
  - 触控点击遮罩总能关闭

### 5.2 触控目标与手势路径
- 目标：移动端关键按钮触控面积 >= 36px，操作路径不绕。
- 文件：
  - mycc-web-react/src/components/ChatPage.tsx
  - mycc-web-react/src/components/layout/Sidebar.tsx
- 验收：
  - 单手操作常用路径可达
  - 无“点不到/误触发”

## 6. 联调与验收（P0）

### 6.1 功能面
- 登录/鉴权/聊天链路
- 会话切换与会话隔离
- 设置项生效（工具显示、自动展开思考、字号、昵称）

### 6.2 UI 面
- 桌面（>=1280）、平板（768~1024）、手机（375）三档截图回归
- 与 chat-page-design 原型对照（重点看层级、密度、状态）

### 6.3 自动化建议
- 保留并扩展 mycc-regression skill：
  - API 通路（已有）
  - UI 冒烟（新增 Playwright 脚本）

---

## 执行顺序（建议）
1. 设计系统收口（1.x）
2. 信息架构收口（2.x）
3. 消息体验（3.x）
4. 错误/状态（4.x）
5. 移动端打磨（5.x）
6. 联调验收（6.x）

## 备注
- 当前 UI 对齐分支已完成一部分 1.x 与 2.x；后续按该清单持续收敛。
