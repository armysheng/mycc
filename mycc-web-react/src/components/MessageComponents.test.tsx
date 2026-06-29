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

  it("does not display internal hook details", () => {
    const message = {
      type: "system",
      content:
        "MyCC E2B sandbox failed for mycc_u_123 token at /home/mycc linuxUser",
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(container).toHaveTextContent("这次操作没有跑通");
    expect(container).not.toHaveTextContent(
      /MyCC|E2B|sandbox|token|mycc_u|linuxUser|\/home\/mycc/i,
    );
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

  it("hides verbose skill runtime details from the chat surface", () => {
    const message = {
      type: "system",
      content: [
        "Base directory for this skill: /home/mycc/.claude/skills/browser-use",
        "",
        "# 道友 AI 助理浏览器",
        "",
        "道友 AI 的云端工作间预装浏览器自动化能力。",
        "ARGUMENTS: https://bbs.byr.cn/#!board/Job",
      ].join("\n"),
      timestamp: 1710000000000,
    } as unknown as SystemMessage;

    const { container } = render(<SystemMessageComponent message={message} />);

    expect(screen.getByText("处理动态")).toBeInTheDocument();
    expect(container).toHaveTextContent("处理动态已记录");
    expect(container).not.toHaveTextContent("这次操作没有跑通");
    expect(container).not.toHaveTextContent("Base directory for this skill");
    expect(container).not.toHaveTextContent("道友 AI 助理浏览器");
    expect(container).not.toHaveTextContent(/MyCC|sandbox|\/home\/mycc/i);
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

  it("does not display internal tool result details when expanded", () => {
    const message: ToolResultMessage = {
      type: "tool_result",
      toolName: "Read",
      content:
        "MyCC E2B sandbox failed for mycc_u_123 token at /home/mycc linuxUser",
      summary: "internal detail",
      timestamp: 1710000000000,
    };

    const { container } = render(
      <ToolResultMessageComponent message={message} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /资料查找结果/ }));

    expect(container).toHaveTextContent("这次操作没有跑通");
    expect(container).not.toHaveTextContent(
      /MyCC|E2B|sandbox|token|mycc_u|linuxUser|\/home\/mycc/i,
    );
  });

  it("does not display internal tool result summary badges", () => {
    const message: ToolResultMessage = {
      type: "tool_result",
      toolName: "Read",
      content: "读取完成",
      summary: "MyCC E2B sandbox token /home/mycc",
      timestamp: 1710000000000,
    };

    const { container } = render(
      <ToolResultMessageComponent message={message} />,
    );

    expect(container).toHaveTextContent("完成");
    expect(container).not.toHaveTextContent(
      /MyCC|E2B|sandbox|token|\/home\/mycc/i,
    );
  });

  it("does not display contextual sandbox token errors in summary badges", () => {
    const message: ToolResultMessage = {
      type: "tool_result",
      toolName: "Read",
      content: "读取完成",
      summary: "sandbox init failed: missing token",
      timestamp: 1710000000000,
    };

    const { container } = render(
      <ToolResultMessageComponent message={message} />,
    );

    expect(container).toHaveTextContent("完成");
    expect(container).not.toHaveTextContent(/sandbox|token/i);
  });

  it("does not display short internal expiry errors in summary badges", () => {
    const message: ToolResultMessage = {
      type: "tool_result",
      toolName: "Read",
      content: "读取完成",
      summary: "token expired",
      timestamp: 1710000000000,
    };

    const { container } = render(
      <ToolResultMessageComponent message={message} />,
    );

    expect(container).toHaveTextContent("完成");
    expect(container).not.toHaveTextContent(/token expired/i);
  });

  it("does not treat successful code snippets as low-level errors", () => {
    const message: ToolResultMessage = {
      type: "tool_result",
      toolName: "Read",
      content:
        '<iframe sandbox=""></iframe>\nconst input_tokens = 12;\nconst provider = "local";',
      summary: "3 lines",
      timestamp: 1710000000000,
    };

    const { container } = render(
      <ToolResultMessageComponent message={message} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /资料查找结果/ }));

    expect(container).toHaveTextContent('<iframe sandbox=""></iframe>');
    expect(container).toHaveTextContent("input_tokens");
    expect(container).toHaveTextContent("provider");
    expect(container).not.toHaveTextContent("这次操作没有跑通");
  });

  it("does not treat successful code snippets with error constants as failures", () => {
    const message: ToolResultMessage = {
      type: "tool_result",
      toolName: "Read",
      content:
        'const message = "Command failed with exit code 1";\n#!/bin/bash\necho "Bad Request fixture";',
      summary: "3 lines",
      timestamp: 1710000000000,
    };

    const { container } = render(
      <ToolResultMessageComponent message={message} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /资料查找结果/ }));

    expect(container).toHaveTextContent("Command failed with exit code 1");
    expect(container).toHaveTextContent("#!/bin/bash");
    expect(container).toHaveTextContent("Bad Request fixture");
    expect(container).not.toHaveTextContent("这次操作没有跑通");
  });
});
