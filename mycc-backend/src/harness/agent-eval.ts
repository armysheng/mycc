import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const agentEvalCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  initialFiles: z.array(z.object({
    path: z.string().min(1),
    content: z.string(),
  })).optional(),
  expected: z.object({
    finalResponseIncludes: z.array(z.string().min(1)).optional(),
    forbiddenText: z.array(z.string().min(1)).optional(),
    requiredToolCalls: z.array(z.string().min(1)).optional(),
    forbiddenToolCalls: z.array(z.string().min(1)).optional(),
    requiredChangedFiles: z.array(z.string().min(1)).optional(),
  }).default({}),
});

export type AgentEvalCase = z.infer<typeof agentEvalCaseSchema>;

export type AgentEvalObservedResult = {
  finalResponse: string;
  toolCalls?: Array<{ name: string; input?: unknown; output?: unknown }>;
  changedFiles?: string[];
  events?: unknown[];
};

export type AgentEvalCheckStatus = 'pass' | 'fail';

export type AgentEvalCheck = {
  id: string;
  status: AgentEvalCheckStatus;
  message: string;
};

export type AgentEvalReport = {
  ok: boolean;
  caseId: string;
  title: string;
  checks: AgentEvalCheck[];
};

export async function loadAgentEvalCase(filePath: string): Promise<AgentEvalCase> {
  const raw = await readFile(filePath, 'utf8');
  return parseAgentEvalCase(JSON.parse(raw));
}

export function parseAgentEvalCase(value: unknown): AgentEvalCase {
  return agentEvalCaseSchema.parse(value);
}

export function evaluateAgentEvalCase(
  evalCase: AgentEvalCase,
  observed: AgentEvalObservedResult,
): AgentEvalReport {
  const checks: AgentEvalCheck[] = [];
  const expected = evalCase.expected;

  for (const text of expected.finalResponseIncludes ?? []) {
    checks.push({
      id: `final-response-includes:${text}`,
      status: observed.finalResponse.includes(text) ? 'pass' : 'fail',
      message: observed.finalResponse.includes(text)
        ? `Final response includes expected text: ${text}`
        : `Final response is missing expected text: ${text}`,
    });
  }

  const combinedText = [
    observed.finalResponse,
    JSON.stringify(observed.events ?? []),
  ].join('\n');
  for (const text of expected.forbiddenText ?? []) {
    checks.push({
      id: `forbidden-text:${text}`,
      status: combinedText.includes(text) ? 'fail' : 'pass',
      message: combinedText.includes(text)
        ? `Observed result contains forbidden text: ${text}`
        : `Observed result avoids forbidden text: ${text}`,
    });
  }

  const toolNames = new Set((observed.toolCalls ?? []).map((tool) => tool.name));
  for (const toolName of expected.requiredToolCalls ?? []) {
    checks.push({
      id: `required-tool:${toolName}`,
      status: toolNames.has(toolName) ? 'pass' : 'fail',
      message: toolNames.has(toolName)
        ? `Observed required tool call: ${toolName}`
        : `Missing required tool call: ${toolName}`,
    });
  }

  for (const toolName of expected.forbiddenToolCalls ?? []) {
    checks.push({
      id: `forbidden-tool:${toolName}`,
      status: toolNames.has(toolName) ? 'fail' : 'pass',
      message: toolNames.has(toolName)
        ? `Observed forbidden tool call: ${toolName}`
        : `Did not observe forbidden tool call: ${toolName}`,
    });
  }

  const changedFiles = new Set(observed.changedFiles ?? []);
  for (const filePath of expected.requiredChangedFiles ?? []) {
    checks.push({
      id: `required-file:${filePath}`,
      status: changedFiles.has(filePath) ? 'pass' : 'fail',
      message: changedFiles.has(filePath)
        ? `Observed required changed file: ${filePath}`
        : `Missing required changed file: ${filePath}`,
    });
  }

  return {
    ok: checks.every((check) => check.status === 'pass'),
    caseId: evalCase.id,
    title: evalCase.title,
    checks,
  };
}
