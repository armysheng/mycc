/**
 * 官方 Claude Code SDK 实现
 */

import { query } from "@anthropic-ai/claude-code";
import { execSync } from "child_process";
import type { CCAdapter, SSEEvent } from "./interface.js";
import type { ChatParams, ConversationSummary, ConversationHistory } from "../types.js";
import { getConversationList, getConversation } from "../history.js";

// 检测 Claude CLI 路径
function detectClaudeCliPath(): string {
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    return "/usr/local/bin/claude"; // fallback
  }
}

const CLAUDE_CLI_PATH = detectClaudeCliPath();

/**
 * 官方 Claude Code SDK Adapter
 */
export class OfficialAdapter implements CCAdapter {
  /**
   * 发送消息，返回 SSE 事件流
   */
  async *chat(params: ChatParams): AsyncIterable<SSEEvent> {
    const { message, sessionId, cwd } = params;

    for await (const sdkMessage of query({
      prompt: message,
      options: {
        // 指定 CLI 路径，确保完整加载配置（包括 skills）
        executable: "node" as const,
        pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
        cwd: cwd || process.cwd(),
        resume: sessionId || undefined,
        // 小程序端无法交互确认权限，使用 bypassPermissions
        permissionMode: "bypassPermissions",
      },
    })) {
      yield sdkMessage as SSEEvent;
    }
  }

  /**
   * 获取历史记录列表
   */
  async listHistory(cwd: string, limit?: number): Promise<{
    conversations: ConversationSummary[];
    total: number;
    hasMore: boolean;
  }> {
    let conversations = getConversationList(cwd);
    const total = conversations.length;

    // 如果 limit > 0，只返回前 limit 条
    if (limit && limit > 0) {
      conversations = conversations.slice(0, limit);
    }

    return {
      conversations,
      total,
      hasMore: conversations.length < total,
    };
  }

  /**
   * 获取单个对话详情
   */
  async getHistory(cwd: string, sessionId: string): Promise<ConversationHistory | null> {
    return getConversation(cwd, sessionId);
  }
}
