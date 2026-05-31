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
        status: "pending",
        editable: false,
        description: "项目空间准备好后，会自动读取当前项目背景。",
      },
      {
        kind: "long_term_memory",
        label: "长期记忆",
        status: "managed",
        editable: false,
        description: "助理会在长期协作中沉淀偏好、事实和约定。",
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
      id: "workbench",
      label: "工作间",
      status: "available",
      description: "高级接管入口。需要深度编辑代码时再打开。",
      actionLabel: "打开工作间",
    },
  ],
};

describe("AssistantHomePanel", () => {
  it("renders an assistant-first home shell", () => {
    render(
      <AssistantHomePanel
        assistantName="小麦"
        data={baseData}
        workspaceName="mycc-main"
        inputSlot={<div data-testid="home-input-slot" />}
      />,
    );

    expect(screen.getByText("我们应该在 mycc-main 中构建什么？")).toBeInTheDocument();
    expect(screen.getByTestId("home-input-slot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开成果空间" })).toBeInTheDocument();
    expect(screen.getByText("mycc-main")).toBeInTheDocument();
    expect(screen.queryByText("最近可以继续")).not.toBeInTheDocument();
    expect(screen.queryByText("助理记忆")).not.toBeInTheDocument();
    expect(screen.queryByText("高级工作间")).not.toBeInTheDocument();
    expect(screen.queryByText("工作间")).not.toBeInTheDocument();
  });

  it("does not present unsupported durable task states", () => {
    render(<AssistantHomePanel assistantName="小麦" data={baseData} />);

    expect(screen.queryByText("最近会话")).not.toBeInTheDocument();
    expect(screen.queryByText(/blocked|completed|failed|verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
  });

  it("filters control and bootstrap conversations before rendering continuation chips", () => {
    render(
      <AssistantHomePanel
        assistantName="小麦"
        data={{
          ...baseData,
          tasks: [
            {
              id: "session_bootstrap",
              source: "conversation",
              status: "recent",
              title: "你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。",
              messageCount: 1,
              description: "最近会话，可继续让助理接着处理。",
            },
            {
              id: "session_continue",
              source: "conversation",
              status: "recent",
              title: "continue",
              messageCount: 1,
              description: "最近会话，可继续让助理接着处理。",
            },
            {
              id: "session_accept",
              source: "conversation",
              status: "recent",
              title: "accept",
              messageCount: 1,
              description: "最近会话，可继续让助理接着处理。",
            },
            {
              id: "session_init_failed",
              source: "conversation",
              status: "recent",
              title: "初始化流程执行失败：权限异常",
              messageCount: 1,
              description: "最近会话，可继续让助理接着处理。",
            },
            {
              id: "session_real_task",
              source: "conversation",
              status: "recent",
              title: "整理当前项目状态",
              messageCount: 8,
              description: "最近会话，可继续让助理接着处理。",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "继续：整理当前项目状态" })).toBeInTheDocument();
    expect(screen.queryByText(/首次初始化/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续：continue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续：accept" })).not.toBeInTheDocument();
    expect(screen.queryByText(/初始化流程执行失败/)).not.toBeInTheDocument();
  });

  it("renders derived deliverable cards with user-facing source labels", () => {
    const onOpenDeliverable = vi.fn();
    render(
      <AssistantHomePanel
        assistantName="小麦"
        onOpenDeliverable={onOpenDeliverable}
        inputSlot={<div data-testid="home-input-slot" />}
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
    expect(screen.getByText("来自当前文件空间")).toBeInTheDocument();
    expect(screen.queryByText("/docs/research-report.md")).not.toBeInTheDocument();
    expect(screen.queryByText("current_workspace")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开成果" }));
    expect(onOpenDeliverable).toHaveBeenCalledWith(expect.objectContaining({
      id: "workspace:/docs/research-report.md",
      path: "/docs/research-report.md",
    }));
  });

  it("shows a compact recent deliverables tray without taking over the new-chat surface", () => {
    render(
      <AssistantHomePanel
        assistantName="小麦"
        inputSlot={<div data-testid="home-input-slot" />}
        data={{
          ...baseData,
          deliverables: [
            {
              id: "workspace:/reports/ui-change.diff",
              kind: "diff",
              title: "UI change diff",
              source: "current_workspace",
              status: "ready",
              path: "/reports/ui-change.diff",
            },
            {
              id: "workspace:/logs/agent-run.log",
              kind: "log",
              title: "Agent run log",
              source: "current_workspace",
              status: "ready",
              path: "/logs/agent-run.log",
            },
            {
              id: "workspace:/screenshots/homepage-screenshot.png",
              kind: "screenshot",
              title: "Homepage screenshot",
              source: "current_workspace",
              status: "ready",
              path: "/screenshots/homepage-screenshot.png",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("最近成果")).toBeInTheDocument();
    expect(screen.getByText("变更说明")).toBeInTheDocument();
    expect(screen.getByText("处理记录")).toBeInTheDocument();
    expect(screen.getByText("UI change diff")).toBeInTheDocument();
    expect(screen.getByText("Agent run log")).toBeInTheDocument();
    expect(screen.getByText("Homepage screenshot")).toBeInTheDocument();
    expect(screen.queryByText("还没有制品")).not.toBeInTheDocument();
    expect(screen.queryByText("高级工作间")).not.toBeInTheDocument();
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

  it("keeps the workspace action lightweight on the new-chat surface", () => {
    const onOpenWorkspace = vi.fn();
    render(
      <AssistantHomePanel
        assistantName="小麦"
        data={baseData}
        onOpenWorkspace={onOpenWorkspace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开成果空间" }));

    expect(onOpenWorkspace).toHaveBeenCalledOnce();
  });
});
