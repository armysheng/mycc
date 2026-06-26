import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "../../contexts/SettingsContext";
import type { AllMessage } from "../../types";
import { ChatMessages } from "./ChatMessages";

function renderMessages(
  messages: AllMessage[],
  overrides: Partial<Parameters<typeof ChatMessages>[0]> = {},
) {
  const props: Parameters<typeof ChatMessages>[0] = {
    messages,
    isLoading: false,
    assistantDisplayName: "cc",
    assistantAvatarText: "CC",
    ...overrides,
  };

  const result = render(
    <SettingsProvider>
      <ChatMessages {...props} />
    </SettingsProvider>,
  );

  return { props, ...result };
}

describe("ChatMessages conversation actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows visible feedback after copying a reply", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderMessages([
      {
        type: "chat",
        role: "assistant",
        content: "这是一段可以复制的回复。",
        timestamp: 1710000000100,
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "复制这条回复" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("这是一段可以复制的回复。");
    });
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("lets users re-edit a previous prompt", () => {
    const onReEditMessage = vi.fn();
    renderMessages(
      [
        {
          type: "chat",
          role: "user",
          content: "把工作区文件放右侧",
          timestamp: 1710000000000,
        },
      ],
      { onReEditMessage },
    );

    fireEvent.click(screen.getByRole("button", { name: "重新编辑这条消息" }));

    expect(onReEditMessage).toHaveBeenCalledWith("把工作区文件放右侧");
  });

  it("lets users retry from the latest prompt before an assistant reply", () => {
    const onRetryMessage = vi.fn();
    renderMessages(
      [
        {
          type: "chat",
          role: "user",
          content: "帮我整理工作区",
          timestamp: 1710000000000,
        },
        {
          type: "chat",
          role: "assistant",
          content: "这次没有跑通。",
          timestamp: 1710000000100,
        },
      ],
      { onRetryMessage },
    );

    fireEvent.click(screen.getByRole("button", { name: "重新生成这条回复" }));

    expect(onRetryMessage).toHaveBeenCalledWith("帮我整理工作区");
  });

  it("shows a compact Codex-like activity row for the latest running tool", () => {
    renderMessages(
      [
        {
          type: "tool",
          toolName: "Read",
          content: "Reading /tmp/project/README.md",
          input: { file_path: "/tmp/project/README.md" },
          timestamp: 1710000000100,
        },
      ],
      { isLoading: true },
    );

    expect(screen.getByText("正在读取 README.md")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /查看处理详情/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /正在读取 README.md/ })).toBeInTheDocument();
    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();
    expect(screen.queryByText(/Read/)).not.toBeInTheDocument();
  });

  it("uses the current prompt instead of hard-coded loading copy before tool events", () => {
    const { container } = renderMessages(
      [
        {
          type: "chat",
          role: "user",
          content: "帮我打开控制台用户页面",
          timestamp: 1710000000000,
        },
      ],
      { isLoading: true },
    );

    expect(container).not.toHaveTextContent("正在整理你的任务");
    expect(container).not.toHaveTextContent("思考中");
    expect(screen.getByText("正在理解请求")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看处理详情：正在理解请求" }),
    ).toBeInTheDocument();
  });

  it("filters internal API retry telemetry out of the visible message list", () => {
    const { container } = renderMessages([
      {
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        delay_ms: 1000,
        timestamp: 1710000000100,
      } as unknown as AllMessage,
    ]);

    expect(screen.getByText("今天要 cc 帮你做什么？")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("处理动态");
    expect(container).not.toHaveTextContent("api_retry");
    expect(container).not.toHaveTextContent('"type"');
  });

  it("turns browser skill activity into product language", () => {
    renderMessages(
      [
        {
          type: "tool",
          toolName: "Skill",
          content: "Launching skill: browser-use",
          input: { skill: "browser-use" },
          timestamp: 1710000000100,
        },
      ],
      { isLoading: true },
    );

    expect(screen.getByText("正在打开浏览器")).toBeInTheDocument();
    expect(screen.queryByText(/Launching skill/)).not.toBeInTheDocument();
    expect(screen.queryByText(/browser-use/)).not.toBeInTheDocument();
  });

  it("lets users expand running activity details", () => {
    const { container } = renderMessages(
      [
        {
          type: "tool",
          toolName: "Bash",
          content: "Running npm run typecheck",
          input: { command: "npm run typecheck" },
          timestamp: 1710000000100,
        },
        {
          type: "tool_result",
          toolName: "Bash",
          content: "typecheck passed with no errors",
          summary: "1 line",
          timestamp: 1710000000200,
        },
      ],
      { isLoading: true },
    );

    expect(container).not.toHaveTextContent("typecheck passed with no errors");
    fireEvent.click(screen.getByRole("button", { name: /查看处理详情/ }));

    expect(container).toHaveTextContent("typecheck passed with no errors");
  });

  it("groups completed tool details into a collapsed process item", () => {
    const { container } = renderMessages([
      {
        type: "tool",
        toolName: "Read",
        content: "Reading /tmp/project/README.md",
        input: { file_path: "/tmp/project/README.md" },
        timestamp: 1710000000100,
      },
      {
        type: "tool_result",
        toolName: "Read",
        content: "README content",
        summary: "1 file",
        timestamp: 1710000000200,
      },
      {
        type: "chat",
        role: "assistant",
        content: "我看完了。",
        timestamp: 1710000000300,
      },
    ]);

    expect(screen.getByRole("button", { name: /过程/ })).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Reading /tmp/project/README.md");
    expect(container).not.toHaveTextContent("README content");

    fireEvent.click(screen.getByRole("button", { name: /过程/ }));

    expect(container).toHaveTextContent("正在读取 README.md");
    expect(container).toHaveTextContent("README content");
  });
});
