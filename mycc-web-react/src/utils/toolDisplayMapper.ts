/**
 * 将 tool_use 的工具名映射为用户友好的描述
 */
const TOOL_DISPLAY_MAP: Record<string, string> = {
  Read: "正在读取文件...",
  Write: "正在写入文件...",
  Edit: "正在编辑文件...",
  Bash: "正在执行命令...",
  Grep: "正在搜索代码...",
  Glob: "正在查找文件...",
  WebFetch: "正在获取网页内容...",
  WebSearch: "正在搜索网络...",
  Task: "正在处理子任务...",
  TodoWrite: "正在更新任务列表...",
  EnterPlanMode: "正在制定计划...",
  ExitPlanMode: "计划制定完成",
  AskUserQuestion: "需要你的确认...",
  NotebookEdit: "正在编辑笔记...",
  Skill: "正在使用技能...",
};

export function getToolDisplayText(
  toolName: string,
  input?: Record<string, unknown>,
): string {
  // 特殊处理：带文件名的工具
  if (
    (toolName === "Read" || toolName === "Edit" || toolName === "Write") &&
    typeof input?.file_path === "string"
  ) {
    const fileName = input.file_path.split("/").pop();
    const verb = toolName === "Read" ? "读取" : toolName === "Edit" ? "编辑" : "写入";
    return `正在${verb} ${fileName}...`;
  }
  if (toolName === "Bash" && typeof input?.command === "string") {
    const cmd = input.command.split(" ")[0];
    return `正在执行 ${cmd}...`;
  }
  if (toolName === "Grep" && input?.pattern) {
    return `正在搜索 "${input.pattern}"...`;
  }
  if (toolName === "Glob" && input?.pattern) {
    return `正在查找 ${input.pattern}...`;
  }
  if (toolName === "Task" && input?.description) {
    return `正在处理: ${input.description}`;
  }

  return TOOL_DISPLAY_MAP[toolName] || `正在使用 ${toolName}...`;
}
