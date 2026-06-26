import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORBIDDEN_PRODUCT_TERMS } from "../../test/productSurface";
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
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
    expect(screen.queryByText(/doctor:e2b-agent/)).not.toBeInTheDocument();
  });
});
