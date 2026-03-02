# 回归冒烟清单（Regression Smoke）

更新时间：2026-03-02

## PR 门禁

- 前端构建通过：`npm -C mycc-web-react run build`
- 后端构建通过：`npm -C mycc-backend run build`
- 核心流程可用：登录、聊天、技能页打开、技能安装/卸载、自动化页打开

## Main 门禁

- PR 门禁全部通过
- 测试环境部署成功
- `http://34.85.0.184:3080/health` 返回 200

## 失败记录规范

- 记录用例编号、环境、时间、错误信息
- 必须附证据：截图或日志片段
- 结论标记：`PASS` / `FAIL` / `BLOCKED`

