# MyCC 飞书集成方案架构评估报告

## 执行摘要

本文评估用户提出的"双通道并行"飞书集成方案。经过详细分析，该方案在架构上是**可行且优雅的**，但存在几个需要特别关注的技术挑战。

**核心结论**：
- **架构优势**：高度模块化，复用现有 Session 管理，扩展性好
- **技术可行性**：中等难度，需要添加飞书通道适配层
- **实现复杂度**：与远程仓库同步无冲突，改动局限在 mycc 技能内
- **潜在问题**：集群模式消息分发、会话状态同步、图文消息过滤
- **推荐程度**：⭐⭐⭐⭐ 推荐采用，但需先验证关键假设

---

## 一、方案概述

### 1.1 提出的架构

```
┌─────────────┐                    ┌──────────────┐
│  MyCC Web   │ ──────────────────> │              │
│  小程序/网页 │                    │              │
└─────────────┘                    │  MyCC 后端   │
                                    │  (现有)      │
┌─────────────┐                    │              │
│    飞书      │ ──────────────────> │              │
│   长连接     │                    │              │
└─────────────┘                    └──────────────┘
           ▲                               │
           │                               │
           └────────── 过滤文字 ────────────┘
```

**关键特性**：
- Web 通道和飞书通道并行运行
- 两个通道都向后端发送消息
- 后端消息广播到两个通道
- 飞书通道只发送文字信息（过滤图片等富媒体）

### 1.2 与"独立网关模式"的对比

| 维度 | 双通道并行模式（用户方案） | 独立网关模式 |
|------|-------------------------|-------------|
| **架构复杂度** | ⭐⭐ 中等 | ⭐⭐⭐⭐ 较高 |
| **代码侵入性** | 低（在 mycc 内扩展） | 高（需要独立网关层） |
| **部署复杂度** | ⭐⭐ 低 | ⭐⭐⭐ 中 |
| **会话管理** | 复用现有 Session 池 | 需要额外的会话同步机制 |
| **消息过滤** | 在广播层过滤 | 在网关层处理 |
| **维护成本** | 低 | 中（需维护独立网关） |
| **扩展性** | 好（易于添加新通道） | 更好（完全解耦） |

**结论**：双通道并行模式在保持足够扩展性的同时，显著降低了架构复杂度。

---

## 二、架构优势分析

### 2.1 模块化设计

该方案遵循"关注点分离"原则：

```
.claude/skills/mycc/
├── scripts/src/
│   ├── adapters/           # 现有：Claude Code 适配器
│   ├── channels/           # 新增：通道抽象层
│   │   ├── base.ts         #    通道基类
│   │   ├── web.ts          #    Web 通道（现有逻辑迁移）
│   │   └── feishu.ts       #    飞书通道
│   ├── http-server.ts      # 现有：HTTP 服务器
│   └── index.ts            #    主入口（启动多通道）
```

**优势**：
- 每个通道独立实现，互不干扰
- 易于测试和调试
- 未来可轻松添加其他通道（如钉钉、企业微信）

### 2.2 复用现有 Session 管理

MyCC 的核心优势是其 Session 池管理（OfficialAdapter）：

```typescript
// 现有架构
export class OfficialAdapter implements CCAdapter {
  private sessions = new Map<string, SDKSession>();
  private lastActivity = new Map<string, number>();
  
  getOrCreateSession(params: SessionParams): SDKSession { ... }
  closeSession(sessionId: string): void { ... }
}
```

**复用方案**：
- 飞书通道和 Web 通道共享同一个 OfficialAdapter 实例
- 消息来源通过 source 字段区分：{ message, sessionId, source: 'web' | 'feishu' }
- Session 切换时，两个通道自动跟随（因为共享同一个 Session 对象）

**好处**：
- 无需重复实现 Session 管理
- Web 前端切换会话时，飞书自动工作在正确的会话上
- 避免了会话状态不一致的问题

### 2.3 广播机制简洁

消息广播可以在 SSE 事件流层面实现：

```typescript
// 伪代码
async *chat(params: ChatParams): AsyncIterable<SSEEvent> {
  const { message, sessionId, source } = params;
  
  // 1. 统一调用 adapter.chat()
  for await (const event of adapter.chat({ message, sessionId })) {
    // 2. 广播到所有通道
    yield event;  // 给请求来源通道
    
    // 3. 给其他通道（异步，不阻塞主流程）
    broadcastToOtherChannels(source, event);
  }
}
```

---

## 三、技术可行性分析

### 3.1 需要修改的核心代码

| 文件 | 修改类型 | 复杂度 | 说明 |
|------|---------|--------|------|
| adapters/official.ts | 轻微修改 | ⭐ | 添加 source 参数支持 |
| http-server.ts | 轻微修改 | ⭐ | 调整为通道模式 |
| channels/ | 新增模块 | ⭐⭐⭐ | 实现飞书通道逻辑 |
| index.ts | 中等修改 | ⭐⭐ | 启动多通道管理器 |
| types.ts | 类型扩展 | ⭐ | 添加通道相关类型 |

**总体评估**：修改范围局限在 mycc 技能内，不影响远程仓库同步。

### 3.2 飞书通道实现要点

根据飞书长连接调研报告，飞书通道需要：

```typescript
// channels/feishu.ts
import Lark from '@larksuiteoapi/node-sdk';

export class FeishuChannel {
  private wsClient: Lark.WSClient;
  private adapter: CCAdapter;
  
  constructor(adapter: CCAdapter) {
    this.adapter = adapter;
    this.wsClient = new Lark.WSClient({
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      domain: Lark.Domain.Feishu,
      appType: Lark.AppType.SelfBuild,
      eventDispatcher: this.createDispatcher(),
    });
  }
  
  private createDispatcher() {
    const dispatcher = new Lark.EventDispatcher();
    
    dispatcher.on('im.message.receive_v1', async (data) => {
      // 1. 提取消息内容
      const { text, sender_id } = this.parseMessage(data);
      
      // 2. 调用 adapter.chat（source: 'feishu'）
      for await (const event of this.adapter.chat({
        message: text,
        sessionId: this.getCurrentSession(sender_id),
        source: 'feishu',
      })) {
        // 3. 发送回飞书（只发送文字）
        if (this.isTextEvent(event)) {
          await this.sendToFeishu(sender_id, event);
        }
      }
    });
    
    return dispatcher;
  }
  
  start() {
    this.wsClient.start();
  }
}
```

### 3.3 消息过滤策略

飞书只接收文字消息，需要过滤：

```typescript
private isTextEvent(event: SSEEvent): boolean {
  // 1. 过滤非文本内容
  if (event.type === 'tool_use') return false;
  if (event.type === 'image') return false;
  
  // 2. 提取文本内容
  if (event.type === 'text') {
    return true;
  }
  
  // 3. 对于 result 类型，提取 message 中的文本
  if (event.type === 'result') {
    const result = event as SDKResultMessage;
    // 只发送 result 的摘要文本，不发送完整工具调用
    return result.result?.type === 'success';
  }
  
  return false;
}
```

---

## 四、潜在问题与挑战

### 4.1 飞书集群模式的限制

**问题**：根据调研报告，飞书长连接采用"集群模式"推送，多客户端只有一个能收到消息。

**影响分析**：
- 如果用户同时在 Web 和飞书发送消息，可能只有一个通道收到响应
- 这是飞书 SDK 的特性，无法绕过

**缓解方案**：
1. **消息去重**：根据 event_id 去重，避免重复处理
2. **明确告知用户**：在文档中说明，建议使用单一通道进行交互
3. **优先级策略**：飞书消息优先（因为是实时通道），Web 消息降级

### 4.2 会话状态同步

**问题**：Web 前端切换会话时，飞书通道如何知道当前工作在哪个会话？

**解决方案**：
1. **隐式同步**：因为两个通道共享同一个 OfficialAdapter 实例，getOrCreateSession() 总是返回最新的 Session
2. **显式通知**：Web 切换会话时，发送内部事件通知飞书通道
3. **用户ID映射**：为每个飞书用户维护一个当前 Session ID 的映射

### 4.3 3秒处理时限

**问题**：飞书要求事件处理在 3 秒内完成，否则会重推。

**影响分析**：
- Claude Code 的响应时间通常超过 3 秒
- 如果直接在事件处理器中等待响应，会触发超时重推

**解决方案**：
```typescript
dispatcher.on('im.message.receive_v1', async (data) => {
  // 1. 立即返回（3秒内）
  processMessageAsync(data);  // 异步处理
  
  return { code: 0 };  // 立即响应
});
```

### 4.4 图文混合消息处理

**问题**：Claude Code 可能返回图文混合内容，飞书如何处理？

**解决方案**：
1. **文本优先**：只提取文本内容发送
2. **图片链接**：如果图片有 URL，发送链接
3. **明确提示**：在飞书消息末尾添加"（完整内容请查看 Web）"

---

## 五、实现路线图

### Phase 1: 通道抽象层（1-2天）

- 创建 Channel 基类
- 实现 WebChannel（迁移现有逻辑）
- 实现 FeishuChannel 框架

### Phase 2: 多通道管理器（1天）

- 实现 ChannelManager
- 实现消息广播机制
- 实现通道生命周期管理

### Phase 3: 飞书通道实现（2-3天）

1. 集成飞书 SDK
2. 实现消息接收和发送
3. 实现文本过滤逻辑
4. 实现用户会话映射

### Phase 4: 测试和优化（1-2天）

1. 单元测试
2. 集成测试
3. 性能优化
4. 文档编写

**总工作量估计**：5-8 天

---

## 六、与远程仓库同步的影响

### 6.1 同步机制分析

MyCC 的远程仓库同步是通过 Claude Code CLI 内部机制实现的，与 mycc 后端的实现无关。

**结论**：添加飞书通道**不会影响**远程仓库同步功能。

### 6.2 代码改动范围

所有改动都在 .claude/skills/mycc/ 目录内：

```
.claude/skills/mycc/
├── scripts/src/
│   ├── channels/          # 新增
│   ├── adapters/          # 轻微修改
│   ├── http-server.ts     # 轻微修改
│   └── index.ts           # 轻微修改
```

这些改动能正常提交到远程仓库，不会被 Claude Code CLI 过滤掉。

---

## 七、推荐结论

### 7.1 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构优雅性 | ⭐⭐⭐⭐⭐ | 模块化、可扩展 |
| 技术可行性 | ⭐⭐⭐⭐ | 可行，需要一定工作量 |
| 实现复杂度 | ⭐⭐⭐ | 中等难度 |
| 维护成本 | ⭐⭐⭐⭐ | 低 |
| 风险程度 | ⭐⭐⭐ | 中等（主要是飞书集群模式限制） |

### 7.2 最终建议

**推荐采用该方案**，但建议按以下优先级实施：

1. **先验证关键假设**（1天）
   - 验证飞书集群模式是否真的影响双通道
   - 验证 3 秒时限的异步处理是否可行
   - 验证图文消息过滤的用户体验

2. **实现最小可用版本**（3-4天）
   - 只实现文本消息收发
   - 只支持单用户（单飞书用户）
   - 不支持会话切换

3. **逐步完善功能**（后续迭代）
   - 支持多用户
   - 支持会话切换
   - 优化图文混合消息处理

### 7.3 替代方案

如果验证发现飞书集群模式限制严重影响体验，可以考虑：

**方案A：独立飞书实例**
- 为飞书单独运行一个 mycc 实例
- 完全独立，不共享 Session
- 优点：避免集群模式问题
- 缺点：无法共享会话，用户体验割裂

**方案B：Webhook 模式**
- 不使用飞书长连接，改用 Webhook
- 需要公网服务器
- 优点：避免集群模式问题
- 缺点：部署复杂度增加

---

## 八、总结

该双通道并行飞书集成方案在架构上是**可行且推荐的**。它的主要优势包括：

1. **模块化设计**：易于维护和扩展
2. **复用现有资产**：充分利用 mycc 的 Session 管理能力
3. **改动局限**：不影响远程仓库同步
4. **用户体验好**：Web 和飞书无缝切换

主要挑战包括：

1. **飞书集群模式限制**：需要通过消息去重和用户教育缓解
2. **3秒时限**：需要异步处理
3. **图文消息过滤**：需要精心设计用户体验

建议采用**渐进式实施策略**，先验证关键假设，再实现最小可用版本，最后逐步完善功能。

---

**报告生成时间**：2026-02-15  
**评估人**：Claude (Lead Software Architect)  
**文档版本**：v1.0
