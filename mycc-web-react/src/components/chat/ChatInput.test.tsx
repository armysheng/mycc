import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "../../contexts/SettingsContext";
import { ChatInput } from "./ChatInput";

function renderChatInput(overrides: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const props: Parameters<typeof ChatInput>[0] = {
    input: "",
    isLoading: false,
    currentRequestId: null,
    onInputChange: vi.fn(),
    onSubmit: vi.fn(),
    onAbort: vi.fn(),
    permissionMode: "bypassPermissions",
    onPermissionModeChange: vi.fn(),
    ...overrides,
  };
  render(
    <SettingsProvider>
      <ChatInput {...props} />
    </SettingsProvider>,
  );
  return props;
}

describe("ChatInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a focused hero composer for the new-chat surface", () => {
    renderChatInput({
      variant: "hero",
      placeholder: "描述你想完成的事，MyCC 会帮你拆解并执行…",
    });

    expect(screen.getByPlaceholderText("描述你想完成的事，MyCC 会帮你拆解并执行…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自动执行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.queryByText(/Ctrl\+Shift\+M/)).not.toBeInTheDocument();
  });

  it("changes permission mode from the hero toolbar", () => {
    const onPermissionModeChange = vi.fn();
    renderChatInput({
      variant: "hero",
      onPermissionModeChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "自动执行" }));

    expect(onPermissionModeChange).toHaveBeenCalledWith("plan");
  });

  it("cycles permission modes without getting stuck", () => {
    const onPermissionModeChange = vi.fn();
    const { rerender } = render(
      <SettingsProvider>
        <ChatInput
          input=""
          isLoading={false}
          currentRequestId={null}
          onInputChange={vi.fn()}
          onSubmit={vi.fn()}
          onAbort={vi.fn()}
          permissionMode="bypassPermissions"
          onPermissionModeChange={onPermissionModeChange}
        />
      </SettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /执行模式：自动执行/ }));
    expect(onPermissionModeChange).toHaveBeenLastCalledWith("plan");

    rerender(
      <SettingsProvider>
        <ChatInput
          input=""
          isLoading={false}
          currentRequestId={null}
          onInputChange={vi.fn()}
          onSubmit={vi.fn()}
          onAbort={vi.fn()}
          permissionMode="plan"
          onPermissionModeChange={onPermissionModeChange}
        />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /执行模式：规划优先/ }));
    expect(onPermissionModeChange).toHaveBeenLastCalledWith("default");

    rerender(
      <SettingsProvider>
        <ChatInput
          input=""
          isLoading={false}
          currentRequestId={null}
          onInputChange={vi.fn()}
          onSubmit={vi.fn()}
          onAbort={vi.fn()}
          permissionMode="default"
          onPermissionModeChange={onPermissionModeChange}
        />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /执行模式：标准执行/ }));
    expect(onPermissionModeChange).toHaveBeenLastCalledWith("acceptEdits");

    rerender(
      <SettingsProvider>
        <ChatInput
          input=""
          isLoading={false}
          currentRequestId={null}
          onInputChange={vi.fn()}
          onSubmit={vi.fn()}
          onAbort={vi.fn()}
          permissionMode="acceptEdits"
          onPermissionModeChange={onPermissionModeChange}
        />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /执行模式：自动接受编辑/ }));
    expect(onPermissionModeChange).toHaveBeenLastCalledWith("bypassPermissions");
  });

  it("can hide the permission mode control for productized bypass mode", () => {
    const onPermissionModeChange = vi.fn();
    renderChatInput({
      input: "你好",
      onPermissionModeChange,
      showPermissionModeControl: false,
    });

    expect(screen.queryByRole("button", { name: /执行模式：自动执行/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "m",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(onPermissionModeChange).not.toHaveBeenCalled();
  });

  it("shows a clear pause control while a task is running", () => {
    const onAbort = vi.fn();
    renderChatInput({
      isLoading: true,
      currentRequestId: "request-running",
      onAbort,
      showPermissionModeControl: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "暂停这次任务" }));

    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("keeps the composer usable while a task is running", () => {
    const onSubmit = vi.fn();

    function Harness() {
      const [input, setInput] = useState("");
      return (
        <SettingsProvider>
          <ChatInput
            input={input}
            isLoading={true}
            currentRequestId="request-running"
            onInputChange={setInput}
            onSubmit={onSubmit}
            onAbort={vi.fn()}
            permissionMode="bypassPermissions"
            onPermissionModeChange={vi.fn()}
            showPermissionModeControl={false}
          />
        </SettingsProvider>
      );
    }

    render(<Harness />);

    const textbox = screen.getByRole("textbox");
    expect(textbox).toBeEnabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    fireEvent.change(textbox, {
      target: { value: "补充一个新需求" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps dropped files as chips and submits them as assistant context", async () => {
    const onSubmit = vi.fn();

    function Harness() {
      const [input, setInput] = useState("");
      return (
        <SettingsProvider>
          <ChatInput
            input={input}
            isLoading={false}
            currentRequestId={null}
            onInputChange={setInput}
            onSubmit={onSubmit}
            onAbort={vi.fn()}
            permissionMode="bypassPermissions"
            onPermissionModeChange={vi.fn()}
            showPermissionModeControl={false}
          />
        </SettingsProvider>
      );
    }

    render(<Harness />);

    const file = new File(["项目目标：优化对话框"], "dialog-plan.txt", {
      type: "text/plain",
    });

    fireEvent.drop(screen.getByTestId("chat-composer-dropzone"), {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    expect(await screen.findByText("dialog-plan.txt")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "帮我整理一下" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submittedPrompt = onSubmit.mock.calls[0][0] as string;
    expect(submittedPrompt).toContain("帮我整理一下");
    expect(submittedPrompt).toContain("dialog-plan.txt");
    expect(submittedPrompt).toContain("项目目标：优化对话框");
    expect(onSubmit.mock.calls[0][1]).toContain("已添加资料：dialog-plan.txt");
  });

  it("submits image attachments as image payloads without exposing base64 in the visible message", async () => {
    const onSubmit = vi.fn();

    function Harness() {
      const [input, setInput] = useState("");
      return (
        <SettingsProvider>
          <ChatInput
            input={input}
            isLoading={false}
            currentRequestId={null}
            onInputChange={setInput}
            onSubmit={onSubmit}
            onAbort={vi.fn()}
            permissionMode="bypassPermissions"
            onPermissionModeChange={vi.fn()}
            showPermissionModeControl={false}
          />
        </SettingsProvider>
      );
    }

    render(<Harness />);

    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const image = new File([pngBytes], "screen.png", {
      type: "image/png",
      lastModified: 1,
    });

    fireEvent.drop(screen.getByTestId("chat-composer-dropzone"), {
      dataTransfer: {
        files: [image],
        types: ["Files"],
      },
    });

    expect(await screen.findByText("screen.png")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "看一下这个截图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toContain("看一下这个截图");
    expect(onSubmit.mock.calls[0][1]).toBe("看一下这个截图\n\n已添加资料：screen.png");
    expect(onSubmit.mock.calls[0][1]).not.toContain("iVBORw");
    expect(onSubmit.mock.calls[0][2]).toEqual([
      {
        data: "iVBORw==",
        mediaType: "image/png",
      },
    ]);
  });

  it("shows image previews and a readable warning for unsupported files", async () => {
    function Harness() {
      const [input, setInput] = useState("");
      return (
        <SettingsProvider>
          <ChatInput
            input={input}
            isLoading={false}
            currentRequestId={null}
            onInputChange={setInput}
            onSubmit={vi.fn()}
            onAbort={vi.fn()}
            permissionMode="bypassPermissions"
            onPermissionModeChange={vi.fn()}
            showPermissionModeControl={false}
          />
        </SettingsProvider>
      );
    }

    render(<Harness />);

    const image = new File([new Uint8Array([137, 80, 78, 71])], "screen.png", {
      type: "image/png",
      lastModified: 1,
    });
    const archive = new File([new Uint8Array([80, 75, 3, 4])], "backup.zip", {
      type: "application/zip",
      lastModified: 1,
    });

    fireEvent.drop(screen.getByTestId("chat-composer-dropzone"), {
      dataTransfer: {
        files: [image, archive],
        types: ["Files"],
      },
    });

    expect(await screen.findByAltText("screen.png 预览")).toBeInTheDocument();
    expect(screen.getByText("图片")).toBeInTheDocument();
    expect(screen.getByText("仅作为资料名参考")).toBeInTheDocument();
  });

  it("asks for confirmation before submitting destructive-looking tasks", () => {
    const onSubmit = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderChatInput({
      input: "删除所有工作区文件",
      onSubmit,
      showPermissionModeControl: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("可能会删除或覆盖内容"),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
