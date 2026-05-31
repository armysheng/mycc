import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PlanMessageComponent,
  SystemMessageComponent,
  ToolResultMessageComponent,
} from "./MessageComponents";
import type { PlanMessage, SystemMessage, ToolResultMessage } from "../types";

const forbiddenVisibleWords =
  /Claude|Bash|command|命令|API Key|CWD|Permission Mode|Tokens|Cost|Session|Tools|System|Result/;

describe("MessageComponents productized system copy", () => {
  it("renders system init details as assistant-facing running status", () => {
    const message = {
      type: "system",
      subtype: "init",
      model: "claude-sonnet",
      session_id: "abcdef123456",
      tools: ["Read", "Bash"],
      cwd: "/tmp/project",
      permissionMode: "default",
      apiKeySource: "env",
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(screen.getByText("运行记录")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
  });

  it("renders result details without token, cost, or session terminology", () => {
    const message = {
      type: "result",
      subtype: "success",
      duration_ms: 1234,
      total_cost_usd: 0.42,
      is_error: false,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(screen.getByText("整理完成")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
  });

  it("renders plan messages without naming Claude or coding-console prompts", () => {
    const message: PlanMessage = {
      type: "plan",
      plan: "1. 查看资料\n2. 给出建议",
      toolUseId: "tool-1",
      timestamp: 1710000000000,
    };

    const { container } = render(<PlanMessageComponent message={message} />);

    expect(screen.getByText("准备继续")).toBeInTheDocument();
    expect(screen.getByText("我整理了一个执行计划：")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
  });

  it("renders shell tool results as local operation results", () => {
    const message: ToolResultMessage = {
      type: "tool_result",
      toolName: "Bash",
      content: "ok",
      summary: "done",
      timestamp: 1710000000000,
      toolUseResult: { stdout: "ok", stderr: "" },
    };

    const { container } = render(<ToolResultMessageComponent message={message} />);

    expect(screen.getByText("本地操作结果")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
  });
});
