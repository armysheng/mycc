---
name: agent-browser
description: 浏览器自动化工具，用于网页导航、表单填写、截图、数据提取等
---

# agent-browser - 浏览器自动化工具

agent-browser 是一个为 AI 设计的快速浏览器自动化 CLI，基于 Rust 和 Playwright。

## 安装

```bash
npm install -g agent-browser
agent-browser install  # 下载 Chromium
```

## Windows 使用注意事项

### ✅ 成功的调用方式

在 Windows 环境下，**必须使用 PowerShell 才能获得正确的输出**：

```bash
# 方式1: 直接在 PowerShell 中运行
agent-browser open example.com
agent-browser get title

# 方式2: 通过 Bash 工具调用 PowerShell
powershell -Command "agent-browser open example.com"

# 方式3: 链式命令（推荐）
powershell -Command "agent-browser open example.com; Start-Sleep -Seconds 2; agent-browser get title"
```

### ❌ 不推荐的方式

- **Git Bash (MINGW)**: 不兼容，可能无输出或 daemon 启动失败
- **CMD**: 部分功能可能正常，但推荐使用 PowerShell

## 基本用法

### 1. 导航和获取信息

```bash
# 打开网页
agent-browser open https://example.com

# 获取页面标题
agent-browser get title

# 获取当前 URL
agent-browser get url

# 获取页面快照（带元素引用）
agent-browser snapshot
```

### 2. 交互操作

```bash
# 点击元素（通过选择器或引用）
agent-browser click button
agent-browser click @e2

# 填写表单
agent-browser fill input[name="email"] "test@example.com"
agent-browser fill @e3 "text"

# 滚动页面
agent-browser scroll down 500
```

### 3. 截图和导出

```bash
# 截图
agent-browser screenshot page.png

# 保存为 PDF
agent-browser pdf page.pdf

# 全页截图
agent-browser screenshot --full page.png
```

### 4. 元素查找

```bash
# 通过角色查找
agent-browser find role button click --name "Submit"

# 通过文本查找
agent-browser find text "Sign In" click

# 通过标签查找
agent-browser find label "Email" fill "test@test.com"
```

## 常用选项

| 选项 | 说明 |
|------|------|
| `--headed` | 显示浏览器窗口 |
| `--json` | JSON 格式输出 |
| `--full, -f` | 全页截图 |
| `--debug` | 调试输出 |

## 实际测试案例

### 测试 1: 基础页面访问

```powershell
agent-browser open example.com
# 输出: ✓ Example Domain
#       https://example.com/

agent-browser get title
# 输出: Example Domain
```

### 测试 2: 搜索功能

```powershell
# 百度搜索
powershell -Command "agent-browser open 'https://www.baidu.com/s?wd=无线自组网'; Start-Sleep -Seconds 3; agent-browser get title"
# 输出: 无线自组网_百度搜索
```

## 工作流程建议

1. **获取快照**: 先用 `agent-browser snapshot` 查看页面结构
2. **定位元素**: 使用返回的引用（如 @e2, @e3）进行操作
3. **验证状态**: 使用 `agent-browser get title` 或 `agent-browser get url` 确认
4. **关闭浏览器**: 完成后使用 `agent-browser close`

## 故障排查

### 问题: 命令无输出

**解决**: 确保使用 PowerShell 而非 Git Bash

### 问题: Daemon 启动失败

**解决**: 尝试重新安装或使用云浏览器模式

### 问题: 需要登录的网站

**解决**: 使用持久化配置
```bash
agent-browser --profile ~/.myprofile open https://example.com
```

## 更多命令

```bash
# 查看完整帮助
agent-browser --help

# 查看特定命令帮助
agent-browser open --help
```

## 参考资源

- GitHub: https://github.com/vercel-labs/agent-browser
- 官网: https://agent-browser.dev
