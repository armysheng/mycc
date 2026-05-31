import type { AssistantDeliverableCard } from "../types";

export type DeliverableOpenTarget =
  | { kind: "navigate"; to: string }
  | { kind: "external"; url: string };

const FALLBACK_WORKSPACE_TARGET: DeliverableOpenTarget = {
  kind: "navigate",
  to: "/workspace",
};

const SECRET_URL_PATTERN = /\b(token|access_token|auth|key|secret|password|credential)\b|e2b_live_|sk-|\.e2b\.app/i;
const SECRET_PATH_PATTERN = /\b(token|secret|password|credential|private|api[-_]?key|auth)\b|^\.env$|\/\.env/i;

export function resolveDeliverableOpenTarget(deliverable: AssistantDeliverableCard): DeliverableOpenTarget {
  if (deliverable.path && isSafeWorkspacePath(deliverable.path)) {
    return {
      kind: "navigate",
      to: `/workspace?path=${encodeURIComponent(deliverable.path)}`,
    };
  }

  if (deliverable.url) {
    const urlTarget = resolveUrlTarget(deliverable.url);
    if (urlTarget) {
      return urlTarget;
    }
  }

  return FALLBACK_WORKSPACE_TARGET;
}

function isSafeWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return false;
  if (normalized.includes("\0") || normalized.includes(":")) return false;
  if (normalized.split("/").some((part) => part === ".." || part.startsWith("."))) return false;
  return !SECRET_PATH_PATTERN.test(normalized);
}

function resolveUrlTarget(rawUrl: string): DeliverableOpenTarget | null {
  if (SECRET_URL_PATTERN.test(rawUrl)) return null;

  let url: URL;
  try {
    url = new URL(rawUrl, "http://mycc.local");
  } catch {
    return null;
  }

  if (url.origin === "http://mycc.local") {
    if (url.pathname === "/workspace") {
      return {
        kind: "navigate",
        to: `${url.pathname}${url.search}${url.hash}`,
      };
    }
    return null;
  }

  if (url.protocol === "https:" || url.protocol === "http:") {
    return {
      kind: "external",
      url: url.toString(),
    };
  }

  return null;
}
