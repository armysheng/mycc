# 道友 AI 待办事项

## 测试账号

| 手机号 | 密码 | 昵称 | 沙盒用户（内部） | 套餐 |
|--------|------|------|----------------|------|
| +8613800138000 | test123456 | 测试对话用户 | mycc_u18 | free |

## Landing P0 - 内测前

- [x] **公网预览环境** - `https://daoyou.iaigc.fun` 已部署到 current core，HTTPS 可访问。
- [x] **品牌命名** - 产品名统一为 `道友 AI`，公司名统一为 `念头通达`。
- [x] **首页产品气质打磨** - 第一屏保持生产力工具的克制感，同时加入轻量“道友 AI / 念头通达”元素。
- [x] **初始化文案清理** - 移除“大辉哥 / 老板 / 主人 / cc”等早期内测称呼，统一为中性称呼体系。
- [x] **初始化后端化** - `/api/onboarding/initialize` 由后端确定性写入 sandbox home `~/.claude/about-me`，前端不再启动隐藏 `/api/chat` 会话。
- [x] **初始化后保持项目上下文** - 从 `/projects/demo` 完成初始化后仍回到 demo 项目，不跳到默认项目空间。
- [x] **Auth / readiness P1 hotfix** - 登录不存在账号不再返回“用户不存在”；公网 `/readyz/deep` 无 token 返回 401 且不暴露内部 checks/runtime/E2B。
- [x] **生产发布工具链 guard** - 生产 `npm ci/build` 必须使用 systemd 同款 Node v20.19.5，避免 native addon ABI 错配导致 SIGSEGV。
- [ ] **生产验证闭环** - 固化公网预发布回归：`/health`、`/readyz`、`/readyz/deep`、登录注册、初始化、IDE smoke、desktop smoke、Agent SDK workspace smoke。
- [ ] **Release candidate live gate** - 对当前部署运行 `landing-live`，包含 auth/onboarding smoke 与 E2B IDE/desktop/Agent SDK workspace smoke。
- [ ] **Rollback rehearsal** - 演练配置回滚到 `remote-claude` / `IDE disabled` / `workspace ssh`，并记录恢复步骤。
- [ ] **产品表面审计** - 独立只读验收 `https://daoyou.iaigc.fun/projects/demo`，输出 P0/P1/P2 和是否适合邀请 1-3 人内测。

## Landing P1 - 内测期

- [ ] **邮箱或手机验证** - 至少支持一个 verified channel，包含验证码 TTL、重试限制、发送服务和前端输入态。
- [ ] **Google / GitHub 登录** - 新增 OAuth provider、callback、账号绑定/解绑、同邮箱合并策略和 CSRF state 校验。
- [ ] **密码重置** - 支持申请、发送、验证、单次使用 reset token，密码变更后使旧会话失效。
- [ ] **Auth audit** - 记录注册、登录成功/失败、重置、OAuth 绑定、profile 修改、禁用/启用等事件。
- [ ] **生产配置产品化** - CORS 改为 env allowlist，补上线前凭据轮换清单，避免裸 host、sandbox、linux user 等内部细节进入前台 UI。
- [ ] **Agent SDK 专用 provider env** - 将生产备份 patch 中的 Agent SDK base URL `/v1` 归一化和低层错误产品化拆成独立测试 PR。

## Landing P2 - 增强

- [ ] **会话体系升级** - Refresh token / session 表、设备列表、退出全部设备。
- [ ] **安全增强** - MFA、passkey、captcha、异常 IP 和爆破告警。
- [ ] **管理后台** - 用户搜索、封禁/解封、重置密码、审计查看。
- [ ] **Token 存储方案评估** - 从 `localStorage` 迁移到更安全的 cookie/session 方案时，配套 CSRF 策略。

## UI 优化

- [ ] **代码语法高亮** - 前端显示的代码块没有语法高亮，需要集成代码高亮库（如 highlight.js 或 prism.js）。

## 已知问题

- [ ] `/api/projects` 接口返回 404（前端请求但后端未实现）。

## 已完成基础能力

- [x] 用户认证系统（注册/登录/JWT）
- [x] 实时聊天对话（SSE 流式响应）
- [x] 消息渲染修复（支持后端直接返回的消息格式）
- [x] 多用户隔离（独立工作空间）
- [x] 端到端测试
