import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PRODUCT_COPY,
  toAssistantDisplayName,
  toProjectSpaceLabel,
  toUserFacingSkillCopy,
  toUserFacingWorkspaceCopy,
} from "./productCopy";

describe("product copy helpers", () => {
  it("uses the public 道友 AI brand in source-controlled product surfaces", () => {
    const copy = PRODUCT_COPY as Record<string, string>;
    const indexHtml = readFileSync(
      resolve(__dirname, "../../index.html"),
      "utf8",
    );

    expect(copy.brandName).toBe("道友 AI");
    expect(copy.companyName).toBe("念头通达");
    expect(copy.assistantNameFallback).toBe("道友 AI");
    expect(indexHtml).toContain("<title>道友 AI</title>");
    expect(indexHtml).toContain("念头通达");
    expect(indexHtml).not.toContain(">MyCC<");
  });

  it("maps workspace labels to project-space language", () => {
    expect(toProjectSpaceLabel("默认工作区")).toBe(
      PRODUCT_COPY.defaultProjectSpace,
    );
    expect(toProjectSpaceLabel("客户工作区")).toBe("客户项目空间");
    expect(toProjectSpaceLabel("~/workspace")).toBe(
      PRODUCT_COPY.defaultProjectSpace,
    );
  });

  it("maps legacy default assistant names to the public brand", () => {
    expect(toAssistantDisplayName()).toBe(PRODUCT_COPY.assistantNameFallback);
    expect(toAssistantDisplayName("cc")).toBe(
      PRODUCT_COPY.assistantNameFallback,
    );
    expect(toAssistantDisplayName(" MyCC ")).toBe(
      PRODUCT_COPY.assistantNameFallback,
    );
    expect(toAssistantDisplayName("小麦")).toBe("小麦");
  });

  it("keeps old harness terms out of user-facing copy", () => {
    expect(
      toUserFacingWorkspaceCopy(
        "打开工作台，启动镜像浏览器，查看运行轨迹和文件空间。",
      ),
    ).toBe("打开成果空间，启动助理浏览器，查看处理动态和项目文件。");
  });

  it("maps skill catalog copy to product-facing language", () => {
    expect(
      toUserFacingSkillCopy(
        "技能安装器可以在 MyCC 右侧 CC 电脑里安装社区技能。",
      ),
    ).toBe("技能添加器可以在 道友 AI 右侧助理浏览器里添加社区技能。");
  });

  it("maps low-level runtime terms out of skill copy", () => {
    expect(
      toUserFacingSkillCopy(
        "E2B Sandbox uses Agent SDK, code-server, GNU desktop, traffic tokens and provider sessions.",
      ),
    ).not.toMatch(
      /E2B|Sandbox|Agent SDK|code-server|GNU|traffic|tokens|provider|sessions/i,
    );
  });
});
