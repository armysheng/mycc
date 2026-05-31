import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionInputPanel } from "./PermissionInputPanel";

describe("PermissionInputPanel", () => {
  const renderPanel = (patterns: string[] = ["Bash(npm test:*)"]) => {
    const handlers = {
      onAllow: vi.fn(),
      onAllowPermanent: vi.fn(),
      onDeny: vi.fn(),
    };

    const view = render(<PermissionInputPanel patterns={patterns} {...handlers} />);
    return { ...handlers, ...view };
  };

  it("shows personal-assistant copy for a local action request", () => {
    const { container } = renderPanel();

    expect(screen.getByText("需要确认一个本地操作")).toBeInTheDocument();
    expect(screen.getByText("助理需要在本机执行一个操作来继续。")).toBeInTheDocument();
    expect(screen.getByText("本次允许")).toBeInTheDocument();
    expect(screen.getByText("始终允许这类操作")).toBeInTheDocument();
    expect(screen.getByText("不允许")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(
      /Claude|Bash|command|命令|批准|执行权限|API Key|CWD|Permission Mode|Tokens|Cost|Session|Tools/,
    );
  });

  it("keeps permission callbacks wired to the productized buttons", () => {
    const { onAllow, onAllowPermanent, onDeny } = renderPanel();

    fireEvent.click(screen.getByText("本次允许"));
    fireEvent.click(screen.getByText("始终允许这类操作"));
    fireEvent.click(screen.getByText("不允许"));

    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onAllowPermanent).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});
