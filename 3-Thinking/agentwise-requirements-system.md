# Agentwise 需求增强和转换机制

> 来源: [VibeCodingWithPhil/agentwise](https://github.com/VibeCodingWithPhil/agentwise)
> 文件: `src/requirements/RequirementsGenerator.ts`, `RequirementsEnhancer.ts`

---

## 核心概念

**需求生成系统** 能够将模糊的项目想法转换为结构化、完整、可执行的技术需求文档。

---

## 系统架构

```
项目想法 (10+ 字符)
    ↓
预处理与验证
    ↓
增强需求生成 (AI驱动)
    ↓
应用约束和偏好
    ↓
验证循环
    ↓
优化迭代 (最多3次)
    ↓
质量检查
    ↓
输出需求文档
```

---

## 核心数据结构

### Requirements
```typescript
interface Requirements {
  title: string;
  description: string;
  projectType: ProjectType;      // web, mobile, desktop, api, library
  complexity: ComplexityLevel;   // simple, moderate, complex, very-complex
  architecture: string;          // monolithic, microservices, serverless, hybrid
  features: Feature[];
  techStack: TechStack;
  database?: DatabaseConfig;
  timeline: Timeline;
  team: Team;
  constraints: string[];
}
```

### Feature
```typescript
interface Feature {
  id: string;
  name: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'optional';
  category: string;              // ui, backend, database, security, etc.
  complexity: 'simple' | 'moderate' | 'complex' | 'very-complex';
  estimatedHours: number;
  dependencies: string[];
  requirements: string[];
  acceptance_criteria: string[];
  tags: string[];
  status: 'proposed' | 'approved' | 'in-progress' | 'completed' | 'rejected';
  techRequirements: string[];
}
```

### GenerationOptions
```typescript
interface RequirementsGenerationOptions {
  projectIdea: string;
  projectOptions?: ProjectOptions;
  enhancementOptions?: EnhancementOptions;
  validateOutput?: boolean;
  optimizeForCompatibility?: boolean;
  targetAudience?: 'beginner' | 'intermediate' | 'advanced';
  budgetConstraint?: string;
  timelineConstraint?: number;       // 天数
  teamSizeConstraint?: number;
  preferredTechnologies?: string[];
  avoidTechnologies?: string[];
  complianceRequirements?: string[]; // GDPR, HIPAA, etc.
  performanceRequirements?: {
    maxResponseTime?: number;
    expectedUsers?: number;
    dataVolume?: string;
  };
}
```

### GenerationResult
```typescript
interface GenerationResult {
  requirements: Requirements;
  validationResult?: ValidationResult;
  optimizedRequirements?: Requirements;
  warnings: string[];
  recommendations: string[];
  processingTime: number;
  confidence: number;               // 0-100
  metadata: {
    version: string;
    generatedAt: Date;
    generator: string;
    inputHash: string;
    iterations: number;
  };
}
```

---

## 工作流程

### 主流程

```typescript
async generateRequirements(options: RequirementsGenerationOptions): Promise<GenerationResult>
```

**步骤**:

1. **输入验证和预处理**
   ```typescript
   const processedOptions = await this.preprocessOptions(options);
   ```
   - 设置默认值
   - 验证项目想法长度 (>= 10字符)
   - 清理和规范化输入

2. **生成增强需求**
   ```typescript
   let requirements = await this.enhancer.enhanceRequirements(
     processedOptions.projectIdea,
     enhancementOptions
   );
   ```

3. **应用约束和偏好**
   ```typescript
   requirements = await this.applyConstraints(requirements, processedOptions);
   requirements = await this.applyPreferences(requirements, processedOptions);
   ```

4. **验证和优化循环**
   ```typescript
   if (validateOutput) {
     validationResult = await this.validator.validateRequirements(requirements);

     if (optimizeForCompatibility && !isValid) {
       const { requirements, iterations } = await this.optimizeRequirements(
         requirements, validationResult, processedOptions
       );
     }
   }
   ```

5. **生成警告和建议**
   ```typescript
   warnings = this.extractWarnings(validationResult);
   recommendations = this.extractRecommendations(validationResult);
   ```

6. **计算置信度分数**
   ```typescript
   confidence = this.calculateConfidence(requirements, validationResult, options);
   ```

---

## 约束应用

### 1. 团队规模约束
```typescript
if (options.teamSizeConstraint) {
  constrainedRequirements.team.size = Math.min(
    requirements.team.size,
    options.teamSizeConstraint
  );
}
```

### 2. 时间线约束
```typescript
if (options.timelineConstraint) {
  if (requirements.timeline.totalDuration > options.timelineConstraint) {
    // 优先级排序功能
    requirements.features = this.prioritizeFeatures(
      requirements.features,
      options.timelineConstraint,
      requirements.team.size
    );

    // 重新计算时间线
    requirements.timeline = this.recalculateTimeline(
      requirements.features,
      requirements.team.size,
      options.timelineConstraint
    );
  }
}
```

### 3. 合规要求
```typescript
if (options.complianceRequirements?.length > 0) {
  requirements.features = this.addComplianceFeatures(
    requirements.features,
    options.complianceRequirements
  );
}
```

**支持的合规类型**:
- GDPR: 数据同意、删除权
- HIPAA: 健康数据保护
- SOC2: 安全审计
- PCI-DSS: 支付数据处理

### 4. 性能要求
```typescript
if (options.performanceRequirements?.expectedUsers > 1000) {
  requirements.features.push({
    id: 'performance-scaling',
    name: 'Performance Scaling',
    description: 'Implement caching and performance optimization',
    priority: 'high',
    category: 'performance',
    // ...
  });
}
```

---

## 偏好应用

### 技术栈偏好
```typescript
private applyTechPreferences(
  techStack: TechStack,
  technologies: string[],
  action: 'prefer' | 'avoid'
): TechStack
```

**实现逻辑**:
- `prefer`: 优先选择指定技术
- `avoid`: 排除指定技术，寻找替代品

---

## 优化迭代

```typescript
private async optimizeRequirements(
  requirements: Requirements,
  validationResult: ValidationResult,
  options: RequirementsGenerationOptions
): Promise<{ requirements: Requirements; iterations: number }>
```

**策略**:
1. 修复关键错误
2. 应用高优先级建议
3. 重新验证
4. 最多迭代 3 次

**退出条件**:
```typescript
if (newValidationResult.isValid ||
    newScore >= oldScore + 10) {
  break; // 验证通过或显著改善
}
```

---

## 多变体生成

```typescript
async generateMultipleOptions(
  options: RequirementsGenerationOptions,
  variants: number = 3
): Promise<GenerationResult[]>
```

**变体类型**:
1. **保守型** (variant 0): 初学者友好，基础功能
2. **平衡型** (variant 1): 中级，标准功能集
3. **先进型** (variant 2): 高级用户，完整功能

**排序**: 按置信度分数降序

---

## 需求比较

```typescript
async compareRequirements(
  requirements1: Requirements,
  requirements2: Requirements
): Promise<ComparisonResult>
```

**比较维度**:
- 项目类型、复杂度、架构
- 功能集合 (共同/独特)
- 技术栈
- 评分推荐

**输出**:
- 相似点列表
- 差异点列表
- 建议
- 更好的选择 (first/second/neither)

---

## 置信度计算

```typescript
private calculateConfidence(
  requirements: Requirements,
  validationResult?: ValidationResult,
  options?: RequirementsGenerationOptions
): number
```

**评分因素**:
- 基础分: 70
- 验证分数: 30% 权重
- 关键错误惩罚: 每个 -10 分
- 功能完整性: >=8 个 +5, >=15 个 +5
- 组件完整性:
  - 数据库配置 +3
  - 约束条件 +2
  - 测试框架 +5
  - 部署方案 +3
- 复杂度适配: 0-10 分

---

## 质量检查

```typescript
private async performFinalQualityChecks(
  requirements: Requirements,
  warnings: string[]
): Promise<void>
```

**检查项**:
1. 缺少测试框架 → 警告
2. 有数据管理功能但无数据库 → 警告
3. 单人团队做非常复杂项目 → 警告
4. 时间线过于激进 → 警告

---

## 功能优先级排序

```typescript
private prioritizeFeatures(
  features: Feature[],
  maxDays: number,
  teamSize: number
): Feature[]
```

**排序规则**:
1. 按优先级: critical > high > medium > low > optional
2. 同优先级按复杂度: simple > moderate > complex > very-complex
3. 始终包含 critical 功能
4. 总工时不超过上限

**工时计算**:
```typescript
const maxHours = maxDays * teamSize * 6; // 每天6小时有效时间
```

---

## 导出格式

### JSON
```typescript
return JSON.stringify(requirements, null, 2);
```

### YAML
```typescript
return this.convertToYaml(requirements);
```

### Markdown
```typescript
return this.convertToMarkdown(requirements);
```

**Markdown 结构**:
```markdown
# {title}

## Overview
{description}

**Project Type:** {projectType}
**Complexity:** {complexity}
**Architecture:** {architecture}

## Features
### {feature name} ({priority} priority)
{description}

## Tech Stack
### Frontend
- **Framework:** {framework}
- **Language:** {language}
...

## Timeline
**Total Duration:** {totalDuration} days
**Buffer Time:** {bufferTime} days
```

---

## 值得借鉴的设计

### 1. 分层增强
- 基础需求生成
- 约束应用
- 偏好应用
- 验证优化
- 质量检查

### 2. 多样化输出
- JSON: 程序处理
- YAML: 配置管理
- Markdown: 人类阅读

### 3. 灵活的约束系统
- 团队规模
- 时间线
- 预算
- 技术偏好
- 合规要求
- 性能要求

### 4. 智能优化
- 最多3次迭代
- 基于验证结果定向优化
- 早期退出机制

### 5. 置信度评分
- 多因素综合评估
- 量化输出质量
- 帮助用户选择

### 6. 多变体生成
- 同一输入，多种方案
- 按置信度排序
- 适应不同受众

---

## 应用场景

1. **项目初始化**: 从想法到 PRD
2. **竞品分析**: 比较不同方案
3. **需求评审**: 自动验证完整性
4. **技术选型**: 基于约束推荐技术栈

---

## 扩展方向

1. **可视化生成**: UI mockup 自动生成
2. **API 规范**: OpenAPI 文档生成
3. **数据库 Schema**: ERD 图生成
4. **部署配置**: Docker/K8s 配置生成
5. **成本估算**: 基于功能和团队估算开发成本
