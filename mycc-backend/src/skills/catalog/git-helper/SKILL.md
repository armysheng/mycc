---
name: git-helper
description: Git 工作流辅助工具，生成规范的 commit message、PR 描述，协助解决合并冲突
version: 1.0.0
source: mycc-marketplace
triggers:
  - /git-helper
---

## Overview

git-helper 是日常 Git 操作的得力助手。它能根据代码 diff 自动生成符合 Conventional Commits 规范的 commit message，让你的提交历史清晰可追溯。写 PR 描述时，它会分析变更内容，生成结构化的摘要、变更列表和测试说明。

遇到合并冲突不用慌，git-helper 会逐个分析冲突文件，解释双方修改的意图，给出推荐的解决方案。它还能帮你理解复杂的 diff 输出，快速定位关键变更点，在 code review 时节省大量时间。

对于分支管理，git-helper 可以根据项目的开发节奏推荐分支策略，生成 changelog，在发版时自动汇总各个 PR 的变更内容，确保发布说明准确完整。

## 示例

> 帮我写一个 commit message
> 生成这个 PR 的描述
> 这个合并冲突怎么解决
