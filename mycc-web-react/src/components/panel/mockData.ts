import type { AutomationItem, SkillItem } from "../../types/toolbox";

export const MOCK_SKILLS: SkillItem[] = [
  {
    id: "regression-check",
    name: "回归验证",
    icon: "RG",
    trigger: "@regression",
    description: "执行健康检查、登录、鉴权和聊天链路验证。",
    installed: true,
    status: "installed",
  },
  {
    id: "deploy-cloudflare",
    name: "Cloudflare 部署",
    icon: "CF",
    trigger: "@deploy",
    description: "发布 Web 前端与 Worker 到 Cloudflare。",
    installed: false,
    status: "available",
  },
  {
    id: "pr-comment-bot",
    name: "PR 评论处理",
    icon: "PR",
    trigger: "@comments",
    description: "批量解析并处理 PR review 评论。",
    installed: false,
    status: "disabled",
  },
];

export const MOCK_AUTOMATIONS: AutomationItem[] = [
  {
    id: "daily-regression",
    name: "每日回归冒烟",
    scheduleText: "每天 09:00",
    status: "healthy",
    enabled: true,
  },
  {
    id: "nightly-build",
    name: "夜间构建校验",
    scheduleText: "每天 02:30",
    status: "paused",
    enabled: false,
  },
  {
    id: "api-health-check",
    name: "后端健康巡检",
    scheduleText: "每 2 小时",
    status: "error",
    enabled: true,
  },
];
