import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runStaticAgentEvalSuite,
} from './agent-eval-runner.js';

let tmpRoots: string[] = [];

async function makeEvalRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mycc-agent-eval-'));
  tmpRoots.push(root);
  return root;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

describe('agent eval runner', () => {
  afterEach(async () => {
    await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
    tmpRoots = [];
  });

  it('runs static eval cases from case and observed fixtures', async () => {
    const root = await makeEvalRoot();
    await writeJson(path.join(root, 'agent', 'chat-basic', 'case.json'), {
      id: 'chat-basic',
      title: 'Basic chat',
      prompt: 'Say hello',
      expected: {
        finalResponseIncludes: ['整理'],
        forbiddenText: ['E2B'],
      },
    });
    await writeJson(path.join(root, 'agent', 'chat-basic', 'observed.json'), {
      finalResponse: '我会先整理项目状态。',
      toolCalls: [],
      events: [],
    });

    const suite = await runStaticAgentEvalSuite(path.join(root, 'agent'));

    expect(suite.ok).toBe(true);
    expect(suite.reports).toHaveLength(1);
    expect(suite.reports[0]).toMatchObject({
      caseId: 'chat-basic',
      ok: true,
    });
  });

  it('fails static evals when observed results expose forbidden provider terms', async () => {
    const root = await makeEvalRoot();
    await writeJson(path.join(root, 'agent', 'policy', 'case.json'), {
      id: 'policy',
      title: 'Policy',
      prompt: 'Stay product-facing',
      expected: {
        forbiddenText: ['sandbox'],
      },
    });
    await writeJson(path.join(root, 'agent', 'policy', 'observed.json'), {
      finalResponse: 'I used the sandbox.',
      toolCalls: [],
    });

    const suite = await runStaticAgentEvalSuite(path.join(root, 'agent'));

    expect(suite.ok).toBe(false);
    expect(suite.reports[0]?.checks).toEqual([
      expect.objectContaining({
        id: 'forbidden-text:sandbox',
        status: 'fail',
      }),
    ]);
  });
});
