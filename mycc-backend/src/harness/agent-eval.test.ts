import { describe, expect, it } from 'vitest';
import {
  evaluateAgentEvalCase,
  parseAgentEvalCase,
} from './agent-eval.js';

describe('agent eval harness', () => {
  it('parses a minimal eval case', () => {
    const evalCase = parseAgentEvalCase({
      id: 'chat-basic',
      title: 'Basic chat',
      prompt: 'Say hello',
      expected: {
        finalResponseIncludes: ['hello'],
      },
    });

    expect(evalCase).toEqual({
      id: 'chat-basic',
      title: 'Basic chat',
      prompt: 'Say hello',
      expected: {
        finalResponseIncludes: ['hello'],
      },
    });
  });

  it('evaluates final response, tools, forbidden text, and changed files', () => {
    const evalCase = parseAgentEvalCase({
      id: 'workspace-edit',
      title: 'Workspace edit',
      prompt: 'Create a plan',
      expected: {
        finalResponseIncludes: ['完成'],
        forbiddenText: ['secret-token'],
        requiredToolCalls: ['Write'],
        forbiddenToolCalls: ['Bash'],
        requiredChangedFiles: ['/plan.md'],
      },
    });

    const report = evaluateAgentEvalCase(evalCase, {
      finalResponse: '已完成计划',
      toolCalls: [{ name: 'Write' }],
      changedFiles: ['/plan.md'],
      events: [{ type: 'result', is_error: false }],
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('fails checks with actionable messages', () => {
    const evalCase = parseAgentEvalCase({
      id: 'policy',
      title: 'Policy',
      prompt: 'Do safe work',
      expected: {
        forbiddenText: ['sandbox'],
        forbiddenToolCalls: ['Bash'],
      },
    });

    const report = evaluateAgentEvalCase(evalCase, {
      finalResponse: 'I used the sandbox directly.',
      toolCalls: [{ name: 'Bash' }],
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: 'forbidden-text:sandbox',
        status: 'fail',
      }),
      expect.objectContaining({
        id: 'forbidden-tool:Bash',
        status: 'fail',
      }),
    ]);
  });
});
