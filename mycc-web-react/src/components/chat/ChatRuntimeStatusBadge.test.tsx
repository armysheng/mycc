import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRuntimeStatusBadge } from "./ChatRuntimeStatusBadge";

describe("ChatRuntimeStatusBadge", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps runtime diagnostics out of the product UI", () => {
    const { container } = render(<ChatRuntimeStatusBadge token="test-token" />);

    expect(fetch).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("工作区需要确认")).not.toBeInTheDocument();
    expect(screen.queryByText(/E2B|CCR|Agent SDK|code-server|GNU|sandbox|沙盒/)).not.toBeInTheDocument();
    expect(screen.queryByText(/doctor:e2b-agent/)).not.toBeInTheDocument();
  });
});
