import { fireEvent, render, screen } from "@testing-library/react";
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
  it("does not render fabricated system init running records", () => {
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

    expect(container).toBeEmptyDOMElement();
    expect(container).not.toHaveTextContent("助理已准备好");
    expect(container).not.toHaveTextContent("运行记录");
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
  });

  it("renders real system hook content without the old running-record label", () => {
    const message = {
      type: "system",
      content: "\u001b[32m真实工具记录\u001b[0m",
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    render(<SystemMessageComponent message={message} />);

    expect(screen.getByText("处理动态")).toBeInTheDocument();
    expect(screen.getByText("真实工具记录")).toBeInTheDocument();
    expect(screen.queryByText("运行记录")).not.toBeInTheDocument();
  });

  it("hides internal API retry telemetry from the chat surface", () => {
    const message = {
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      delay_ms: 1000,
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(container).toBeEmptyDOMElement();
    expect(container).not.toHaveTextContent("处理动态");
    expect(container).not.toHaveTextContent("api_retry");
    expect(container).not.toHaveTextContent('"type"');
  });

  it("collapses verbose skill runtime details until expanded", () => {
    const message = {
      type: "system",
      content: [
        "Base directory for this skill: /home/mycc/.claude/skills/browser-use",
        "",
        "# Browser Use In MyCC Sandbox",
        "",
        "The sandbox includes browser automation dependencies.",
        "ARGUMENTS: https://bbs.byr.cn/#!board/Job",
      ].join("\n"),
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(
      screen.getByRole("button", { name: /处理动态/ }),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Base directory for this skill");
    expect(container).not.toHaveTextContent("Browser Use In MyCC Sandbox");

    fireEvent.click(screen.getByRole("button", { name: /处理动态/ }));

    expect(container).toHaveTextContent("Base directory for this skill");
    expect(container).toHaveTextContent("Browser Use In MyCC Sandbox");
  });

  it("hides successful result metadata from the chat surface", () => {
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

    expect(container).toBeEmptyDOMElement();
    expect(container).not.toHaveTextContent("整理完成");
    expect(container).not.toHaveTextContent("本次整理用时");
    expect(container).not.toHaveTextContent("后台整理");
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
  });

  it("renders errored result messages as productized problems", () => {
    const message = {
      type: "result",
      subtype: "error_during_execution",
      duration_ms: 1234,
      is_error: true,
      result: "exit status 1",
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(screen.getByText("需要处理的问题")).toBeInTheDocument();
    expect(container).toHaveTextContent("这次操作没有跑通");
    expect(container).not.toHaveTextContent("exit status 1");
    expect(container).not.toHaveTextContent("本次整理用时");
    expect(container).not.toHaveTextContent("后台整理");
  });

  it("hides low-level stream error details from the chat surface", () => {
    const message = {
      type: "error",
      subtype: "stream_error",
      message: "exit status 1",
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(screen.getByText("需要处理的问题")).toBeInTheDocument();
    expect(container).toHaveTextContent("这次操作没有跑通");
    expect(container).not.toHaveTextContent("exit status 1");
  });

  it("hides internal bridge startup failures from the chat surface", () => {
    const message = {
      type: "error",
      subtype: "stream_error",
      message:
        "[invalid_argument] error starting process '/bin/bash -l -c cd /opt/mycc-agent-runtime && node bridge.mjs': fork/exec /bin/sh: argument list too long",
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(container).toHaveTextContent("这次操作没有跑通");
    expect(container).not.toHaveTextContent("bridge.mjs");
    expect(container).not.toHaveTextContent("/bin/bash");
    expect(container).not.toHaveTextContent("argument list too long");
  });

  it("renders paused conversation guidance without technical wording", () => {
    const message = {
      type: "system",
      subtype: "abort",
      message: "已暂停这次任务",
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(container).toHaveTextContent("补充说明后继续");
    expect(container).toHaveTextContent("重新尝试");
    expect(container).toHaveTextContent("成果空间");
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
    expect(container).not.toHaveTextContent(/abort|requestId|SSE|runtime/i);
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

    const { container } = render(
      <ToolResultMessageComponent message={message} />,
    );

    expect(screen.getByText("本地操作结果")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(forbiddenVisibleWords);
  });
});
