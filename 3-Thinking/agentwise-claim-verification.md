# Agentwise Claim Verification 机制

> 来源: [VibeCodingWithPhil/agentwise](https://github.com/VibeCodingWithPhil/agentwise)
> 文件: `src/verification/ClaimVerificationSystem.ts`

---

## 核心概念

**Claim Verification System** 是一个自动验证代理声明的系统，确保代理输出的准确性和可靠性，通过信任分数机制追踪代理表现。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                   ClaimVerificationSystem                    │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ClaimTracker │  │ ClaimDebunker│  │Performance  │      │
│  │              │  │              │  │ Validator   │      │
│  │ 提取声明     │  │ 验证声明     │  │ 性能验证     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
├─────────────────────────────────────────────────────────────┤
│  AgentTrustScores (Map<agentId, AgentTrustScore>)          │
│  SystemIssues (Map<description, SystemIssue>)              │
│  VerificationReports (VerificationReport[])               │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心数据结构

### AgentClaim
```typescript
interface AgentClaim {
  id: string;
  agentId: string;
  agentName: string;
  claimType: ClaimType;           // performance, functionality, testing, security
  description: string;
  confidence: number;              // 0-1 代理自信度
  evidence: string[];              // 支持证据
  timestamp: Date;
  status: 'pending' | 'testing' | 'verified' | 'debunked' | 'inconclusive' | 'retesting';
}
```

### ClaimValidation
```typescript
interface ClaimValidation {
  claimId: string;
  overallResult: {
    passed: boolean;
    score: number;                // 0-100
    discrepancies: number;
  };
  discrepancies: ClaimDiscrepancy[];
  evidence: ValidationEvidence[];
  recommendations: string[];
  retestRequired: boolean;
}
```

### AgentTrustScore
```typescript
interface AgentTrustScore {
  agentId: string;
  agentName: string;
  overallScore: number;            // 0-100 总体信任分数
  totalClaims: number;
  verifiedClaims: number;
  debunkedClaims: number;
  accuracyRate: number;            // 准确率
  consistency: number;             // 一致性 (不同声明类型间)
  reliability: number;             // 可靠性 (置信度和证据质量)
  history: TrustHistoryEntry[];    // 最近100条历史
  penalties: TrustPenalty[];       // 活跃惩罚
  badges: TrustBadge[];            // 成就徽章
}
```

### ClaimDiscrepancy
```typescript
interface ClaimDiscrepancy {
  id: string;
  type: string;                   // false_claim, exaggerated, missing_evidence, etc.
  severity: 'critical' | 'major' | 'minor';
  description: string;
  expected: any;
  actual: any;
  impact: string;
}
```

### VerificationReport
```typescript
interface VerificationReport {
  reportId: string;
  timestamp: Date;
  period: { start: Date; end: Date };
  summary: {
    totalClaims: number;
    verifiedClaims: number;
    debunkedClaims: number;
    overallAccuracy: number;
    averageValidationTime: number;
  };
  agentPerformance: AgentPerformance[];
  claimTypes: ClaimTypeSummary[];
  trends: TrendAnalysis[];
  issues: SystemIssue[];
  recommendations: ReportRecommendation[];
}
```

---

## 工作流程

### 1. 声明提取

```typescript
async extractClaims(
  agentId: string,
  agentName: string,
  responseText: string,
  context: any = {}
): Promise<AgentClaim[]>
```

**流程**:
1. 从代理响应中识别声明
2. 分类声明类型
3. 评估置信度
4. 收集支持证据
5. 存储声明记录

**自动验证队列**:
```typescript
if (this.config.enabled) {
  for (const claim of claims) {
    setTimeout(() => this.verifyClaim(claim.id), 1000);
  }
}
```

### 2. 声明验证

```typescript
async verifyClaim(claimId: string): Promise<ClaimValidation | null>
```

**步骤**:
1. 获取声明记录
2. 更新状态为 `testing`
3. 运行验证测试
4. 更新状态为 `verified` 或 `debunked`
5. 如果失败，安排重试

### 3. 信任分数更新

```typescript
private async updateAgentTrustScore(
  agentId: string,
  agentName: string,
  claim: AgentClaim,
  validated: boolean
): Promise<void>
```

**计算公式**:
```typescript
// 准确率
accuracyRate = (verifiedClaims / totalClaims) * 100;

// 一致性 (跨声明类型的稳定性)
consistency = calculateConsistency(agentId);

// 可靠性 (置信度和证据质量)
reliability = calculateReliability(agentId);

// 总体分数
overallScore = (accuracyRate * 0.5) +
               (consistency * 0.3) +
               (reliability * 0.2);
```

### 4. 惩罚机制

```typescript
private applyTrustPenalties(
  trustScore: AgentTrustScore,
  claim: AgentClaim,
  validated: boolean
): void
```

**惩罚规则**:
- 关键差异: 每个 -20 分，持续 30 天
- 主要差异: 每个 -10 分，持续 14 天

```typescript
if (criticalDiscrepancies > 0) {
  penalty = {
    type: 'false_claim',
    severity: 'severe',
    points: criticalDiscrepancies * 20,
    duration: 30,
    active: true
  };
  trustScore.penalties.push(penalty);
  trustScore.overallScore -= penalty.points;
}
```

---

## 验证策略

### 声明类型映射

| 声明类型 | 验证方法 | 容差 |
|----------|----------|------|
| `performance` | 基准测试 | 10% |
| `functionality` | 代码检查 | N/A |
| `testing` | 覆盖率分析 | 5% |
| `security` | 安全扫描 | N/A |

### 验证组件

#### ClaimTracker
- 提取声明
- 追踪状态
- 统计数据

#### ClaimDebunker
- 验证声明
- 识别差异
- 生成报告

#### PerformanceValidator
- 性能基准测试
- 回归检测
- 响应时间验证

---

## 信任分数管理

### 一致性计算

```typescript
private calculateConsistency(agentId: string): number
```

**算法**:
1. 按声明类型分组统计
2. 计算每种类型的成功率
3. 计算与预期成功率 (80%) 的偏差
4. 转换为一致性分数

```typescript
for (const stats of claimTypes.values()) {
  if (stats.total >= 2) {
    const rate = stats.verified / stats.total;
    totalVariance += Math.pow(rate - 0.8, 2);
    typeCount++;
  }
}

const avgVariance = totalVariance / typeCount;
const consistency = Math.max(0, 100 - (avgVariance * 500));
```

### 可靠性计算

```typescript
private calculateReliability(agentId: string): number
```

**因素**:
- 平均置信度 (70% 权重)
- 平均证据数量 (30% 权重，最多+30分)

```typescript
const avgConfidence = totalConfidence / validClaims;
const avgEvidence = totalEvidence / validClaims;

const reliabilityScore = (avgConfidence * 0.7) +
                        Math.min(avgEvidence * 10, 30);
```

---

## 成就徽章系统

```typescript
private checkForBadges(trustScore: AgentTrustScore): void
```

**徽章类型**:

| 徽章 | 条件 | 图标 | 颜色 |
|------|------|------|------|
| Precision Master | 准确率 >= 95% | 🎯 | gold |
| Reliable Reporter | 一致性 >= 90% | 📊 | silver |
| Prolific Performer | 总声明 >= 100 | 🚀 | bronze |

---

## 报告生成

```typescript
async generateReport(
  period: { start: Date; end: Date }
): Promise<VerificationReport>
```

**报告内容**:
1. 执行摘要
2. 代理性能摘要
3. 声明类型摘要
4. 趋势分析
5. 系统问题
6. 改进建议

### 趋势分析

```typescript
private analyzeTrends(period: { start: Date; end: Date }): TrendAnalysis[]
```

**对比周期**: 当前期间 vs 前一期间

**判断标准**:
- 改善: 变化 > +5%
- 下降: 变化 < -5%
- 稳定: -5% <= 变化 <= +5%
- 显著: |变化| > 10%
- 中等: |变化| > 5%
- 轻微: 其他

### 改进建议生成

```typescript
private generateRecommendations(
  claims: AgentClaim[],
  agentPerformance: any[]
): ReportRecommendation[]
```

**触发条件**:
- 低性能代理 (< 70%)
- 高待处理声明 (> 20%)
- 频繁系统问题 (频率 > 3)

---

## 重试机制

```typescript
private scheduleRetest(claim: AgentClaim, validation: ClaimValidation): void
```

**策略**:
- 最多重试 3 次
- 指数退避 (初始 1s，倍数 2)
- 超过最大重试则标记为需要返工

```typescript
const delay = initialDelay * Math.pow(backoffMultiplier, retryCount);

setTimeout(async () => {
  (claim as any)._retryCount = retryCount + 1;
  await this.verifyClaim(claim.id);
}, delay);
```

---

## 配置系统

```typescript
interface ValidationConfig {
  enabled: boolean;
  strictMode: boolean;
  timeouts: {
    testExecution: number;      // 60s
    overallValidation: number;  // 300s
  };
  tolerances: {
    performance: number;        // 10%
    coverage: number;           // 5%
    size: number;               // 15%
  };
  retryPolicy: {
    maxRetries: number;          // 3
    backoffMultiplier: number;   // 2
    initialDelay: number;        // 1000ms
  };
  notifications: {
    onClaimDebunked: boolean;
    onSystemIssue: boolean;
    onTrustScoreChanged: boolean;
  };
  archival: {
    retentionDays: number;       // 90
    compressionAfterDays: number; // 30
  };
}
```

---

## 系统问题追踪

```typescript
interface SystemIssue {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedAgents: string[];
  firstDetected: Date;
  frequency: number;              // 发生次数
  suggestedFix: string;
}
```

**触发条件**:
- 声明提取失败
- 验证失败
- 系统性错误

**自动升级**:
```typescript
const existingIssue = this.systemIssues.get(issue.description);
if (existingIssue) {
  existingIssue.frequency++;  // 频率增加
}
```

---

## 定期验证

```typescript
private startVerificationProcess(): void
```

**定时任务**:
- 每 30 秒验证待处理声明
- 每小时生成报告
- 批量处理 (每批 5 个)

```typescript
// 验证队列
this.verificationInterval = setInterval(() => {
  this.verifyPendingClaims();
}, 30000);

// 报告生成
this.reportInterval = setInterval(() => {
  this.generatePeriodicReport();
}, 3600000);
```

---

## 数据持久化

### 信任分数存储
**位置**: `.agentwise/trust-scores.json`

### 验证报告存储
**位置**: `.agentwise/reports/verification-report-{date}-{id}.json`

### 数据清理
```typescript
async cleanup(): Promise<void>
```

**保留策略**:
- 默认保留 90 天
- 30 天后压缩旧数据

---

## 值得借鉴的设计

### 1. 分层验证架构
- ClaimTracker: 声明提取和追踪
- ClaimDebunker: 声明验证和揭穿
- PerformanceValidator: 性能专项验证

### 2. 多维度信任评分
- 准确率: 验证通过率
- 一致性: 跨类型稳定性
- 可靠性: 置信度和证据质量

### 3. 惩罚系统
- 临时惩罚 (自动过期)
- 分级惩罚 (关键/主要)
- 自动恢复 (到期加分)

### 4. 成就系统
- 游戏化激励
- 可视化进步
- 质量导向

### 5. 定期验证
- 后台自动验证
- 批量处理优化
- 定期报告生成

### 6. 趋势分析
- 历史对比
- 方向识别
- 显著性判断

---

## 应用场景

1. **代码生成代理**: 验证功能完成声明
2. **优化代理**: 验证性能改进声明
3. **测试代理**: 验证覆盖率声明
4. **安全代理**: 验证漏洞修复声明

---

## 扩展方向

1. **跨代理验证**: 代理间相互验证
2. **人工审核**: 集成人工审核流程
3. **实时监控**: WebSocket 实时推送
4. **预测性分析**: 基于历史预测代理行为
5. **自适应阈值**: 根据代理表现动态调整验证严格度
