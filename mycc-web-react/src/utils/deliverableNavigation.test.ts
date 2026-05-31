import { describe, expect, it } from "vitest";
import type { AssistantDeliverableCard } from "../types";
import { resolveDeliverableOpenTarget } from "./deliverableNavigation";

function deliverable(overrides: Partial<AssistantDeliverableCard>): AssistantDeliverableCard {
  return {
    id: "workspace:/reports/product-roadmap.md",
    kind: "report",
    title: "产品路线报告",
    source: "current_workspace",
    status: "ready",
    ...overrides,
  };
}

describe("resolveDeliverableOpenTarget", () => {
  it("opens workspace file deliverables through the product workspace route", () => {
    expect(resolveDeliverableOpenTarget(deliverable({
      path: "/reports/product-roadmap.md",
    }))).toEqual({
      kind: "navigate",
      to: "/workspace?path=%2Freports%2Fproduct-roadmap.md",
    });
  });

  it("preserves safe workspace URLs provided by the assistant API", () => {
    expect(resolveDeliverableOpenTarget(deliverable({
      path: undefined,
      url: "/workspace?path=%2Freports%2Fproduct-roadmap.md&source=home",
    }))).toEqual({
      kind: "navigate",
      to: "/workspace?path=%2Freports%2Fproduct-roadmap.md&source=home",
    });
  });

  it("opens safe link deliverables externally without converting them into files", () => {
    expect(resolveDeliverableOpenTarget(deliverable({
      kind: "link",
      source: "current_conversation",
      path: undefined,
      url: "https://example.com/research",
    }))).toEqual({
      kind: "external",
      url: "https://example.com/research",
    });
  });

  it("falls back to the workspace for provider hosts, tokens, and unsafe paths", () => {
    expect(resolveDeliverableOpenTarget(deliverable({
      path: "/../.env",
      url: "https://18080-sbx-secret.e2b.app/?token=e2b_live_secret_123456",
    }))).toEqual({
      kind: "navigate",
      to: "/workspace",
    });
  });

  it("does not deep-link deliverables that are not ready", () => {
    expect(resolveDeliverableOpenTarget(deliverable({
      status: "pending",
      path: "/reports/product-roadmap.md",
      url: "/workspace?path=%2Freports%2Fproduct-roadmap.md&source=home",
    }))).toEqual({
      kind: "navigate",
      to: "/workspace",
    });

    expect(resolveDeliverableOpenTarget(deliverable({
      status: "error",
      path: "/reports/product-roadmap.md",
      url: "https://example.com/research",
    }))).toEqual({
      kind: "navigate",
      to: "/workspace",
    });
  });
});
