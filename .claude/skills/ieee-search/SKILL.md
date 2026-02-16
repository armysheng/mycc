---
name: ieee-search
description: 在 IEEE Xplore 上搜索学术文献并获取详细信息（标题、作者、摘要、引用等）
---

# IEEE 文献搜索技能

使用 agent-browser 自动化在 IEEE Xplore 上搜索文献并提取详细信息。

## 触发词

- "搜索 IEEE 文献"
- "在 IEEE 上找论文"
- "IEEE 文献搜索"
- "查找无线自组网相关文献"

## 执行步骤

### 1. 启动有头模式浏览器

```powershell
agent-browser --headed open 'https://ieeexplore.ieee.org/search/searchresult.jsp?newsearch=true&queryText={搜索关键词}'
```

**重要**：
- **必须使用 `--headed` 模式**，否则会被 IEEE 的 WAF 拦截
- 在 Windows 环境下使用 PowerShell 运行

### 2. 获取页面快照定位文献

```powershell
agent-browser snapshot -i
```

从快照中找到：
- 文献标题链接（格式：`link "标题" [ref=eXXX]`）
- 记录前 N 篇文献的 ref 编号（如 @e100, @e109, @e118）

### 3. 点击文献链接进入详情页

```powershell
agent-browser click '@e100'
```

使用 ref 引用精确点击文献标题链接。

### 4. 提取摘要信息

```powershell
agent-browser eval 'document.body.innerText'
```

从返回的文本中提取：
- Abstract: 摘要内容
- Authors: 作者
- Publication: 发表信息
- DOI: 数字对象标识符
- Cited by: 被引量

### 5. 返回并处理下一篇

```powershell
agent-browser back
```

重复步骤 3-4 直到获取足够数量的文献。

### 6. 关闭浏览器

```powershell
agent-browser close
```

## 实际案例

### 搜索"无线自组网"文献

**步骤 1：打开搜索页面**
```powershell
agent-browser --headed open 'https://ieeexplore.ieee.org/search/searchresult.jsp?newsearch=true&queryText=wireless%20ad%20hoc%20network'
```

**步骤 2：获取快照**
```powershell
agent-browser snapshot | Select-String -Pattern 'Wireless.*Ad.*Hoc' -Context 0,2
```

**步骤 3：点击第一篇**
```powershell
agent-browser click '@e100'
```

**步骤 4：提取摘要**
```powershell
agent-browser eval 'document.body.innerText' | Select-String -Pattern 'Abstract:' -Context 5,30
```

**步骤 5：继续下一篇**
```powershell
agent-browser back
agent-browser click '@e109'
```

## 输出格式

每篇文献包含以下信息：

```markdown
### 《文献标题》

**作者**：作者列表
**期刊/会议**：发表信息
**年份**：年份
**DOI**：10.xxxx/xxxxx
**被引量**：X

**摘要**：
摘要内容...

**HTML 全文**：
- SECTION I. Introduction
- SECTION II. ...
- SECTION III. ...
- SECTION IV. Conclusion
```

## 获取 HTML 全文

### 判断文章是否有 HTML 全文

在文章详情页，查看是否有 "Document Sections" 导航：
- ✅ 有 "I. Introduction", "II. ...", "III. ...", "IV. Conclusion" 等章节链接 = 有 HTML 全文
- ❌ 只有 Abstract，没有章节链接 = 仅摘要，无全文

### 提取 HTML 全文内容

**方法 1：直接提取所有文本（推荐）**
```powershell
# 文章详情页执行
agent-browser eval 'document.body.innerText'
```

这会返回包含以下内容的完整文本：
- Abstract
- SECTION I. Introduction
- SECTION II. [章节名]
- SECTION III. [章节名]
- SECTION IV. Conclusion
- 参考文献（如果可用）

**方法 2：通过章节导航获取**
```powershell
# 获取快照查看章节链接
agent-browser snapshot -i

# 点击特定章节（可选）
agent-browser click '@e50'  # I. Introduction

# 提取内容
agent-browser eval 'document.body.innerText'
```

### HTML 全文示例

文章 `https://ieeexplore.ieee.org/document/6483032` 包含完整 HTML 全文：

```
Document Sections
I. Introduction
II. APPLICATIONS Realized By Multicast Routings
III. Multicast Routing Protocols For VANETs
IV. Conclusion
```

提取后的文本包含每个章节的完整内容，可直接用于阅读和分析。

## 注意事项

### ⚠️ 必须使用有头模式

IEEE 使用 WAF（Web Application Firewall）保护：
- ❌ 无头模式会被拦截：`Request Rejected`
- ✅ 有头模式可以正常访问

### ⚠️ Windows 环境要求

```powershell
# ✅ 正确
powershell -Command "agent-browser --headed open '...'"

# ❌ 错误
agent-browser --headed open '...'  # 在 Git Bash 中运行
```

### ⚠️ 连接超时处理

如果遇到连接超时：
1. 检查浏览器是否仍运行
2. 重新执行 `agent-browser --headed open`
3. 确保 daemon 正常运行

## 故障排查

### 问题：Request Rejected

**原因**：使用无头模式被 WAF 拦截

**解决**：添加 `--headed` 参数

### 问题：Missing arguments for click

**原因**：ref 格式不正确

**解决**：使用 `'@e100'` 格式（带引号和 @ 符号）

### 问题：Daemon failed to start

**原因**：daemon 进程异常

**解决**：
1. 等待 10 秒后重试
2. 或重启 PowerShell

## 高级用法

### 自定义搜索字段

```powershell
# 按作者搜索
queryText=author:"Chih-Wei Yi"

# 按期刊搜索
queryText=pubtitle:"IEEE Transactions on Parallel"

# 组合搜索
queryText=wireless AND ad hoc AND network
```

### 筛选结果

在搜索 URL 中添加参数：
- `&contentType=Journals` - 仅期刊
- `&contentType=Conferences` - 仅会议
- `&yearRange=2010-2020` - 年份范围

## 相关技能

- `agent-browser`: 浏览器自动化基础工具
- `docx`: 文档生成（可导出文献列表为 Word）

## 参考

- IEEE Xplore: https://ieeexplore.ieee.org
- agent-browser 文档: `.claude/skills/agent-browser/SKILL.md`
