---
name: skill-creator
description: 引导用户通过交互式问答创建自定义技能，自动生成配置并注册到系统
version: 1.0.0
source: mycc-marketplace
triggers:
  - /skill-creator
---

## Overview

skill-creator 是一个技能开发的脚手架工具，帮助用户从零开始创建自定义技能。无需手动编写配置文件，通过自然语言描述你想要的功能，它就能帮你搞定。

工作流程非常简单：你描述想要什么技能，skill-creator 会通过几轮问答确认技能名称、触发词、功能边界和 prompt 模板。确认无误后，自动生成符合规范的 SKILL.md 文件，放到正确的目录并注册到技能系统中，即装即用。

它还会根据你的描述推荐合适的触发词命名、补全 prompt 模板中的边界条件，避免新手常犯的配置错误。对于已有的 prompt，也可以直接转换为标准技能格式，省去手动迁移的麻烦。

## 示例

> 帮我创建一个翻译技能
> 我想做一个代码审查的技能
> 把这个 prompt 变成一个技能
