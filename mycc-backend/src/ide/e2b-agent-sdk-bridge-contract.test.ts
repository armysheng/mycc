import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bridgeSource = path.join(backendRoot, 'templates/e2b-code-server/agent-sdk-bridge.mjs');

describe('E2B Agent SDK bridge contract', () => {
  it('passes the MyCC bridge protocol to the Agent SDK without leaking OpenAI envs', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mycc-agent-sdk-bridge-'));
    try {
      cpSync(bridgeSource, path.join(tempDir, 'bridge.mjs'));
      writeFakeAgentSdkPackage(tempDir);

      const capturePath = path.join(tempDir, 'query-args.json');
      const prompt = '请在工作区写入 smoke 文件';
      const stdout = execFileSync(process.execPath, ['bridge.mjs'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH || '',
          HOME: path.join(tempDir, 'home'),
          MYCC_BRIDGE_CAPTURE_PATH: capturePath,
          MYCC_AGENT_PROMPT_B64: Buffer.from(prompt, 'utf8').toString('base64'),
          MYCC_AGENT_SDK_ALLOWED_TOOLS: ' Read, Write, , Bash ',
          MYCC_AGENT_SDK_PARTIAL_MESSAGES: 'true',
          MYCC_AGENT_SDK_PERMISSION_MODE: 'bypassPermissions',
          MYCC_AGENT_SESSION_ID: 'session-123',
          MYCC_AGENT_WORKSPACE_CWD: '/home/mycc/workspace/project',
          MYCC_E2B_AGENT_SDK_MODEL: 'claude-smoke-model',
          CLAUDE_AGENT_SDK_CLIENT_APP: 'mycc-test/bridge-contract',
          ANTHROPIC_BASE_URL: 'https://ccr.example.test',
          ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
          OPENAI_BASE_URL: 'https://openai-should-not-leak.example.test',
          OPENAI_API_KEY: 'openai-secret-should-not-leak',
        },
      });

      const messages = stdout.trim().split('\n').map((line) => JSON.parse(line));
      expect(messages).toEqual([
        { type: 'system', session_id: 'session-123', model: 'claude-smoke-model' },
        { type: 'result', subtype: 'success', is_error: false, session_id: 'session-123' },
      ]);

      const captured = JSON.parse(readFileSync(capturePath, 'utf8'));
      expect(captured.prompt).toBe(prompt);
      expect(captured.options).toEqual(expect.objectContaining({
        allowedTools: ['Read', 'Write', 'Bash'],
        allowDangerouslySkipPermissions: true,
        cwd: '/home/mycc/workspace/project',
        includePartialMessages: true,
        model: 'claude-smoke-model',
        permissionMode: 'bypassPermissions',
        resume: 'session-123',
        settingSources: [],
      }));
      expect(captured.options.systemPrompt).toEqual({
        type: 'preset',
        preset: 'claude_code',
        excludeDynamicSections: true,
      });
      expect(captured.options.env).toEqual(expect.objectContaining({
        ANTHROPIC_BASE_URL: 'https://ccr.example.test',
        ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'mycc-test/bridge-contract',
      }));
      expect(captured.options.env).not.toHaveProperty('OPENAI_BASE_URL');
      expect(captured.options.env).not.toHaveProperty('OPENAI_API_KEY');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('defaults standalone bridge runs to bypass permissions', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mycc-agent-sdk-bridge-default-'));
    try {
      cpSync(bridgeSource, path.join(tempDir, 'bridge.mjs'));
      writeFakeAgentSdkPackage(tempDir);

      const capturePath = path.join(tempDir, 'query-args.json');
      execFileSync(process.execPath, ['bridge.mjs'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH || '',
          HOME: path.join(tempDir, 'home'),
          MYCC_BRIDGE_CAPTURE_PATH: capturePath,
          MYCC_AGENT_PROMPT_B64: Buffer.from('hello', 'utf8').toString('base64'),
        },
      });

      const captured = JSON.parse(readFileSync(capturePath, 'utf8'));
      expect(captured.options).toEqual(expect.objectContaining({
        allowDangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions',
      }));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function writeFakeAgentSdkPackage(tempDir: string): void {
  const packageDir = path.join(tempDir, 'node_modules/@anthropic-ai/claude-agent-sdk');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    type: 'module',
    exports: './index.mjs',
  }));
  writeFileSync(path.join(packageDir, 'index.mjs'), [
    'import { writeFileSync } from "node:fs";',
    'export async function* query(args) {',
    '  writeFileSync(process.env.MYCC_BRIDGE_CAPTURE_PATH, JSON.stringify(args, null, 2));',
    '  yield { type: "system", session_id: args.options.resume, model: args.options.model };',
    '  yield { type: "result", subtype: "success", is_error: false, session_id: args.options.resume };',
    '}',
  ].join('\n'));
}
