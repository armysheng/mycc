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
import { initializeOnboarding } from "../api/auth";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
  }),
}));

vi.mock("../api/auth", () => ({
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

  it("uses product copy instead of legacy assistant and owner examples", () => {
    renderOverlay();

    expect(screen.queryByText("cc")).not.toBeInTheDocument();
    expect(screen.getByText("道友 AI")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/大辉哥|老板|主人/);
  });
});
