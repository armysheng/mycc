import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingOverlay } from "./OnboardingOverlay";
import { getOnboardingStatus, initializeOnboarding } from "../api/auth";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
  }),
}));

vi.mock("../api/auth", () => ({
  getOnboardingStatus: vi.fn(),
  initializeOnboarding: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location">
        {location.pathname}
        {location.search}
      </div>
      <div data-testid="location-state">
        {JSON.stringify(location.state ?? null)}
      </div>
    </>
  );
}

function renderOverlay(onComplete = vi.fn(async () => undefined)) {
  render(
    <MemoryRouter initialEntries={["/projects/demo?view=history"]}>
      <Routes>
        <Route
          path="/projects/*"
          element={
            <>
              <LocationProbe />
              <OnboardingOverlay onComplete={onComplete} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onComplete };
}

describe("OnboardingOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(initializeOnboarding).mockReset();
    vi.mocked(getOnboardingStatus).mockReset();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the current project route and ignores legacy bootstrap prompts after initialization", async () => {
    vi.mocked(initializeOnboarding).mockResolvedValue({
      success: true,
      data: {
        bootstrapPrompt: "旧后端初始化提示",
      },
    });
    const { onComplete } = renderOverlay();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const skip = screen.getByRole("button", {
      name: "稍后设置，使用默认值",
    });
    expect(skip).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(skip);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(initializeOnboarding).toHaveBeenCalledWith("test-token", {
      assistantName: "道友 AI",
      ownerName: "用户",
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/demo?view=history",
    );
    expect(screen.getByTestId("location-state")).toHaveTextContent("null");
  });

  it("waits for asynchronous initialization to become ready before completing", async () => {
    vi.mocked(initializeOnboarding).mockResolvedValue({
      success: true,
      data: {
        status: "running",
        jobId: "job-1",
      },
    });
    vi.mocked(getOnboardingStatus).mockResolvedValue({
      success: true,
      data: {
        status: "ready",
      },
    });
    const { onComplete } = renderOverlay();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const skip = screen.getByRole("button", {
      name: "稍后设置，使用默认值",
    });
    await act(async () => {
      fireEvent.click(skip);
      await Promise.resolve();
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText("正在准备你的专属工作空间...")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await Promise.resolve();
    });

    expect(getOnboardingStatus).toHaveBeenCalledWith("test-token");
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("uses product copy instead of legacy assistant and owner examples", () => {
    renderOverlay();

    expect(screen.queryByText("cc")).not.toBeInTheDocument();
    expect(screen.getByText("道友 AI")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/大辉哥|老板|主人/);
  });

  it("does not display internal initialization errors", async () => {
    vi.mocked(initializeOnboarding).mockResolvedValue({
      success: false,
      error:
        "MyCC E2B sandbox failed for mycc_u_123 token at /home/mycc linuxUser",
    });
    renderOverlay();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", {
        name: "稍后设置，使用默认值",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("初始化失败，请稍后重试")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /MyCC|E2B|sandbox|token|mycc_u|linuxUser|\/home\/mycc/i,
    );
  });
});
