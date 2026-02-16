# Agentwise Research Agent

> 来源: [VibeCodingWithPhil/agentwise](https://github.com/VibeCodingWithPhil/agentwise)
> 文件: `src/agents/ResearchAgent.ts`

---

## 核心概念

**Research Agent** 是一个具有时间感知能力的智能研究代理，能够根据当前日期和时间提供最新的技术研究结果。

---

## 核心特性

### 1. 时间感知研究
- 动态获取当前日期/时间
- 用户时区自适应
- 时效性优先排序

### 2. 多源信息收集
- Web 搜索
- 文档搜索
- 代码示例搜索
- 技术趋势分析

### 3. 智能查询构建
- 基于时间框架生成查询
- 上下文感知查询
- 多种时间范围策略

### 4. 结果排序和过滤
- 相关性评分
- 时间衰减算法
- 去重处理

### 5. 研究缓存
- 1小时有效期
- 避免重复查询
- 提高响应速度

---

## 数据结构

### ResearchQuery
```typescript
interface ResearchQuery {
  topic: string;                  // 研究主题
  context?: string;               // 上下文信息
  depth?: 'quick' | 'standard' | 'comprehensive';
  timeframe?: 'latest' | 'recent' | 'historical' | 'all';
  sources?: string[];              // 指定数据源
}
```

### ResearchResult
```typescript
interface ResearchResult {
  summary: string;                 // 执行摘要
  findings: ResearchFinding[];     // 关键发现 (最多20个)
  recommendations: string[];       // 建议
  references: Reference[];         // 参考文献 (去重)
  metadata: ResearchMetadata;      // 元数据
}
```

### ResearchFinding
```typescript
interface ResearchFinding {
  title: string;
  description: string;
  relevance: number;               // 0-100 相关性分数
  source: string;
  date?: Date;
  tags: string[];
}
```

### ResearchMetadata
```typescript
interface ResearchMetadata {
  researchDate: Date;              // 研究日期
  userTimezone: string;            // 用户时区
  queryTime: number;               // 查询耗时 (ms)
  sourcesSearched: number;         // 搜索的源数量
  confidence: number;               // 置信度 0-100
}
```

---

## 时间感知机制

### 动态日期时间获取
```typescript
private getCurrentDateTime(): {
  date: Date;
  timezone: string;
  formatted: string;
}
```

**实现**:
```typescript
const now = new Date();
const formatted = new Intl.DateTimeFormat('en-US', {
  timeZone: this.userTimezone,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short'
}).format(now);
```

### 时间感知查询构建
```typescript
private buildTimeAwareQueries(
  query: ResearchQuery,
  currentDate: Date
): string[]
```

**时间框架策略**:

| timeframe | 查询策略 |
|-----------|----------|
| `latest` | `topic {year} latest`, `topic {year} {month}`, `topic newest features {year}` |
| `recent` | `topic {year}`, `topic {year-1} {year}`, `topic recent updates` |
| `historical` | 跨越多年的历史查询 |
| `all` | 默认策略 |

**示例**:
```typescript
// 当前日期: 2026年2月5日
// timeframe: 'latest'
queries = [
  'react hooks 2026 latest',
  'react hooks 2026 February',
  'react hooks newest features 2026'
];
```

---

## 研究流程

```typescript
async research(query: ResearchQuery): Promise<ResearchResult>
```

### 步骤

1. **检查缓存**
   ```typescript
   const cacheKey = this.generateCacheKey(query);
   if (this.researchCache.has(cacheKey)) {
     const cached = this.researchCache.get(cacheKey)!;
     // 1小时内有效
     if (Date.now() - cached.metadata.researchDate.getTime() < 3600000) {
       return cached;
     }
   }
   ```

2. **构建时间感知查询**
   ```typescript
   const searchQueries = this.buildTimeAwareQueries(query, currentTime.date);
   ```

3. **多源研究**
   - Web 搜索
   - 文档搜索
   - 代码示例搜索
   - 技术趋势分析

4. **排序发现**
   ```typescript
   const sortedFindings = this.rankFindings(findings, query, currentTime.date);
   ```

5. **生成输出**
   - 摘要
   - 建议
   - 参考文献

6. **保存报告**
   ```typescript
   await this.saveResearchReport(result, query);
   ```

---

## 排序算法

```typescript
private rankFindings(
  findings: ResearchFinding[],
  query: ResearchQuery,
  currentDate: Date
): ResearchFinding[]
```

**评分公式**:
```typescript
// 基础相关性分数
let score = finding.relevance;

// 时间衰减加成
if (finding.date) {
  const daysOld = Math.floor(
    (currentDate.getTime() - finding.date.getTime()) / (1000 * 60 * 60 * 24)
  );
  // 一年内衰减
  score *= Math.max(0.5, 1 - (daysOld / 365));
}

return scoreB - scoreA; // 降序排序
```

**效果**:
- 30天内的结果获得额外加成
- 一年前的结果权重降低
- 非常旧的结果仍有50%权重

---

## 置信度计算

```typescript
private calculateConfidence(findings: ResearchFinding[]): number
```

**公式**:
```typescript
const avgRelevance = findings.reduce((sum, f) => sum + f.relevance, 0) / findings.length;

// 最近性加成 (最多+20%)
const recencyBoost = findings.filter(f => {
  if (!f.date) return false;
  const daysOld = (Date.now() - f.date.getTime()) / (1000 * 60 * 60 * 24);
  return daysOld < 30;
}).length / findings.length * 20;

return Math.min(100, Math.round(avgRelevance + recencyBoost));
```

---

## 报告生成

### Markdown 格式
```typescript
private formatResearchReport(result: ResearchResult, query: ResearchQuery): string
```

**结构**:
```markdown
# Research Report: {topic}

## Metadata
- **Date**: {researchDate}
- **Timezone**: {userTimezone}
- **Query Time**: {queryTime}ms
- **Sources Searched**: {sourcesSearched}
- **Confidence**: {confidence}%

## Executive Summary
{summary}

## Key Findings
### 1. {title}
- **Relevance**: {relevance}%
- **Source**: {source}
- **Date**: {date}
- **Tags**: {tags}

{description}

## Recommendations
1. {recommendation}

## References
1. [{title}]({url}) - {type}
```

**保存位置**: `research-reports/{topic}-{timestamp}.md`

---

## 源搜索策略

### 1. 文档搜索
```typescript
async searchDocumentation(query: ResearchQuery)
```

**搜索位置**:
- `docs/` 目录
- Markdown 文件
- 按主题关键词匹配

### 2. 代码示例搜索
```typescript
async searchCodeExamples(query: ResearchQuery)
```

**搜索位置**:
- `workspace/` 目录
- 模式匹配
- 导入/导出分析

### 3. 技术趋势分析
```typescript
async analyzeTrends(query: ResearchQuery, currentDate: Date)
```

**策略**:
```typescript
const yearProgress = (currentDate.getMonth() + 1) / 12;

if (yearProgress > 0.75) { // Q4
  findings.push({
    title: `${query.topic} Trends for ${currentDate.getFullYear() + 1}`,
    description: `Emerging trends and predictions for the upcoming year`,
    relevance: 85,
    source: 'trend-analysis',
    tags: ['trends', 'predictions', 'future']
  });
}
```

---

## 建议生成

```typescript
private generateRecommendations(
  findings: ResearchFinding[],
  query: ResearchQuery
): string[]
```

**基于标签模式**:
```typescript
const tagCounts = findings
  .flatMap(f => f.tags)
  .reduce((acc, tag) => {
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {});

const topTags = Object.entries(tagCounts)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 5)
  .map(([tag]) => tag);

// 基于高频标签生成建议
if (topTags.includes('performance')) {
  recommendations.push('Consider performance optimization techniques');
}
if (topTags.includes('security')) {
  recommendations.push('Implement security best practices');
}
```

---

## 值得借鉴的设计

### 1. 时间感知架构
- 动态日期/时间获取
- 时区自适应
- 时效性优先排序

### 2. 缓存策略
- 基于内容哈希的缓存键
- 时效性缓存 (1小时)
- 避免重复查询

### 3. 时间衰减算法
- 渐进式权重衰减
- 保留旧结果但降低优先级
- 平衡新鲜度和相关性

### 4. 多源聚合
- Web、文档、代码、趋势
- 统一结果格式
- 去重处理

### 5. 结构化报告
- Markdown 人性化输出
- 完整元数据
- 可追溯性

---

## 应用场景

1. **技术选型**: 研究最新技术趋势
2. **问题解决**: 查找解决方案和最佳实践
3. **学习新知**: 快速了解新技术栈
4. **竞品分析**: 研究类似项目实现

---

## 扩展方向

1. **真实搜索集成**: 接入 Google、Bing API
2. **学术搜索**: 论文、期刊研究
3. **视频资源**: YouTube、课程搜索
4. **社区讨论**: Reddit、StackOverflow 分析
5. **GitHub 趋势**: 开源项目趋势分析

---

## 性能优化

### 当前实现
- 1小时缓存有效期
- 批量处理查询
- 异步并行搜索

### 可优化点
- 增量更新 (只更新变化的部分)
- 预加载热门主题
- 分布式缓存 (Redis)
- 结果压缩存储
