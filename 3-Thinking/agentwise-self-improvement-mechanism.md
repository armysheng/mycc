# Agentwise 自我改进机制

> 来源: [VibeCodingWithPhil/agentwise](https://github.com/VibeCodingWithPhil/agentwise)
> 文件: `src/learning/SelfImprovingAgent.ts`

---

## 核心概念

**自我改进代理 (SelfImprovingAgent)** 是一个能够从每次任务中学习、持久化知识、并在未来任务中应用这些知识的代理系统。

---

## 数据结构

### AgentKnowledge
```typescript
interface AgentKnowledge {
  patterns: Map<string, PatternKnowledge>;      // 模式知识
  solutions: Map<string, SolutionMemory>;       // 解决方案记忆
  mistakes: Map<string, MistakeRecord>;         // 错误记录
  optimizations: Map<string, OptimizationStrategy>; // 优化策略
  performance: PerformanceProfile;              // 性能画像
}
```

### PatternKnowledge
```typescript
interface PatternKnowledge {
  pattern: string;              // 模式名称 (如 "implement react")
  occurrences: number;          // 出现次数
  successRate: number;          // 成功率 0-1
  bestApproach: string;         // 最佳方法
  alternativeApproaches: string[]; // 备选方案
  lastUpdated: Date;
}
```

### SolutionMemory
```typescript
interface SolutionMemory {
  problem: string;
  solution: string;             // JSON 序列化的解决方案
  effectiveness: number;         // 有效性 0-1
  reusabilityScore: number;     // 可复用性分数 0-1
  dependencies: string[];       // 依赖项
  timeSaved: number;            // 节省时间 (ms)
}
```

### MistakeRecord
```typescript
interface MistakeRecord {
  error: string;
  context: string;
  resolution: string;
  preventionStrategy: string;   // 预防策略
  occurrences: number;
  lastOccurred: Date;
}
```

### PerformanceProfile
```typescript
interface PerformanceProfile {
  averageTaskTime: number;
  successRate: number;
  tokenEfficiency: number;
  learningRate: number;
  specializations: string[];    // 专长领域
  weaknesses: string[];          // 弱点领域
}
```

---

## 工作流程

### 1. 从任务中学习

```typescript
async learnFromTask(
  taskDescription: string,
  taskResult: any,
  metrics: Partial<LearningMetric>
): Promise<void>
```

**流程**:
1. 创建学习指标记录
2. 从任务中提取模式
3. 更新模式知识
4. 成功则记住解决方案，失败则学习错误
5. 更新性能画像
6. 持久化知识

### 2. 模式提取

```typescript
private extractPatterns(description: string, result: any): string[]
```

**识别的模式类型**:
- 动作模式: `implement`, `fix`, `create`, `update`, `optimize`, `refactor`
- 技术模式: `react`, `vue`, `typescript`, `api`, `database`, `authentication`等

### 3. 知识持久化

**存储位置**: `.agent-knowledge/{agentName}/`

**文件结构**:
```
.agent-knowledge/
├── {agentName}/
│   ├── patterns.json       # 模式知识
│   ├── solutions.json      # 成功方案
│   ├── mistakes.json       # 错误记录
│   ├── optimizations.json  # 优化策略
│   ├── performance.json    # 性能画像
│   └── metrics.json        # 历史指标 (最近1000条)
```

### 4. 知识应用

```typescript
async applyKnowledge(taskDescription: string): Promise<KnowledgeApplication>
```

**返回内容**:
- 相关模式
- 相似解决方案
- 需要避免的错误
- 可用的优化策略
- 推荐方法

### 5. 同伴学习

```typescript
async learnFromPeer(peerKnowledge: any): Promise<void>
```

**策略**: 只采用更好的模式/方案/优化

```typescript
// 合并条件：新知识更好
if (!existing || pattern.successRate > existing.successRate) {
  this.knowledge.patterns.set(pattern.pattern, pattern);
}
```

---

## 关键算法

### 成功率计算
```typescript
existing.successRate = (
  (existing.successRate * (existing.occurrences - 1) +
   (success ? 1 : 0))
  / existing.occurrences
);
```

### 可复用性评分
```typescript
private calculateReusability(solution: any): number {
  const solutionStr = JSON.stringify(solution);
  const generalityScore = 1 - (solutionStr.split('/').length / 100);
  const simplicityScore = Math.max(0, 1 - (solutionStr.length / 10000));
  return (generalityScore + simplicityScore) / 2;
}
```

### 学习率计算
```typescript
private calculateLearningRate(): number {
  const recent = this.metrics.slice(-10);
  const older = this.metrics.slice(-20, -10);

  const recentSuccess = recent.filter(m => m.success).length / recent.length;
  const olderSuccess = older.filter(m => m.success).length / older.length;

  return Math.max(0, recentSuccess - olderSuccess);
}
```

### 专长识别
```typescript
private identifySpecializations(): void {
  for (const [type, count] of taskTypeCounts) {
    const successRate = (taskTypeSuccess.get(type) || 0) / count;
    if (successRate > 0.8 && count > 5) {
      specializations.push(type);
    }
  }
}
```

---

## 反馈循环

```typescript
async processFeedback(feedback: string, context: any): Promise<void>
```

**反馈类型**:
- `positive`: 强化成功行为
- `negative`: 记录错误并生成改进建议
- `neutral`: 不调整学习率

**学习率调整**:
```typescript
if (impact === 'positive') {
  this.learningRate = Math.min(1, this.learningRate * 1.1);
} else if (impact === 'negative') {
  this.learningRate = Math.max(0.01, this.learningRate * 0.9);
}
```

---

## 知识共享

```typescript
async shareKnowledge(): Promise<ShareableKnowledge>
```

**只分享高质量知识**:
- 模式成功率 > 0.8
- 方案可复用性 > 0.7
- 优化性能 > 0.6

---

## 值得借鉴的设计

### 1. 分层知识结构
- 模式层: 识别任务类型
- 方案层: 存储成功解决方案
- 错误层: 避免重复错误
- 优化层: 性能改进策略
- 性能层: 代理画像

### 2. 渐进式学习
- 指数移动平均更新成功率
- 最小出现次数后才确定专长/弱点
- 学习率自适应调整

### 3. 知识质量过滤
- 只分享经过验证的知识
- 基于成功率和可复用性过滤
- 同伴学习采用"更好才替换"策略

### 4. 持久化策略
- 分文件存储不同类型知识
- 限制历史记录数量 (1000条指标)
- 自动保存机制

### 5. 相似度计算
```typescript
private calculateSimilarity(key1: string, key2: string): number {
  let matches = 0;
  const minLen = Math.min(key1.length, key2.length);
  for (let i = 0; i < minLen; i++) {
    if (key1[i] === key2[i]) matches++;
  }
  return matches / Math.max(key1.length, key2.length);
}
```

---

## 实现要点

### 防止过度学习
- 最小出现次数阈值
- 学习率上限/下限
- 基于反馈的动态调整

### 知识过期处理
- `lastUpdated` 时间戳
- 可扩展添加 TTL 机制

### 错误预防策略生成
```typescript
private generatePreventionStrategy(result: any): string {
  const errorStr = this.extractError(result).toLowerCase();

  if (errorStr.includes('type'))
    return 'Add type checking and validation';
  if (errorStr.includes('undefined') || errorStr.includes('null'))
    return 'Add null checks and default values';
  if (errorStr.includes('timeout'))
    return 'Increase timeout or optimize performance';
  if (errorStr.includes('permission'))
    return 'Check permissions and access rights';

  return 'Improve error handling and validation';
}
```

---

## 应用场景

1. **代码生成代理**: 记住成功的实现模式
2. **测试代理**: 学习有效的测试策略
3. **Review 代理**: 识别常见问题模式
4. **研究代理**: 积累高效搜索方法

---

## 扩展方向

1. **跨会话学习**: 当前实现支持，可添加云同步
2. **群体学习**: 多代理知识共享网络
3. **强化学习**: 基于奖励反馈优化策略选择
4. **元学习**: 学习如何更好地学习
