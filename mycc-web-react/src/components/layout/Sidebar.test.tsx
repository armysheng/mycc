import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

let mockUser: {
  email?: string | null;
  phone?: string | null;
  plan?: "free" | "basic" | "pro";
  is_initialized?: boolean;
};
const mockLogout = vi.fn();

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
    user: mockUser,
    logout: mockLogout,
  }),
}));

describe("Sidebar", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    mockUser = { email: "tester@example.com", plan: "free", is_initialized: true };
    mockLogout.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses a Chinese fallback for unnamed conversations", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          conversations: [
            {
              sessionId: "session_unnamed",
              title: null,
              messageCount: 1,
              createdAt: "2026-05-31T00:00:00.000Z",
              updatedAt: "2026-05-31T00:01:00.000Z",
            },
          ],
        },
      }),
    });

    render(
      <MemoryRouter>
        <Sidebar
          onNewChat={vi.fn()}
          isOpen={false}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("未命名对话")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Untitled/i)).not.toBeInTheDocument();
  });

  it("does not expose linux user ids as product user names", async () => {
    mockUser = { plan: "free", is_initialized: true };
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: { conversations: [] },
      }),
    });

    render(
      <MemoryRouter>
        <Sidebar
          onNewChat={vi.fn()}
          isOpen={false}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(document.body.textContent).not.toContain("mycc_u");
    expect(screen.getByText("用户")).toBeInTheDocument();
  });
});
