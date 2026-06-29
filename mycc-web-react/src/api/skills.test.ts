import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSkill,
  getSkillDebugSnapshot,
  listSkills,
  updateSkill,
  useSkill,
  type SkillActionResult,
  type SkillInstallResult,
  type SkillsListResult,
} from "./skills";

function okJson(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data }),
  };
}

function errorJson(error: string) {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ success: false, error }),
  };
}

describe("skills api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listSkills reads the stable skills list contract", async () => {
    const payload: SkillsListResult = {
      catalogAvailable: true,
      total: 1,
      skills: [
        {
          enabled: false,
          icon: "🔬",
          id: "deep-research",
          installed: false,
          installedVersion: null,
          latestVersion: "1.0.0",
          legacy: false,
          name: "深度调研",
          source: "catalog",
          status: "available",
          stats: { downloads: 7, installs: 3, updates: 1, uses: 11 },
          trigger: "/deep-research",
          upgradable: false,
          version: "1.0.0",
          description: "格式可控的研究报告生成",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(okJson(payload) as Response);

    await expect(listSkills("token-1")).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith("/api/skills", {
      headers: {
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
    });
  });

  it("installSkill returns source and Claude skills target path", async () => {
    const payload: SkillInstallResult = {
      installed: true,
      skillId: "deep-research",
      source: "catalog",
      targetPath: "/home/qa/workspace/.claude/skills/deep-research",
      version: "1.0.0",
    };
    vi.mocked(fetch).mockResolvedValue(okJson(payload) as Response);

    await expect(installSkill("token-1", "deep-research")).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith("/api/skills/deep-research/install", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  });

  it("updateSkill returns source and Claude skills target path", async () => {
    const payload: SkillActionResult = {
      skillId: "deep-research",
      source: "catalog",
      success: true,
      targetPath: "/home/qa/workspace/.claude/skills/deep-research",
      version: "1.1.0",
    };
    vi.mocked(fetch).mockResolvedValue(okJson(payload) as Response);

    await expect(updateSkill("token-1", "deep-research")).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith("/api/skills/deep-research/upgrade", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  });

  it("throws backend errors for callers to display", async () => {
    vi.mocked(fetch).mockResolvedValue(errorJson("技能不存在于目录中") as Response);

    await expect(installSkill("token-1", "missing-skill")).rejects.toThrow("技能不存在于目录中");
  });

  it("throws productized errors when backend skill errors include internal details", async () => {
    vi.mocked(fetch).mockResolvedValue(
      errorJson(
        "MyCC E2B sandbox failed for mycc_u_123 token at /home/mycc linuxUser",
      ) as Response,
    );

    let thrown: unknown;
    try {
      await installSkill("token-1", "missing-skill");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("添加技能失败，请稍后重试");
    expect((thrown as Error).message).not.toMatch(
      /MyCC|E2B|sandbox|token|mycc_u|linuxUser|\/home\/mycc/i,
    );
  });

  it("useSkill records a use event", async () => {
    const payload: SkillActionResult = {
      skillId: "deep-research",
      success: true,
    };
    vi.mocked(fetch).mockResolvedValue(okJson(payload) as Response);

    await expect(useSkill("token-1", "deep-research")).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith("/api/skills/deep-research/use", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  });

  it("getSkillDebugSnapshot reads the admin debug contract", async () => {
    const payload = {
      availableCount: 1,
      catalogAvailable: true,
      installedCount: 2,
      marketCount: 3,
      upgradableCount: 1,
      skills: [
        {
          id: "deep-research",
          name: "深度调研",
          source: "catalog",
          status: "installed",
          installed: true,
          enabled: true,
          version: "1.0.0",
          installedVersion: "1.0.0",
          latestVersion: "1.1.0",
          upgradable: true,
          stats: { downloads: 7, installs: 3, updates: 1, uses: 11 },
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(okJson(payload) as Response);

    await expect(getSkillDebugSnapshot("token-1")).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith("/api/skills/debug", {
      headers: {
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      },
    });
  });
});
