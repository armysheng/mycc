# Phase 2 联调验证清单（Skills / Automations）

## 目标
将前端右侧工具箱从 mock 数据切换为真实后端 API：
- `GET /api/skills`
- `GET /api/automations`

## 已完成改造
- 右侧面板改为真实请求：
  - `mycc-web-react/src/components/layout/RightPanel.tsx`
- 保留统一错误处理：
  - `parseApiErrorResponse`
  - `getNetworkErrorMessage`
- 补充空态展示：
  - `mycc-web-react/src/components/panel/SkillList.tsx`
  - `mycc-web-react/src/components/panel/AutomationList.tsx`

## 本地联调前置
1. 启动后端（默认 `8080`）。
2. 启动前端（当前开发端口 `3001`）。
3. 登录一个有效用户，确保浏览器里有 token。

## 手工验证步骤
1. 打开聊天页，确认右侧工具箱默认加载。
2. 切到“技能”标签页，确认显示后端返回列表。
3. 切到“自动化”标签页，确认显示后端返回列表。
4. 停掉后端后刷新页面，确认右栏显示红色错误提示与“重试”按钮。
5. 恢复后端后点击“重试”，确认数据恢复。
6. 若后端返回空数组，确认显示“暂无技能数据/暂无自动化任务”。

## 验收标准
- 无 mock 数据依赖。
- 401/403/5xx/网络失败可读错误可见。
- 数据加载、空态、错误态、恢复态完整可用。

## 后续建议
1. 为右栏增加 `lastUpdated` 时间戳，便于排查缓存/刷新问题。
2. 为 `RightPanel` 补组件测试（成功态、空态、错误态）。
3. 结合后端后续能力，增加自动化启停、技能安装等交互动作。
