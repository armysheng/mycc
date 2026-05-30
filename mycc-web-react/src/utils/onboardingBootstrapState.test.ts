import { afterEach, describe, expect, it } from "vitest";
import {
  clearOnboardingBootstrapPendingIfInitialized,
  getOnboardingBootstrapPending,
  setOnboardingBootstrapPending,
} from "./onboardingBootstrapState";

describe("onboardingBootstrapState", () => {
  afterEach(() => {
    setOnboardingBootstrapPending(false);
  });

  it("keeps bootstrap pending while the refreshed user is still uninitialized", () => {
    setOnboardingBootstrapPending(true);

    clearOnboardingBootstrapPendingIfInitialized({ is_initialized: false });

    expect(getOnboardingBootstrapPending()).toBe(true);
  });

  it("clears bootstrap pending after the refreshed user is initialized", () => {
    setOnboardingBootstrapPending(true);

    clearOnboardingBootstrapPendingIfInitialized({ is_initialized: true });

    expect(getOnboardingBootstrapPending()).toBe(false);
  });
});
