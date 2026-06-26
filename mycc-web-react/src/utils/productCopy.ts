export const PRODUCT_COPY = {
  brandName: "MyCC",
  assistantNameFallback: "cc",
  resultsSpace: "成果空间",
  assistantBrowser: "助理浏览器",
  processingActivity: "处理动态",
  projectFiles: "项目文件",
  projectSpace: "项目空间",
  defaultProjectSpace: "默认项目空间",
  assistantSkillLibrary: "助理技能库",
  availableSkills: "技能市场",
  enabledSkills: "我的技能",
} as const;

export function toProjectSpaceLabel(label?: string | null): string {
  if (!label) return "";
  const trimmed = label.trim();
  if (!trimmed || trimmed === "workspace" || trimmed === "~/workspace") {
    return PRODUCT_COPY.defaultProjectSpace;
  }
  return trimmed
    .replace(/默认工作区/g, PRODUCT_COPY.defaultProjectSpace)
    .replace(/工作区/g, PRODUCT_COPY.projectSpace);
}

export function toUserFacingWorkspaceCopy(message: string): string {
  return message
    .replace(/默认工作区/g, PRODUCT_COPY.defaultProjectSpace)
    .replace(/右侧工作区/g, PRODUCT_COPY.resultsSpace)
    .replace(/文件空间/g, PRODUCT_COPY.projectFiles)
    .replace(/当前工作区/g, `当前${PRODUCT_COPY.projectFiles}`)
    .replace(/工作区/g, PRODUCT_COPY.projectSpace)
    .replace(/工作台/g, PRODUCT_COPY.resultsSpace)
    .replace(/镜像浏览器/g, PRODUCT_COPY.assistantBrowser)
    .replace(/运行轨迹/g, PRODUCT_COPY.processingActivity);
}

export function toUserFacingSkillCopy(message: string): string {
  return toUserFacingWorkspaceCopy(message)
    .replace(/\bE2B\b/gi, PRODUCT_COPY.projectFiles)
    .replace(/\bAgent SDK\b/gi, "助理能力")
    .replace(/\bcode-server\b/gi, "编辑器")
    .replace(/\bGNU\b/gi, "助理桌面")
    .replace(/\bRemote IDE\b/gi, "云端编辑器")
    .replace(/\bClaude Code\b/gi, "助理能力")
    .replace(/\bbase url\b/gi, "服务地址")
    .replace(/\btraffic\b/gi, "访问")
    .replace(/\bprovider\b/gi, "服务")
    .replace(/\bsandbox\b/gi, PRODUCT_COPY.projectSpace)
    .replace(/\bsessions?\b/gi, "任务")
    .replace(/\btokens?\b/gi, "凭据")
    .replace(/沙盒/g, PRODUCT_COPY.projectSpace)
    .replace(/右侧\s*CC\s*电脑/g, `右侧${PRODUCT_COPY.assistantBrowser}`)
    .replace(/CC\s*电脑/g, PRODUCT_COPY.assistantBrowser)
    .replace(/技能安装器/g, "技能添加器")
    .replace(/安装社区技能/g, "添加社区技能")
    .replace(/安装技能/g, "添加技能")
    .replace(/从策展仓库安装/g, "从策展仓库添加");
}
