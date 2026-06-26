import type { AllMessage, ToolMessage, ToolResultMessage } from "../types";
import {
  isChatMessage,
  isTodoMessage,
  isToolMessage,
  isToolResultMessage,
} from "../types";
import { getToolActivityLabel } from "./toolDisplayMapper";

export type WorkbenchActivityStatus = "running" | "done" | "error";
export type WorkbenchTodoStatus = "pending" | "in_progress" | "completed";
export type WorkbenchFileChangeKind = "created" | "updated" | "unknown";
export type WorkbenchFileReviewKind = "write" | "edit" | "unknown";
export type WorkbenchDeliverableKind = "document" | "image" | "file";

export interface WorkbenchActivityTodo {
  id: string;
  text: string;
  status: WorkbenchTodoStatus;
}

export interface WorkbenchActivityTool {
  id: string;
  label: string;
  status: WorkbenchActivityStatus;
  timestamp: number;
  path?: string;
}

export interface WorkbenchActivityDiff {
  oldText: string;
  newText: string;
}

export interface WorkbenchActivityFileChange {
  id: string;
  fileName: string;
  path: string;
  previewPath: string;
  kind: WorkbenchFileChangeKind;
  reviewKind: WorkbenchFileReviewKind;
  status: WorkbenchActivityStatus;
  addedLines: number | null;
  removedLines: number | null;
  previewContent: string | null;
  diffs: WorkbenchActivityDiff[];
  timestamp: number;
}

export interface WorkbenchActivityDeliverable {
  id: string;
  title: string;
  path: string;
  kind: WorkbenchDeliverableKind;
  timestamp: number;
}

export interface WorkbenchActivitySnapshot {
  todos: WorkbenchActivityTodo[];
  tools: WorkbenchActivityTool[];
  fileChanges: WorkbenchActivityFileChange[];
  deliverables: WorkbenchActivityDeliverable[];
}

type ToolRecord = {
  message: ToolMessage;
  status: WorkbenchActivityStatus;
  id: string;
};

const FILE_PATH_KEYS = [
  "file_path",
  "path",
  "filePath",
  "target_file",
  "targetFile",
  "filename",
  "file",
];

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg)$/i;
const DOCUMENT_EXTENSION_PATTERN =
  /\.(md|markdown|txt|pdf|docx?|pptx?|xlsx?|csv|html?)$/i;

export function buildWorkbenchActivitySnapshot(
  messages: AllMessage[],
): WorkbenchActivitySnapshot {
  const tools: ToolRecord[] = [];
  const deliverables = new Map<string, WorkbenchActivityDeliverable>();
  let todos: WorkbenchActivityTodo[] = [];

  messages.forEach((message, index) => {
    if (isTodoMessage(message)) {
      todos = message.todos.map((todo, todoIndex) => ({
        id: `${message.timestamp}-${todoIndex}`,
        text: todo.content,
        status: todo.status,
      }));
      return;
    }

    if (isToolMessage(message)) {
      tools.push({
        id: `${message.timestamp}-${index}`,
        message,
        status: "running",
      });
      return;
    }

    if (isToolResultMessage(message)) {
      markLatestMatchingToolDone(tools, message);
      return;
    }

    if (isChatMessage(message) && message.role === "assistant") {
      for (const deliverable of extractDeliverables(message.content, message.timestamp)) {
        deliverables.set(deliverable.path, deliverable);
      }
    }
  });

  const activityTools = tools
    .slice(-12)
    .reverse()
    .map((tool) => ({
      id: tool.id,
      label: cleanActivityLabel(
        getToolActivityLabel(tool.message.toolName, tool.message.input),
      ),
      status: tool.status,
      timestamp: tool.message.timestamp,
      path: extractPath(tool.message.input) ?? undefined,
    }));

  const fileChanges = tools
    .flatMap((tool) => buildFileChange(tool))
    .slice(-12)
    .reverse();

  return {
    todos,
    tools: activityTools,
    fileChanges,
    deliverables: Array.from(deliverables.values())
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 12),
  };
}

function cleanActivityLabel(label: string): string {
  return label.replace(/\.{2,}$/u, "").trim();
}

function markLatestMatchingToolDone(
  tools: ToolRecord[],
  result: ToolResultMessage,
): void {
  const target = [...tools]
    .reverse()
    .find(
      (tool) =>
        tool.status === "running" &&
        (!result.toolName || tool.message.toolName === result.toolName),
    );
  if (!target) return;
  target.status = result.toolUseResult && isErrorLikeResult(result.toolUseResult)
    ? "error"
    : "done";
}

function isErrorLikeResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.is_error || record.error || record.stderr);
}

function buildFileChange(tool: ToolRecord): WorkbenchActivityFileChange[] {
  const input = tool.message.input;
  const path = extractPath(input);
  if (!path) return [];

  const normalizedTool = normalizeToolName(tool.message.toolName);
  const content = extractString(input, ["content", "text", "data", "value"]);
  const newText = extractRawString(input, [
    "new_str",
    "new_string",
    "new_text",
    "newStr",
    "newText",
    "replace",
  ]);
  const oldText = extractRawString(input, [
    "old_str",
    "old_string",
    "old_text",
    "oldStr",
    "oldText",
    "search",
  ]);
  const diffs = buildDiffs(input, normalizedTool, content, oldText, newText);
  const reviewKind = getReviewKind(normalizedTool);
  const diffStats = summarizeDiffs(diffs);

  return [
    {
      id: `${tool.id}:file`,
      fileName: basename(path),
      path,
      previewPath: normalizeWorkspacePath(path),
      kind:
        normalizedTool === "write" || normalizedTool === "writefile"
          ? "created"
          : normalizedTool.includes("edit")
            ? "updated"
            : "unknown",
      reviewKind,
      status: tool.status,
      addedLines: diffStats.addedLines ?? countLines(content ?? newText),
      removedLines: diffStats.removedLines ?? countLines(oldText),
      previewContent: content ?? newText ?? null,
      diffs,
      timestamp: tool.message.timestamp,
    },
  ];
}

function normalizeToolName(toolName: string | undefined): string {
  return (toolName || "").toLowerCase().replace(/[\s_]+/g, "");
}

function getReviewKind(normalizedTool: string): WorkbenchFileReviewKind {
  if (normalizedTool === "write" || normalizedTool === "writefile") {
    return "write";
  }
  if (normalizedTool.includes("edit")) return "edit";
  return "unknown";
}

function buildDiffs(
  input: Record<string, unknown> | undefined,
  normalizedTool: string,
  content: string | null,
  oldText: string | null,
  newText: string | null,
): WorkbenchActivityDiff[] {
  if (normalizedTool === "write" || normalizedTool === "writefile") {
    return content !== null ? [{ oldText: "", newText: content }] : [];
  }

  if (normalizedTool === "edit" || normalizedTool === "editfile") {
    return oldText !== null && newText !== null ? [{ oldText, newText }] : [];
  }

  if (normalizedTool !== "multiedit") return [];

  const edits = input?.edits ?? input?.changes ?? input?.operations;
  if (!Array.isArray(edits)) return [];

  return edits
    .filter(isRecord)
    .map((edit) => ({
      oldText:
        extractRawString(edit, [
          "old_str",
          "old_string",
          "old_text",
          "oldStr",
          "search",
        ]) ?? "",
      newText:
        extractRawString(edit, [
          "new_str",
          "new_string",
          "new_text",
          "newStr",
          "replace",
        ]) ?? "",
    }))
    .filter((diff) => diff.oldText || diff.newText);
}

function summarizeDiffs(
  diffs: WorkbenchActivityDiff[],
): { addedLines: number | null; removedLines: number | null } {
  if (diffs.length === 0) return { addedLines: null, removedLines: null };
  return diffs.reduce(
    (summary, diff) => ({
      addedLines: (summary.addedLines ?? 0) + (countLines(diff.newText) ?? 0),
      removedLines:
        (summary.removedLines ?? 0) + (countLines(diff.oldText) ?? 0),
    }),
    { addedLines: 0, removedLines: 0 },
  );
}

function extractDeliverables(
  content: string,
  timestamp: number,
): WorkbenchActivityDeliverable[] {
  const results: WorkbenchActivityDeliverable[] = [];
  const seen = new Set<string>();
  const markdownLinkPattern = /\[([^\]]+)\]\((file:\/\/[^)\s]+|\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkPattern.exec(content)) !== null) {
    const title = match[1]?.trim();
    const rawPath = match[2]?.trim();
    if (!rawPath) continue;
    const path = rawPath.replace(/^file:\/\//i, "");
    if (!path || seen.has(path)) continue;
    seen.add(path);
    results.push({
      id: `${timestamp}:${path}`,
      title: title || basename(path),
      path,
      kind: inferDeliverableKind(path),
      timestamp,
    });
  }

  return results;
}

function inferDeliverableKind(path: string): WorkbenchDeliverableKind {
  if (IMAGE_EXTENSION_PATTERN.test(path)) return "image";
  if (DOCUMENT_EXTENSION_PATTERN.test(path)) return "document";
  return "file";
}

function extractPath(input?: Record<string, unknown>): string | null {
  const direct = extractString(input, FILE_PATH_KEYS);
  if (direct) return direct;
  if (!input) return null;

  for (const value of Object.values(input)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (
      trimmed.startsWith("/") ||
      trimmed.startsWith("./") ||
      /^[\w.-]+\/[\w./-]+$/.test(trimmed)
    ) {
      return trimmed;
    }
  }
  return null;
}

function extractString(
  input: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!input) return null;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractRawString(
  input: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!input) return null;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkspacePath(path: string): string {
  const cleanPath = path.replace(/^file:\/\//i, "");
  const workspaceMarker = "/workspace";
  const markerIndex = cleanPath.lastIndexOf(`${workspaceMarker}/`);
  if (markerIndex >= 0) {
    return cleanPath.slice(markerIndex + workspaceMarker.length);
  }
  if (cleanPath.endsWith(workspaceMarker)) return "/";
  if (cleanPath.startsWith("./")) return `/${cleanPath.slice(2)}`;
  if (!cleanPath.startsWith("/")) return `/${cleanPath}`;
  return cleanPath;
}

function countLines(value: string | null): number | null {
  if (!value) return null;
  return value.split("\n").length;
}

function basename(path: string): string {
  const clean = path.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return decodeURIComponent(clean.split("/").pop() || clean || path);
}
