import { describe, expect, it } from "vitest";
import {
  PRODUCT_COPY,
  toProjectSpaceLabel,
  toUserFacingSkillCopy,
  toUserFacingWorkspaceCopy,
} from "./productCopy";

describe("product copy helpers", () => {
  it("maps workspace labels to project-space language", () => {
    expect(toProjectSpaceLabel("默认工作区")).toBe(
      PRODUCT_COPY.defaultProjectSpace,
    );
    expect(toProjectSpaceLabel("客户工作区")).toBe("客户项目空间");
    expect(toProjectSpaceLabel("~/workspace")).toBe(
      PRODUCT_COPY.defaultProjectSpace,
    );
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
    ).toBe("技能添加器可以在 MyCC 右侧助理浏览器里添加社区技能。");
  });

  it("maps low-level runtime terms out of skill copy", () => {
    expect(
      toUserFacingSkillCopy(
        "E2B Sandbox uses Agent SDK, code-server, GNU desktop, traffic tokens and provider sessions.",
      ),
    ).not.toMatch(/E2B|Sandbox|Agent SDK|code-server|GNU|traffic|tokens|provider|sessions/i);
  });
});
