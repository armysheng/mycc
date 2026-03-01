# 技能市场重构 V1 设计文档

> 日期: 2026-03-01
> 状态: 待实施
> 实施: Claude (cc)
> 验收: Codex

---

## 1. 目标

把技能市场从"对接外部源"改为"注册表驱动的自有策展市场"，实现：

1. 用户只看到自有技能，不暴露 ClawHub/SkillsMP
2. 默认预装常用技能，开箱即用
3. 完整的安装/卸载/启用/禁用管理闭环
4. 全新市场 UI（对齐 Codex 设计风格）

## 2. 不在本期范围

- 不接 ClawHub/SkillsMP 在线搜索/安装
- 不做 skill-importer meta-skill
- 不做多租户运营配置后台
- 不做升级（upgrade）产品化

---

## 3. 架构设计

### 3.1 数据源

```
skill-registry.json          用户已安装目录
(唯一市场策展源)              (~/.claude/skills/*)
       │                            │
       └──────────┬─────────────────┘
                  │
         RemoteSkillStore.listSkillInfos()
                  │
          ┌───────┴───────┐
          │   合并规则     │
          │               │
          │ 注册表有 + 已装 → installed (市场+已安装都可见)
          │ 注册表有 + 未装 → available (仅市场推荐可见)
          │ 注册表无 + 已装 → installed (仅已安装可见，可卸载，不进推荐)
          └───────┬───────┘
                  │
            GET /api/skills → 前端
```

### 3.2 skill-registry.json 结构

```json
{
  "version": 1,
  "skills": [
    {
      "id": "tell-me",
      "name": "通知与摘要助手",
      "description": "整理摘要并发送通知",
      "icon": "💬",
      "category": "工具",
      "triggers": ["/tell-me"],
      "source": "registry",
      "defaultInstall": true
    }
  ]
}
```

字段说明：
- `source: "registry"` — 来自注册表的策展技能
- `defaultInstall: true` — 首次登录自动安装
- `category` — 预留字段，V1 前端暂不使用

注册表放在后端代码里版本化（`src/skills/skill-registry.json`），不是运行时文件。

### 3.3 外部源旁路（P0）

`RemoteSkillStore` 改造：
1. `listSkillInfos()` — 删除 ClawHub 合并块（`clawhubAdapter.listAvailableSkills` 调用）
2. `searchSkills()` — 改为本地搜索，按 id/name/description/trigger 模糊匹配注册表 + 已安装
3. `installSkill()` — 删除 ClawHub fallback 分支，只从本地 catalog 安装

ClawHub 相关代码保留但不调用，避免删除后丢失参考。

---

## 4. 首次自动安装（P0）

### 4.1 触发时机

首次 `GET /api/skills` 请求时触发。

### 4.2 幂等保证

1. 读取用户 manifest，检查 `bootstrapped: true` 标记
2. 若已标记 → 跳过
3. 未标记 → 加内存锁（per-user Map），防止并发请求重复安装
4. 遍历注册表中 `defaultInstall: true` 的条目
5. 对每个条目：检查用户目录是否已存在 → 不存在则从 catalog 复制
6. 写入 manifest 每个技能的记录 + `bootstrapped: true`
7. 释放锁

### 4.3 catalog 初始化

当 catalog 目录为空时，按注册表中所有条目（不仅是 defaultInstall）生成 SKILL.md 模板。保持幂等。

---

## 5. API 变更

| 接口 | 变更 |
|------|------|
| `GET /api/skills` | 数据源改为注册表 + 已安装目录合并；首次触发自动安装 |
| `GET /api/skills/search?q=` | 改为本地搜索，按 id/name/description/trigger 模糊匹配 |
| `POST /api/skills/:id/install` | 保留，仅从本地 catalog 安装 |
| **`POST /api/skills/:id/uninstall`** | **新增** |
| `POST /api/skills/:id/enable` | 保留不改 |
| `POST /api/skills/:id/disable` | 保留不改 |
| `POST /api/skills/:id/upgrade` | 保留但前端不调用 |

### 5.1 卸载接口

`POST /api/skills/:skillId/uninstall`

逻辑：
1. 删除 `/home/<user>/workspace/.claude/skills/<skillId>/` 目录
2. 从 `manifest.skills[skillId]` 删除条目
3. 从 `lock.skills[skillId]` 删除条目
4. 目录不存在时也返回成功（幂等）
5. 返回 `{ success: true, data: { skillId, uninstalled: true } }`

### 5.2 类型变更

```typescript
// SkillActionResult 新增
export interface SkillActionResult {
  skillId: string;
  success: boolean;
  enabled?: boolean;
  version?: string;
  uninstalled?: boolean;  // 新增
}

// SkillInfo.source 可见值
// V1 对外保证: "registry" | "catalog" | "user" | "clawhub"(历史遗留)
```

---

## 6. 前端 UI 设计

### 6.1 页面结构（对齐 Codex 设计稿）

单页两分区布局，不是 tab 切换：

```
┌─────────────────────────────────────┐
│  Skills                     [刷新]  │
│  浏览和管理 AI 能力                  │
│                                     │
│  [搜索技能...]                      │
│                                     │
│  ── 已安装 ──────────────────────── │
│  ┌──────────────┐ ┌──────────────┐  │
│  │ 💬 通知助手   │ │ ⏰ 任务编排   │  │
│  │ 整理摘要...  │ │ 自动化任务.. │  │
│  │       [toggle]│ │       [toggle]│  │
│  └──────────────┘ └──────────────┘  │
│                                     │
│  ── 推荐 ────────────────────────── │
│  ┌──────────────┐ ┌──────────────┐  │
│  │ 🔍 代码审查   │ │ 📝 文档写作   │  │
│  │ 审查代码...  │ │ 文档写作...  │  │
│  │           [+] │ │           [+] │  │
│  └──────────────┘ └──────────────┘  │
└─────────────────────────────────────┘
```

### 6.2 卡片交互

| 状态 | 卡片上的操作 | 点击卡片 |
|------|-------------|---------|
| 已安装 + 启用 | Toggle 开关（亮色） | 打开详情弹窗 |
| 已安装 + 禁用 | Toggle 开关（灰色） | 打开详情弹窗 |
| 未安装（推荐） | `+` 按钮安装 | 打开详情弹窗 |

### 6.3 详情弹窗

```
┌─────────────────────────────────────┐
│  [×]                                │
│                                     │
│  💬  通知与摘要助手                   │
│  tell-me · v1.0.0                   │
│                                     │
│  整理摘要并发送通知到飞书群            │
│                                     │
│  示例提示                            │
│  ┌─────────────────────────────┐    │
│  │ "帮我总结今天的对话要点"      │    │
│  └─────────────────────────────┘    │
│                                     │
│  触发词: /tell-me                    │
│  来源: registry                      │
│                                     │
│  ┌────────┐ ┌────────┐ ┌────────┐  │
│  │  卸载  │ │  禁用  │ │  试用  │  │
│  └────────┘ └────────┘ └────────┘  │
└─────────────────────────────────────┘
```

- **卸载**: confirm 确认后执行，成功后关闭弹窗刷新列表
- **禁用/启用**: 即时切换
- **试用**: `navigate("/", { state: { prefill: "/tell-me " } })`
- 未安装技能的详情弹窗底栏显示 **安装** 按钮替代卸载/禁用

### 6.4 搜索

- 搜索框输入 → 防抖 300ms → `GET /api/skills/search?q=xxx`
- 搜索结果混合展示（已安装+推荐），不分区
- 清空搜索 → 回到分区模式

---

## 7. 默认技能清单

### 7.1 策展清单（10 个）

| # | ID | 名称 | defaultInstall | 状态 |
|---|-----|------|:---:|------|
| 1 | tell-me | 通知与摘要助手 | ✅ | 已有 |
| 2 | scheduler | 任务编排 | ✅ | 已有 |
| 3 | cc-usage | 用量分析 | ✅ | 已有 |
| 4 | mycc-regression | 回归检查 | ✅ | 已有 |
| 5 | read-gzh | 读公众号 | ❌ | 已有 |
| 6 | dashboard | 能力看板 | ❌ | 已有 |
| 7 | skill-creator | 创建技能 | ❌ | 已有 |
| 8 | code-review | 代码审查 | ❌ | 需新建 |
| 9 | docs-writer | 文档写作 | ❌ | 需新建 |
| 10 | web-summarize | 网页摘要 | ❌ | 需新建 |

4 个核心自动安装，其余 6 个作为市场推荐可安装项。

### 7.2 新建技能的 SKILL.md（V1 最小版）

需新建的 3 个技能，V1 只需生成包含 frontmatter 和基础描述的 SKILL.md。具体 prompt 内容后续迭代。

---

## 8. 目录复制导入规范

手动导入外部技能的方式：

1. **导入路径**: 复制到用户的 `skills-catalog/<skillId>/SKILL.md`
2. **最小文件**: 必须有 `SKILL.md`（含 frontmatter）
3. **刷新策略**: 前端点击"刷新"后可见
4. **冲突策略**: `skillId` 冲突时以 catalog 内当前目录为准
5. **校验**: `skillId` 仅允许 `[a-zA-Z0-9_-]`，不合法条目忽略

---

## 9. 测试与验收场景

1. **列表**: 仅出现本地来源技能，不出现 ClawHub/SkillsMP 来源
2. **搜索**: 输入关键词只能命中本地技能
3. **安装**: 推荐技能可安装，安装后进入"已安装"区
4. **卸载**: 已安装技能可卸载，卸载后回到"推荐"区（若在注册表中）或消失
5. **启用/禁用**: toggle 切换正常，状态即时更新
6. **幂等**: 重复卸载同一技能返回成功
7. **首次自动安装**: 新用户首次请求后 4 个 defaultInstall 技能自动出现
8. **导入**: 手工复制 skill 目录到 catalog 后刷新可见
9. **历史兼容**: 已安装但不在注册表的技能在"已安装"可见可卸载
10. **回归**: 前端 build、后端 build 通过

## 10. 验收标准

1. 用户端看不到外部市场来源
2. 用户可完成"安装-使用-卸载"闭环
3. 启用/禁用 toggle 正常工作
4. 默认 4 个技能首次登录自动安装
5. 目录复制导入可稳定识别
6. 编译与核心冒烟通过
