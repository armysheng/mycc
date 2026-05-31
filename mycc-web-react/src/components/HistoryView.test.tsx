import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryView } from "./HistoryView";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

describe("HistoryView", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("keeps history-list failures product-facing without raw HTTP details", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    render(
      <MemoryRouter>
        <HistoryView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("历史记录暂时没读出来")).toBeInTheDocument();
    });
    expect(screen.queryByText(/500|Internal Server Error|Failed to load/i)).not.toBeInTheDocument();
  });
});
