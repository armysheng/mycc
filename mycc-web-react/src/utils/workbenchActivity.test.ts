import { describe, expect, it } from "vitest";
import type { AllMessage } from "../types";
import { buildWorkbenchActivitySnapshot } from "./workbenchActivity";

describe("buildWorkbenchActivitySnapshot", () => {
  it("extracts todos, tool activity, file changes, and deliverables from chat messages", () => {
    const messages: AllMessage[] = [
      {
        type: "todo",
        todos: [
          {
            content: "整理右侧进展面板",
            activeForm: "正在整理右侧进展面板",
            status: "in_progress",
          },
          {
            content: "补测试",
            activeForm: "补测试",
            status: "completed",
          },
        ],
        timestamp: 1710000000000,
      },
      {
        type: "tool",
        toolName: "Write",
        content: "Write /home/mycc/workspace/docs/report.md",
        input: {
          file_path: "/home/mycc/workspace/docs/report.md",
          content: "# 报告\n\n完成。",
        },
        timestamp: 1710000000100,
      },
      {
        type: "tool_result",
        toolName: "Write",
        content: "ok",
        summary: "1 file",
        timestamp: 1710000000200,
      },
      {
        type: "chat",
        role: "assistant",
        content: "我整理好了：[报告](/docs/report.md)",
        timestamp: 1710000000300,
      },
    ];

    const snapshot = buildWorkbenchActivitySnapshot(messages);

    expect(snapshot.todos.map((todo) => todo.text)).toEqual([
      "整理右侧进展面板",
      "补测试",
    ]);
    expect(snapshot.tools).toEqual([
      expect.objectContaining({
        label: "正在写入 report.md",
        status: "done",
      }),
    ]);
    expect(snapshot.fileChanges).toEqual([
      expect.objectContaining({
        fileName: "report.md",
        path: "/home/mycc/workspace/docs/report.md",
        kind: "created",
        status: "done",
      }),
    ]);
    expect(snapshot.deliverables).toEqual([
      expect.objectContaining({
        title: "报告",
        path: "/docs/report.md",
        kind: "document",
      }),
    ]);
  });

  it("keeps reviewable write and edit details for file changes", () => {
    const messages: AllMessage[] = [
      {
        type: "tool",
        toolName: "Write",
        content: "Write /home/mycc/workspace/docs/report.md",
        input: {
          file_path: "/home/mycc/workspace/docs/report.md",
          content: "# 报告\n\n完成。",
        },
        timestamp: 1710000000100,
      },
      {
        type: "tool_result",
        toolName: "Write",
        content: "ok",
        summary: "1 file",
        timestamp: 1710000000200,
      },
      {
        type: "tool",
        toolName: "Edit",
        content: "Edit /home/mycc/workspace/src/app.ts",
        input: {
          file_path: "/home/mycc/workspace/src/app.ts",
          old_str: "const title = '旧标题';",
          new_str: "const title = '新标题';",
        },
        timestamp: 1710000000300,
      },
      {
        type: "tool_result",
        toolName: "Edit",
        content: "ok",
        summary: "1 file",
        timestamp: 1710000000400,
      },
    ];

    const snapshot = buildWorkbenchActivitySnapshot(messages);

    expect(snapshot.fileChanges).toEqual([
      expect.objectContaining({
        fileName: "app.ts",
        previewPath: "/src/app.ts",
        reviewKind: "edit",
        diffs: [
          {
            oldText: "const title = '旧标题';",
            newText: "const title = '新标题';",
          },
        ],
      }),
      expect.objectContaining({
        fileName: "report.md",
        previewPath: "/docs/report.md",
        reviewKind: "write",
        previewContent: "# 报告\n\n完成。",
        diffs: [
          {
            oldText: "",
            newText: "# 报告\n\n完成。",
          },
        ],
      }),
    ]);
  });
});
