import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsPage } from "./SkillsPage";
import {
  getSkillDebugSnapshot,
  getSkillDetail,
  installSkill,
  listSkills,
  useSkill,
  type SkillDetailResult,
  type SkillDebugSnapshot,
  type SkillInstallResult,
  type SkillsListResult,
} from "../api/skills";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "token-1",
    user: {
      id: 1,
      email: "admin@example.com",
      linux_user: "qa",
      plan: "pro",
      is_initialized: true,
    },
  }),
}));

vi.mock("./layout/Sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock("../api/skills", async () => {
  const actual =
    await vi.importActual<typeof import("../api/skills")>("../api/skills");
  return {
    ...actual,
    listSkills: vi.fn(),
    getSkillDebugSnapshot: vi.fn(),
    getSkillDetail: vi.fn(),
    installSkill: vi.fn(),
    useSkill: vi.fn(),
  };
});

const listPayload: SkillsListResult = {
  catalogAvailable: true,
  total: 1,
  skills: [
    {
      id: "browser-use",
      name: "可见浏览器自动化",
      description: "在 MyCC 右侧 CC 电脑里打开、检查、登录和自动操作网页",
      trigger: "/browser-use",
      triggers: ["/browser-use", "访问网站"],
      icon: "🌐",
      status: "installed",
      installed: true,
      version: "1.0.0",
      installedVersion: "1.0.0",
      latestVersion: "1.0.0",
      source: "catalog",
      legacy: false,
      enabled: true,
      upgradable: false,
      category: "builtin",
      owner: "system",
      stats: { downloads: 4, installs: 3, updates: 1, uses: 9 },
    },
  ],
};

const debugPayload: SkillDebugSnapshot = {
  catalogAvailable: true,
  marketCount: 2,
  installedCount: 1,
  availableCount: 1,
  upgradableCount: 0,
  imagePreloadCount: 1,
  imageRequiredCount: 1,
  skills: [
    {
      id: "browser-use",
      name: "可见浏览器自动化",
      triggers: ["/browser-use", "访问网站"],
      source: "catalog",
      status: "installed",
      installed: true,
      enabled: true,
      version: "1.0.0",
      installedVersion: "1.0.0",
      latestVersion: "1.0.0",
      upgradable: false,
      preloadInImage: true,
      imageRequired: true,
      stats: { downloads: 4, installs: 3, updates: 1, uses: 9 },
    },
  ],
};

const detailPayload: SkillDetailResult = {
  skill: {
    ...listPayload.skills[0],
    preloadInImage: true,
    imageRequired: true,
  },
  installTargetPath: "/home/qa/.claude/skills/browser-use",
  definition: {
    builtin: true,
    readiness: "L1",
    riskLevel: "low",
    deps: ["playwright", "chromium"],
    defaultEnabled: true,
    mdPath: "browser-use/SKILL.md",
    sourceUrl: "",
    originType: "internal-verified",
    validationNote: "可见浏览器运行方式已验证",
    lastVerifiedAt: "2026-06-02",
  },
  contentPreview: {
    source: "catalog",
    path: "browser-use/SKILL.md",
    content: "# Browser Use In MyCC Sandbox\n\nVisible browser CDP",
    truncated: false,
  },
};

const marketplacePayload: SkillsListResult = {
  catalogAvailable: true,
  installRootPath: "/home/mycc/.claude/skills",
  total: 3,
  skills: [
    {
      ...listPayload.skills[0],
      installed: true,
      status: "installed",
    },
    {
      id: "pdf",
      name: "PDF 工具",
      description: "PDF 文档读取、提取、摘要与转换",
      trigger: "/pdf",
      triggers: ["/pdf", "PDF", "读取PDF"],
      icon: "📄",
      status: "available",
      installed: false,
      version: "1.0.0",
      installedVersion: null,
      latestVersion: "1.0.0",
      source: "catalog",
      legacy: false,
      enabled: false,
      upgradable: false,
      category: "builtin",
      owner: "system",
      preloadInImage: true,
      imageRequired: false,
      stats: { downloads: 12, installs: 5, updates: 0, uses: 20 },
    },
    {
      id: "data-analysis",
      name: "数据分析",
      description: "CSV/表格数据分析 + 可视化",
      trigger: "/data-analysis",
      triggers: ["/data-analysis", "数据分析"],
      icon: "📉",
      status: "available",
      installed: false,
      version: "1.0.0",
      installedVersion: null,
      latestVersion: "1.0.0",
      source: "catalog",
      legacy: false,
      enabled: false,
      upgradable: false,
      category: "research",
      owner: "system",
      stats: { downloads: 8, installs: 4, updates: 0, uses: 16 },
    },
  ],
};

const installedOnlyPayload: SkillsListResult = {
  catalogAvailable: true,
  total: 1,
  skills: [
    {
      ...listPayload.skills[0],
      installed: true,
      status: "installed",
    },
  ],
};

describe("SkillsPage", () => {
  beforeEach(() => {
    vi.mocked(listSkills).mockResolvedValue(listPayload);
    vi.mocked(getSkillDebugSnapshot).mockResolvedValue(debugPayload);
    vi.mocked(getSkillDetail).mockResolvedValue(detailPayload);
    vi.mocked(installSkill).mockResolvedValue({
      skillId: "pdf",
      installed: true,
      version: "1.0.0",
      source: "catalog",
      targetPath: "/home/qa/.claude/skills/pdf",
    } satisfies SkillInstallResult);
    vi.mocked(useSkill).mockResolvedValue({
      skillId: "pdf",
      success: true,
    });
  });

  it("opens a skill debug center from the skills page", async () => {
    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    expect(
      (await screen.findAllByText("可见浏览器自动化")).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "技能调试" }));

    await waitFor(() =>
      expect(getSkillDebugSnapshot).toHaveBeenCalledWith("token-1"),
    );
    expect(await screen.findByText("技能调试中心")).toBeInTheDocument();
    expect(screen.getByText("Catalog 可用")).toBeInTheDocument();
    expect(screen.getByText("已启用 1")).toBeInTheDocument();
    expect(screen.getByText("可更新 0")).toBeInTheDocument();
    expect(screen.getByText("预置可用 1")).toBeInTheDocument();
    expect(screen.getByText("专用环境 1")).toBeInTheDocument();
    expect(screen.getByText("预置可用")).toBeInTheDocument();
    expect(screen.getByText("专用环境")).toBeInTheDocument();
    expect(screen.getAllByText("访问网站").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/使用\s*9/).length).toBeGreaterThan(0);
  });

  it("separates the marketplace from installed skills with contextual actions", async () => {
    vi.mocked(listSkills).mockResolvedValue(marketplacePayload);

    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "技能市场" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我的技能" })).toBeInTheDocument();
    expect(screen.getByText("可见浏览器自动化")).toBeInTheDocument();
    expect(
      screen.getByText(
        "在 MyCC 右侧助理浏览器里打开、检查、登录和自动操作网页",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/CC 电脑/)).not.toBeInTheDocument();
    expect(screen.getByText("PDF 工具")).toBeInTheDocument();
    expect(screen.getAllByText("作者 MyCC").length).toBeGreaterThan(0);
    expect(screen.getAllByText("内置").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/可完成/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/试试/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "已启用 可见浏览器自动化" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /添加 PDF 工具/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "我的技能" }));

    expect(
      await screen.findByRole("heading", { name: "我的技能" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "立即使用 可见浏览器自动化" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "移除 可见浏览器自动化" }),
    ).toBeInTheDocument();
  });

  it("keeps the market separate and shows capability overview in installed skills", async () => {
    vi.mocked(listSkills).mockResolvedValue(installedOnlyPayload);

    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    expect(
      (await screen.findAllByText("可见浏览器自动化")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("没有匹配的可添加技能")).not.toBeInTheDocument();
    expect(screen.queryByText("已拥有的能力")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "我的技能" }));

    expect(screen.getByText("已拥有的能力")).toBeInTheDocument();
    expect(screen.getByText(/你的助理已经能处理这些任务/)).toBeInTheDocument();
    expect(screen.getAllByText(/试试/).length).toBeGreaterThan(0);
  });

  it("keeps the marketplace browsable when the runtime catalog falls back", async () => {
    vi.mocked(listSkills).mockResolvedValue({
      ...marketplacePayload,
      catalogAvailable: false,
    });

    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("技能运行环境未就绪")).toBeInTheDocument();
    expect(
      screen.getByText(/可以先浏览技能说明；添加、更新和移除会在运行环境恢复后可用/),
    ).toBeInTheDocument();
    expect(screen.getByText("添加位置")).toBeInTheDocument();
    expect(screen.getByText("助理技能库/{skillName}")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/home/mycc");
    expect(screen.getByText("PDF 工具")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "等待环境，暂不能添加 PDF 工具",
      }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "等待环境，暂不能添加 PDF 工具",
      }),
    );

    expect(installSkill).not.toHaveBeenCalled();
  });

  it("disables installed skill write actions while the runtime is unavailable", async () => {
    vi.mocked(listSkills).mockResolvedValue({
      ...installedOnlyPayload,
      catalogAvailable: false,
      skills: [
        {
          ...installedOnlyPayload.skills[0],
          upgradable: true,
          latestVersion: "1.1.0",
        },
      ],
    });

    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "我的技能" }));

    expect(
      screen.getByRole("button", {
        name: "等待环境，暂不能更新 可见浏览器自动化",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "等待环境，暂不能移除 可见浏览器自动化",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "立即使用 可见浏览器自动化" }),
    ).toBeEnabled();
  });

  it("disables detail install actions while the runtime catalog is unavailable", async () => {
    vi.mocked(listSkills).mockResolvedValue({
      ...marketplacePayload,
      catalogAvailable: false,
    });
    vi.mocked(getSkillDetail).mockResolvedValue({
      ...detailPayload,
      skill: marketplacePayload.skills[1],
      installTargetPath: "/home/qa/.claude/skills/pdf",
    });

    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "查看 PDF 工具 详情" }));

    expect(await screen.findByText("技能运行环境未就绪")).toBeInTheDocument();
    expect(screen.getByText(/当前可以查看技能说明/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "等待环境，暂不能添加 PDF 工具" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/当前只能浏览说明，运行环境恢复后会添加到助理技能库/),
    ).toBeInTheDocument();
  });

  it("offers an immediate trial after installing a skill", async () => {
    vi.mocked(listSkills)
      .mockResolvedValueOnce(marketplacePayload)
      .mockResolvedValueOnce({
        ...marketplacePayload,
        skills: marketplacePayload.skills.map((skill) =>
          skill.id === "pdf"
            ? {
                ...skill,
                installed: true,
                status: "installed",
                installedVersion: "1.0.0",
                enabled: true,
              }
            : skill,
        ),
      });

    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /添加 PDF 工具/ }));

    await waitFor(() =>
      expect(installSkill).toHaveBeenCalledWith("token-1", "pdf"),
    );
    expect(await screen.findByText(/已添加 PDF 工具/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "立即试用 PDF 工具" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "立即试用 PDF 工具" }));

    await waitFor(() => expect(useSkill).toHaveBeenCalledWith("token-1", "pdf"));
  });

  it("opens a reference-style skill detail page with tabs and content preview", async () => {
    render(
      <MemoryRouter>
        <SkillsPage />
      </MemoryRouter>,
    );

    expect(
      (await screen.findAllByText("可见浏览器自动化")).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "查看 可见浏览器自动化 详情" }),
    );

    await waitFor(() =>
      expect(getSkillDetail).toHaveBeenCalledWith("token-1", "browser-use"),
    );
    expect(await screen.findByText("返回助理技能库")).toBeInTheDocument();
    expect(screen.getByText("能帮你完成")).toBeInTheDocument();
    expect(screen.getByText("上手路径")).toBeInTheDocument();
    expect(screen.getByText(/试试/)).toBeInTheDocument();
    expect(screen.getByText("添加位置")).toBeInTheDocument();
    expect(screen.getByText("助理技能库/browser-use")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/home/qa");
    expect(
      screen.getByRole("button", { name: "技能内容" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "权限管理" }));

    expect(screen.getByText("运行依赖")).toBeInTheDocument();
    expect(screen.getByText("playwright, chromium")).toBeInTheDocument();
  });
});
