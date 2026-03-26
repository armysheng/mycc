# 定价系统 V1 设计（值回票价版）

> 日期：2026-03-01  
> 状态：V1 已实现（后端 + 前端展示）  
> 目标：让用户清楚“为什么升级”，并支持快速运营调价

---

## 1. 背景

当前系统已具备额度扣减与升级能力，但存在三个问题：

1. 套餐价格、额度散落在多个文件，运营难以统一调参。
2. 前端没有套餐对比与推荐，用户只看到“额度不足”。
3. 缺少“值回票价”指标，升级决策成本高。

---

## 2. 定价原则

1. 先做 3 档：`free / basic / pro`，避免 SKU 过多。
2. 用“每千 tokens 成本 + 月可完成任务数”表达价值。
3. 价格与额度都可由环境变量调节，不改代码即可运营试错。

---

## 3. 套餐结构（V1）

默认值（可通过环境变量覆盖）：

1. `free`：¥0 / 月，`300,000` tokens
2. `basic`：¥39 / 月，`3,000,000` tokens（推荐档）
3. `pro`：¥99 / 月，`12,000,000` tokens

新增环境变量：

1. `PLAN_BASIC_PRICE_CNY`
2. `PLAN_PRO_PRICE_CNY`

---

## 4. 值回票价指标

V1 对每个套餐计算并返回：

1. `cny_per_1k_tokens`：每千 tokens 成本
2. `tokens_per_cny`：每 1 元可用 tokens
3. `estimated_deep_tasks`：估算可完成深度任务数（按 12k tokens/任务）

说明：

1. 这是面向用户的“价值解释层”，不是财务结算层。
2. 后续可按真实行为数据动态修正“12k tokens/任务”系数。

---

## 5. 推荐逻辑（V1）

基于用户当前月度消耗，估算当月投影消耗 `projected_monthly_tokens`：

1. 若投影 <= free 限额，推荐 free。
2. 若投影 > free 且 <= basic，推荐 basic。
3. 若投影 > basic，推荐 pro。

输出：

1. 推荐套餐 ID
2. 推荐理由（可直接展示在前端）

---

## 6. API 设计

新增：

1. `GET /api/billing/plans`
- 返回套餐目录、当前套餐、投影消耗、推荐结果。

增强：

1. `GET /api/billing/subscription`
- 增加 `plan_name`、`monthly_price_cny`、`cny_per_1k_tokens`、`estimated_deep_tasks`。

2. `POST /api/billing/upgrade`
- 统一通过套餐目录校验升级合法性与目标额度。
- 返回升级后的价格与套餐名。

---

## 7. 前端交互（V1）

设置页新增“套餐与额度”模块：

1. 当前套餐、剩余额度、进度条、重置时间。
2. 套餐卡片对比（价格、额度、价值指标、亮点）。
3. 一键升级按钮（当前套餐不可点，升级态有 loading）。
4. 推荐文案直出，降低决策成本。

---

## 8. 已实现清单（2026-03-01）

后端：

1. 新增 `mycc-backend/src/billing/plan-catalog.ts`（单一事实源）。
2. `billing` 路由接入目录与推荐逻辑。
3. `db/client.ts` 的默认额度与升级额度改为读取目录。

前端：

1. 新增 `mycc-web-react/src/api/billing.ts`。
2. 设置页接入套餐与额度展示、升级动作。

配置：

1. `.env.example` 增加价格变量，额度默认值升级。
2. `README/TESTING/VPS-TESTING/quick-deploy` 同步默认值。

---

## 9. 参考锚点（外部）

用于校准“用户心理价位”，不做 1:1 跟随：

1. ChatGPT Plus 官方公开价 `$20/月`（OpenAI help）  
   [OpenAI Help - ChatGPT Plus](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)
2. Claude Max 官方公开价 `$100/$200` 档（Anthropic pricing）  
   [Anthropic Pricing](https://www.anthropic.com/pricing)
3. GitHub Copilot 公开个人价 `$10/月`（GitHub 官方）  
   [GitHub Copilot Plans](https://github.com/features/copilot/plans)

---

## 10. 下一步（V1.5）

1. 增加“超额后按量计费”策略（当前仅硬性额度）。
2. 增加“团队版”套餐（席位 + 共享额度）。
3. 支付接入（订单、回调、对账）。
4. A/B 测试价格点（39/49/59 与 99/129 对比）。
