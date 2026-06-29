import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationsPage } from "./AutomationsPage";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "token-1",
    user: {
      id: 1,
      email: "admin@example.com",
      plan: "pro",
      is_initialized: true,
    },
  }),
}));

vi.mock("./layout/Sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

describe("AutomationsPage", () => {
  const emptyAutomationsResponse = {
    ok: true,
    json: () => Promise.resolve({ success: true, data: { automations: [] } }),
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyAutomationsResponse));
  });

  it("does not expose internal health-check skill ids in the create dialog", async () => {
    render(
      <MemoryRouter>
        <AutomationsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "+ 新建自动化" }));
    fireEvent.change(screen.getByLabelText("模板"), { target: { value: "health-check" } });

    expect(screen.getByLabelText("执行入口（可选）")).toHaveValue("");
    expect(screen.queryByDisplayValue("/mycc-regression")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\/mycc-regression|mycc 后端|MyCC|CC 电脑/i);
  });

  it("hides legacy internal skill ids when existing automations are listed", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            automations: [
              {
                id: "auto-1",
                name: "系统健康巡检",
                description: "巡检核心链路并输出状态",
                status: "healthy",
                enabled: true,
                type: "interval",
                scheduleText: "每2小时",
                trigger: { type: "cron", cron: "每2小时", timezone: "Asia/Shanghai" },
                execution: {
                  type: "skill",
                  skill: "/mycc-regression",
                  prompt: "执行健康检查",
                  runCount: 0,
                  lastRunAt: null,
                  lastRunStatus: null,
                  lastError: null,
                },
                delivery: { type: "inbox", enabled: true },
              },
            ],
          },
        }),
    } as Response);

    render(
      <MemoryRouter>
        <AutomationsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("系统健康巡检")).toBeInTheDocument();
    expect(screen.getByText("执行入口: 默认执行")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\/mycc-regression|mycc 后端|MyCC|CC 电脑/i);
  });
});
