import { test, expect, type Page, type Route } from "@playwright/test";

const E2E_USER = {
  id: 9101,
  email: "skills-detail@example.test",
  assistant_name: "cc",
  linux_user: "qa",
  plan: "pro",
  is_initialized: true,
};

const skill = {
  id: "browser-use",
  name: "可见浏览器自动化",
  description: "在 MyCC 右侧 CC 电脑里打开、检查、登录和自动操作网页",
  trigger: "/browser-use",
  triggers: ["/browser-use", "访问网站", "可见浏览器"],
  icon: "🌐",
  status: "installed",
  installed: true,
  version: "1.0.0",
  installedVersion: "1.0.0",
  latestVersion: "1.1.0",
  source: "catalog",
  legacy: false,
  enabled: true,
  upgradable: true,
  category: "builtin",
  owner: "system",
  preloadInImage: true,
  imageRequired: true,
  stats: { downloads: 4, installs: 3, updates: 1, uses: 9 },
};

const availableSkill = {
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
  source: "registry",
  legacy: false,
  enabled: false,
  upgradable: false,
  category: "builtin",
  owner: "system",
  preloadInImage: true,
  imageRequired: false,
  stats: { downloads: 12, installs: 5, updates: 0, uses: 20 },
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function bootstrapSkillsPage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("token", "e2e-token");
  });

  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, { success: true, data: E2E_USER }),
  );
  await page.route("**/api/skills/browser-use/detail", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        skill,
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
      },
    }),
  );
  await page.route("**/api/skills", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        catalogAvailable: true,
        installRootPath: "/home/mycc/.claude/skills",
        total: 1,
        skills: [skill],
      },
    }),
  );

  await page.goto("/skills");
  await expect(page.getByRole("heading", { name: "技能市场" })).toBeVisible();
  await expect(page.getByText("助理技能库/{skillName}")).toBeVisible();
}

test("[SKILLS-DETAIL-001] 技能详情页展示头卡、tabs、内容预览和权限信息", async ({
  page,
}) => {
  await bootstrapSkillsPage(page);

  await page
    .getByRole("button", { name: "查看 可见浏览器自动化 详情" })
    .click();

  await expect(page.getByText("返回助理技能库")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "可见浏览器自动化" }),
  ).toBeVisible();
  await expect(page.getByText("能帮你完成")).toBeVisible();
  await expect(page.getByText("推荐试用")).toBeVisible();
  await expect(page.getByText("助理技能库/browser-use")).toBeVisible();

  await page.getByRole("button", { name: "技能内容" }).click();

  await expect(page.getByText("browser-use/SKILL.md")).toBeVisible();
  await expect(page.getByText(/Browser Use In MyCC Sandbox/)).toBeVisible();

  await page.getByRole("button", { name: "权限管理" }).click();

  await expect(page.getByText("运行依赖")).toBeVisible();
  await expect(page.getByText("playwright, chromium")).toBeVisible();
});

test("[SKILLS-FALLBACK-001] 运行环境未就绪时市场可浏览但添加不可提交", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("token", "e2e-token");
  });

  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, { success: true, data: E2E_USER }),
  );
  await page.route("**/api/skills", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        catalogAvailable: false,
        total: 1,
        skills: [availableSkill],
      },
    }),
  );

  await page.goto("/skills");

  await expect(page.getByText("技能运行环境未就绪")).toBeVisible();
  await expect(page.getByText("PDF 工具")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "等待环境，暂不能添加 PDF 工具" }),
  ).toBeDisabled();
});
