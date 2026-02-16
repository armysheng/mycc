# Agentwise 核心机制总结

> 来源: [VibeCodingWithPhil/agentwise](https://github.com/VibeCodingWithPhil/agentwise)
> 分析日期: 2025年

---

## 项目概览

**Agentwise** 是一个企业级多代理编排系统，具有以下核心特点：

- **代码规模**: 335,998+ 行 TypeScript
- **测试覆盖**: 184 个综合测试
- **核心特性**: 自我改进、需求工程、研究能力、声明验证
- **令牌优化**: 实测 15-30% 减少

---

## 四大核心机制

### 1. 自我改进机制 (SelfImprovingAgent)

**核心思想**: 代理从每次任务中学习，持久化知识，并在未来任务中应用。

**知识结构**:
```
.agent-knowledge/{agentName}/
├── patterns.json       # 模式知识 (成功率、最佳方法)
├── solutions.json      # 成功方案 (可复用性评分)
├── mistakes.json       # 错误记录 (预防策略)
├── optimizations.json  # 优化策略
├── performance.json    # 性能画像 (专长/弱点)
└── metrics.json        # 历史指标 (最近1000条)
```

**关键算法**:
- 成功率: 指数移动平均更新
- 可复用性: 基于通用性和简洁性
- 学习率: 对比近期与远期表现
- 专长识别: 成功率 > 80% 且出现 > 5 次
- 同伴学习: 只采用更好的知识

**借鉴价值**: ⭐⭐⭐⭐⭐
- 分层知识结构清晰
- 质量过滤机制完善
- 持久化策略可靠

---

### 2. 需求增强和转换机制 (RequirementsGenerator)

**核心思想**: 将模糊想法转换为结构化、可执行的技术需求。

**转换流程**:
```
项目想法
  ↓ 预处理验证
增强需求生成 (AI驱动)
  ↓
应用约束 (团队/时间/合规/性能)
  ↓
应用偏好 (技术栈选择)
  ↓ 验证循环
优化迭代 (最多3次)
  ↓ 质量检查
输出需求文档 (JSON/YAML/Markdown)
```

**约束类型**:
- 团队规模约束
- 时间线约束 (功能优先级排序)
- 技术偏好/避免
- 合规要求 (GDPR/HIPAA/SOC2)
- 性能要求 (用户量/响应时间)

**多变体生成**:
- 保守型: 初学者友好
- 平衡型: 标准功能集
- 先进型: 完整功能

**借鉴价值**: ⭐⭐⭐⭐⭐
- 完整的需求工程流程
- 灵活的约束系统
- 智能优化迭代

---

### 3. Research Agent

**核心思想**: 时间感知的智能研究，提供最新、最相关的技术信息。

**时间感知机制**:
```typescript
// 动态获取当前日期/时间
const currentTime = {
  date: new Date(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  formatted: "February 5, 2026 at 10:30:45 AM GMT+8"
};

// 基于时间框架构建查询
timeframe: 'latest'   → "topic 2026 latest", "topic 2026 February"
timeframe: 'recent'   → "topic 2026", "topic 2025 2026"
timeframe: 'historical' → 跨越多年的历史查询
```

**排序算法**:
```typescript
score = relevance * timeDecay

// 时间衰减: 一年内从 100% 衰减到 50%
timeDecay = Math.max(0.5, 1 - (daysOld / 365));
```

**缓存策略**:
- 1小时有效期
- 基于内容哈希的缓存键
- 避免重复查询

**借鉴价值**: ⭐⭐⭐⭐⭐
- 时间感知设计独特
- 缓存策略实用
- 排序算法合理

---

### 4. Claim Verification 机制

**核心思想**: 自动验证代理声明，确保输出准确性，通过信任分数追踪代理表现。

**信任分数公式**:
```typescript
overallScore = accuracyRate * 0.5 + consistency * 0.3 + reliability * 0.2
```

**三维评分**:
- **准确率**: 验证通过率
- **一致性**: 跨声明类型的稳定性
- **可靠性**: 置信度和证据质量

**惩罚机制**:
- 关键差异: -20 分，持续 30 天
- 主要差异: -10 分，持续 14 天
- 自动过期恢复

**成就徽章**:
- Precision Master: 准确率 ≥ 95%
- Reliable Reporter: 一致性 ≥ 90%
- Prolific Performer: 总声明 ≥ 100

**借鉴价值**: ⭐⭐⭐⭐⭐
- 多维度评估全面
- 惩罚系统公平
- 成就系统激励

---

## 架构设计亮点

### 1. 领域驱动设计 (DDD)

```
src/
├── requirements/    # 需求领域
├── database/       # 数据库领域
├── github/         # GitHub 领域
├── protection/     # 保护领域
├── knowledge/      # 知识领域
└── ...
```

### 2. 事件驱动架构

```typescript
export class SelfImprovingAgent extends EventEmitter {
  async learnFromTask(...) {
    this.emit('task:completed', metric);
    this.emit('knowledge:updated', knowledge);
  }
}
```

### 3. 策略模式

**验证策略**:
- 性能声明 → 基准测试
- 功能声明 → 代码检查
- 测试声明 → 覆盖率分析
- 安全声明 → 安全扫描

### 4. 工厂模式

**动态代理生成**:
```typescript
async generateAgent(specialization: string, projectContext?: string) {
  // 分析项目需求
  // 生成代理模板
  // 创建代理文件
  // 注册到系统
}
```

---

## 令牌优化策略

### 优化效果: 15-30%

**优化层次**:
1. **上下文共享** (10-20% 减少)
   - 共享上下文服务器 (端口 3003)
   - 差异更新
   - 智能引用

2. **智能缓存** (5-10% 减少)
   - 语义理解缓存
   - 关系映射缓存
   - 模式检测缓存

3. **组合系统** (15-30% 总减少)
   - 大型项目收益更明显
   - 基于实测数据

### Context 3.0 系统

```typescript
interface ContextDiff {
  added: Record<string, any>;
  modified: Record<string, any>;
  removed: string[];
  unchanged: string[];
}

// 只发送变更部分
await contextServer.sendDiff(projectId, fromVersion);
```

---

## 知识图谱系统

### 功能
- 语义分析 (TypeScript/JavaScript)
- 关系映射 (导入/导出)
- 增量更新 (只重新分析变更文件)
- 影响分析 (预测变更影响范围)

### 价值
- 防止引入 bug (20-30% 改进)
- 依赖关系可视化
- 模式检测和反模式识别

---

## 监控和可观测性

### 实时仪表板
**访问**: http://localhost:3001

**特性**:
- WebSocket 实时更新
- 代理状态追踪
- 任务进度可视化
- D3.js 图表

### 性能指标
```typescript
interface TaskDistributionMetrics {
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageWaitTime: number;
  averageExecutionTime: number;
  agentUtilization: { [agentId: string]: number };
  tokenOptimizationSavings: number;
}
```

---

## MCP 集成

### 25 个验证服务器

**官方核心** (7):
- Filesystem, Memory, Fetch, Puppeteer, Brave Search, Sequential Thinking, Everything

**设计和 UI** (4):
- Figma Dev Mode, Figma Personal, Shadcn, Canva

**开发** (4):
- GitHub, Git-MCP, Docker-MCP, Context7

**数据库** (4):
- PostgreSQL, MySQL, Postgres Advanced, Database Multi

**测试** (4):
- Playwright, TestSprite, MCP Inspector, MCP Tester

**基础设施** (2):
- Kubernetes, Azure DevOps

---

## 测试策略

### 测试金字塔
```
        E2E Tests (10%)
       /            \
    Integration (30%)
   /                \
Unit Tests (60%)
```

### 测试覆盖
- 单元测试: >80%
- 集成测试: >70%
- E2E 测试: 关键路径
- 184 个综合测试

---

## 值得借鉴的核心设计模式

### 1. 领域驱动设计
- 清晰的边界上下文
- 每个领域独立发展
- 易于维护和扩展

### 2. 事件驱动架构
- 松耦合组件
- 异步处理
- 易于扩展

### 3. 策略模式
- 验证策略
- 优化策略
- 学习策略

### 4. 工厂模式
- 动态代理生成
- 需求生成器
- 上下文管理器

### 5. 观察者模式
- 任务状态更新
- 代理协调
- 实时监控

### 6. 缓存模式
- LRU 缓存
- 多级缓存
- TTL 过期
- 差异缓存

### 7. 知识持久化模式
- 代理学习持久化
- 跨会话知识保留
- 性能指标追踪
- 错误模式记录

---

## 技术栈

### 后端
- TypeScript / Node.js
- 事件驱动架构
- 文件系统持久化

### 前端
- D3.js 可视化
- WebSocket 实时更新
- React 组件

### 集成
- MCP 服务器 (25+)
- OpenAI API
- Ollama (本地模型)
- LM Studio (本地模型)

---

## 实施建议

### 对于新项目

1. **从自我改进机制开始**
   - 最容易实现
   - 立即见效
   - 为其他机制打基础

2. **添加需求工程**
   - 提升输入质量
   - 结构化工作流
   - 支持多变体

3. **实现研究能力**
   - 时间感知很重要
   - 缓存策略关键
   - 排序算法参考

4. **部署验证系统**
   - 确保输出质量
   - 建立信任机制
   - 持续改进

### 对于现有项目

1. **渐进式引入**
   - 先在特定模块测试
   - 验证效果后扩展
   - 保持向后兼容

2. **监控优先**
   - 先建立监控
   - 收集基线数据
   - 对比改进效果

3. **用户反馈**
   - 及时收集反馈
   - 快速迭代优化
   - 建立改进文化

---

## 扩展方向

### 短期 (3-6个月)
- [ ] 增加更多验证策略
- [ ] 优化缓存算法
- [ ] 支持更多语言
- [ ] 增强可视化

### 中期 (6-12个月)
- [ ] 跨代理知识共享网络
- [ ] 强化学习策略选择
- [ ] 自动优化参数调优
- [ ] 云同步知识库

### 长期 (12+个月)
- [ ] 元学习系统
- [ ] 自主代理生成
- [ ] 分布式代理协调
- [ ] 联邦学习机制

---

## 相关资源

- **GitHub**: https://github.com/VibeCodingWithPhil/agentwise
- **文档**: https://github.com/VibeCodingWithPhil/agentwise/tree/main/docs
- **示例**: https://github.com/VibeCodingWithPhil/agentwise/tree/main/examples
- **许可证**: MIT License

---

## 总结

Agentwise 是一个设计精良的多代理编排系统，其核心价值在于：

1. **架构清晰**: DDD + 事件驱动 + 策略模式
2. **自我改进**: 从经验中学习并应用
3. **需求工程**: 完整的需求生成到验证流程
4. **研究能力**: 时间感知的多源研究
5. **质量保证**: 自动化的声明验证系统
6. **性能优化**: 实测 15-30% 的令牌减少

对于构建类似系统，Agentwise 提供了丰富的参考实现和设计模式。
