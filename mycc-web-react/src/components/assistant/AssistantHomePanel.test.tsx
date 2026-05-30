import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssistantHomeData } from "../../types";
import { AssistantHomePanel } from "./AssistantHomePanel";

const baseData: AssistantHomeData = {
  assistant: {
    name: "小麦",
    initialized: true,
  },
  tasks: [
    {
      id: "session_abc",
      source: "conversation",
      status: "recent",
      title: "调研 Claude Code UI",
      messageCount: 6,
      description: "最近会话，可继续让助理接着处理。",
    },
  ],
  deliverables: [],
  deliverableEmptyState: {
    title: "还没有制品",
    description: "助理产出的报告、文件、预览、PR 和日志会在这里出现。",
  },
  memory: {
    sources: [
      {
        kind: "profile",
        label: "个人偏好",
        status: "available",
        editable: true,
        description: "助理名：小麦",
      },
      {
        kind: "project_context",
        label: "项目背景",
        status: "available_when_workspace_running",
        editable: false,
        description: "来自当前活跃工作区的项目背景。",
      },
      {
        kind: "runtime_memory",
        label: "长期记忆",
        status: "managed_by_runtime",
        editable: false,
        description: "助理在长期协作中积累的偏好、事实和约定。",
      },
    ],
  },
  workspace: {
    status: "running",
    label: "当前活跃工作区",
    description: "这个工作区由当前用户的助理编码任务共享。",
  },
  capabilities: [
    {
      id: "code-server",
      label: "代码编辑器",
      status: "running",
      description: "高级接管入口。需要深度编辑代码时再打开。",
      actionLabel: "打开代码编辑器",
    },
  ],
};

describe("AssistantHomePanel", () => {
  it("renders an assistant-first home shell", () => {
    render(<AssistantHomePanel assistantName="小麦" data={baseData} />);

    expect(screen.getByText("今天要我帮你做什么？")).toBeInTheDocument();
    expect(screen.getByText("最近可以继续")).toBeInTheDocument();
    expect(screen.getByText("调研 Claude Code UI")).toBeInTheDocument();
    expect(screen.getByText("最近制品")).toBeInTheDocument();
    expect(screen.getByText("还没有制品")).toBeInTheDocument();
    expect(screen.getByText("助理记忆")).toBeInTheDocument();
    expect(screen.getByText("个人偏好")).toBeInTheDocument();
    expect(screen.getByText("项目背景")).toBeInTheDocument();
    expect(screen.getByText("长期记忆")).toBeInTheDocument();
    expect(screen.getByText("高级工作间")).toBeInTheDocument();
    expect(screen.getByText("代码编辑器")).toBeInTheDocument();
  });

  it("does not present unsupported durable task states", () => {
    render(<AssistantHomePanel assistantName="小麦" data={baseData} />);

    expect(screen.getByText("最近会话")).toBeInTheDocument();
    expect(screen.queryByText(/blocked|completed|failed|verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
  });

  it("renders derived deliverable cards with user-facing source labels", () => {
    render(
      <AssistantHomePanel
        assistantName="小麦"
        data={{
          ...baseData,
          deliverables: [
            {
              id: "workspace:/docs/research-report.md",
              kind: "report",
              title: "Claude UI 调研报告",
              source: "current_workspace",
              status: "ready",
              description: "2 KB · 来自当前工作区",
              path: "/docs/research-report.md",
              updatedAt: "2026-05-30T10:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Claude UI 调研报告")).toBeInTheDocument();
    expect(screen.getByText("报告")).toBeInTheDocument();
    expect(screen.getByText("来自当前工作区")).toBeInTheDocument();
    expect(screen.getByText("/docs/research-report.md")).toBeInTheDocument();
    expect(screen.queryByText("current_workspace")).not.toBeInTheDocument();
  });

  it("does not render raw launch URLs or secret-like provider fields", () => {
    const unsafeData = ({
      ...baseData,
      capabilities: [
        {
          ...baseData.capabilities[0],
          openPath: "/api/ide/sessions/ide_123/open?token=proxy-token-secret",
          sandboxId: "sbx_secret_123",
          host: "18080-sbx-secret.e2b.app",
          trafficAccessToken: "e2b_live_secret_123456",
          providerUrl: "https://provider.example.com/secret-route",
        },
      ],
    } as unknown) as AssistantHomeData;

    render(<AssistantHomePanel assistantName="小麦" data={unsafeData} />);

    expect(screen.queryByText(/proxy-token-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sbx_secret_123/)).not.toBeInTheDocument();
    expect(screen.queryByText(/e2b\.app/)).not.toBeInTheDocument();
    expect(screen.queryByText(/e2b_live_secret_123456/)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider\.example\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\be2b\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bsandbox\b/i)).not.toBeInTheDocument();
  });

  it("uses suggested prompts without sending immediately", () => {
    const onStartPrompt = vi.fn();
    render(
      <AssistantHomePanel
        assistantName="小麦"
        data={baseData}
        onStartPrompt={onStartPrompt}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "整理一下当前项目状态" }));

    expect(onStartPrompt).toHaveBeenCalledWith("整理一下当前项目状态");
  });
});
