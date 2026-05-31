import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
