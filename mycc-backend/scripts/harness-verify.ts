import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  setHarnessSpanStatus,
  startHarnessSpan,
} from '../src/harness/telemetry.js';

type HarnessTargetId =
  | 'backend-build'
  | 'frontend-build'
  | 'backend-tests'
  | 'frontend-product-tests'
  | 'agent-eval-static'
  | 'e2b-release'
  | 'e2b-agent'
  | 'sandbox-template'
  | 'e2b-ide-smoke'
  | 'e2b-desktop-smoke'
  | 'e2b-agent-sdk-smoke'
  | 'auth-privacy-smoke'
  | 'auth-onboarding-smoke'
  | 'frontend-e2e-recent'
  | 'release'
  | 'landing'
  | 'landing-live';

type HarnessTarget = {
  id: HarnessTargetId;
  label: string;
  description: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  group?: HarnessTargetId[];
  expensive?: boolean;
};

type HarnessResult = {
  id: HarnessTargetId;
  label: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  command: string;
  stdout: string;
  stderr: string;
  skipped?: boolean;
};

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const outputRoot = path.join(repoRoot, 'output', 'harness');

const backendTestEnv: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  ANTHROPIC_API_KEY: undefined,
  E2B_API_KEY: undefined,
  MYCC_AGENT_RUNTIME: undefined,
  MYCC_AGENT_SDK_ALLOWED_TOOLS: undefined,
  MYCC_AGENT_SDK_MODEL: undefined,
  MYCC_AGENT_SDK_PERMISSION_MODE: undefined,
  MYCC_CCR_AUTH_TOKEN: undefined,
  MYCC_CCR_BASE_URL: undefined,
  MYCC_CLAUDE_API_KEY: undefined,
  MYCC_CLAUDE_AUTH_TOKEN: undefined,
  MYCC_E2B_ALLOW_PUBLIC_TRAFFIC: undefined,
  MYCC_E2B_API_KEY: undefined,
  MYCC_E2B_DESKTOP_ENABLED: undefined,
  MYCC_E2B_DESKTOP_PORT: undefined,
  MYCC_E2B_LINUX_USER: undefined,
  MYCC_E2B_TEMPLATE: undefined,
  MYCC_E2B_WORKSPACE_DIR: undefined,
  MYCC_IDE_PROVIDER: undefined,
  MYCC_IDE_SESSION_TTL_SECONDS: undefined,
  MYCC_WORKSPACE_PROVIDER: undefined,
  VPS_ANTHROPIC_AUTH_TOKEN: undefined,
  VPS_ANTHROPIC_BASE_URL: undefined,
};

const targets: HarnessTarget[] = [
  {
    id: 'backend-build',
    label: 'Backend build',
    description: 'TypeScript build and runtime skills catalog sync for the backend.',
    command: 'npm',
    args: ['run', 'build'],
    cwd: backendRoot,
  },
  {
    id: 'frontend-build',
    label: 'Frontend build',
    description: 'TypeScript and Vite production build for the React app.',
    command: 'npm',
    args: ['run', 'build'],
    cwd: path.join(repoRoot, 'mycc-web-react'),
  },
  {
    id: 'backend-tests',
    label: 'Backend tests',
    description: 'Backend Vitest suite covering runtime, routes, E2B session handling, skills, harness, and migrations.',
    command: 'npm',
    args: ['test', '--', '--run'],
    cwd: backendRoot,
    env: backendTestEnv,
  },
  {
    id: 'frontend-product-tests',
    label: 'Frontend product tests',
    description: 'Focused product-facing React tests for login, chat/workbench, workspace, skills, runtime diagnostics, and copy.',
    command: 'npm',
    args: [
      'test',
      '--',
      '--run',
      'src/App.test.tsx',
      'src/components/LoginPage.test.tsx',
      'src/components/WorkspacePage.test.tsx',
      'src/components/ChatPage.workbench.test.tsx',
      'src/components/chat/ChatRuntimeStatusBadge.test.tsx',
      'src/components/SkillsPage.test.tsx',
      'src/components/MessageComponents.test.tsx',
      'src/utils/productCopy.test.ts',
    ],
    cwd: path.join(repoRoot, 'mycc-web-react'),
  },
  {
    id: 'agent-eval-static',
    label: 'Static agent evals',
    description: 'Model-independent eval checks against checked-in observed fixtures.',
    command: 'npm',
    args: ['run', 'eval:agent-static'],
    cwd: backendRoot,
  },
  {
    id: 'e2b-release',
    label: 'E2B release readiness',
    description: 'Static release gate for E2B docs, scripts, migration, and smoke wiring.',
    command: 'npm',
    args: ['run', 'verify:e2b-release'],
    cwd: backendRoot,
  },
  {
    id: 'e2b-agent',
    label: 'E2B Agent doctor',
    description: 'Runtime preflight for E2B Agent SDK configuration and template access.',
    command: 'npm',
    args: ['run', 'doctor:e2b-agent'],
    cwd: backendRoot,
  },
  {
    id: 'sandbox-template',
    label: 'Sandbox template doctor',
    description: 'Local sandbox template file, executable, credential, and template checks.',
    command: 'npm',
    args: ['--prefix', path.join(repoRoot, 'mycc-sandbox'), 'run', 'doctor:template'],
    cwd: repoRoot,
  },
  {
    id: 'e2b-ide-smoke',
    label: 'E2B IDE live smoke',
    description: 'Creates a real E2B IDE session through the backend proxy. Requires a running backend and BASE_URL when not using localhost:8080.',
    command: 'npm',
    args: ['run', 'smoke:e2b-ide'],
    cwd: backendRoot,
    expensive: true,
  },
  {
    id: 'e2b-desktop-smoke',
    label: 'E2B desktop live smoke',
    description: 'Creates a real E2B desktop/noVNC session through the backend proxy. Requires a running backend and BASE_URL when not using localhost:8080.',
    command: 'npm',
    args: ['run', 'smoke:e2b-desktop'],
    cwd: backendRoot,
    expensive: true,
  },
  {
    id: 'e2b-agent-sdk-smoke',
    label: 'E2B Agent SDK workspace live smoke',
    description: 'Runs a real Agent SDK turn in E2B and verifies shared code-server workspace health.',
    command: 'npm',
    args: ['run', 'smoke:e2b-agent-sdk-workspace'],
    cwd: backendRoot,
    expensive: true,
  },
  {
    id: 'auth-privacy-smoke',
    label: 'Auth privacy smoke',
    description: 'Checks failed login privacy against the target backend without registering users or calling chat.',
    command: 'npm',
    args: ['run', 'smoke:auth-privacy'],
    cwd: backendRoot,
    expensive: true,
  },
  {
    id: 'auth-onboarding-smoke',
    label: 'Auth onboarding smoke',
    description: 'Registers an example.test user, initializes onboarding, and verifies /api/auth/me without calling chat.',
    command: 'npm',
    args: ['run', 'smoke:auth-onboarding'],
    cwd: backendRoot,
    expensive: true,
  },
  {
    id: 'frontend-e2e-recent',
    label: 'Recent frontend E2E',
    description: 'Playwright recent-flow regression target. Requires frontend server/base URL setup.',
    command: 'npm',
    args: ['--prefix', path.join(repoRoot, 'mycc-web-react'), 'run', 'e2e:recent'],
    cwd: repoRoot,
    expensive: true,
  },
  {
    id: 'release',
    label: 'Harness release gate',
    description: 'Default non-smoke release gate across backend readiness, static evals, and sandbox template checks.',
    group: ['agent-eval-static', 'e2b-release', 'e2b-agent', 'sandbox-template'],
  },
  {
    id: 'landing',
    label: 'Landing candidate gate',
    description: 'Formal landing candidate gate: builds, backend tests, product-facing frontend tests, static evals, E2B release readiness, E2B doctor, and sandbox template doctor.',
    group: [
      'backend-build',
      'frontend-build',
      'backend-tests',
      'frontend-product-tests',
      'agent-eval-static',
      'e2b-release',
      'e2b-agent',
      'sandbox-template',
    ],
  },
  {
    id: 'landing-live',
    label: 'Landing live gate',
    description: 'Final landing gate with builds, release checks, and live E2B IDE/desktop/Agent SDK smoke tests. Requires target backend to be running.',
    group: [
      'backend-build',
      'frontend-build',
      'backend-tests',
      'frontend-product-tests',
      'agent-eval-static',
      'e2b-release',
      'e2b-agent',
      'sandbox-template',
      'e2b-ide-smoke',
      'e2b-desktop-smoke',
      'e2b-agent-sdk-smoke',
      'auth-privacy-smoke',
      'auth-onboarding-smoke',
    ],
    expensive: true,
  },
];

const targetById = new Map(targets.map((target) => [target.id, target]));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    printTargetList();
    return;
  }

  const span = startHarnessSpan('mycc.harness_verify', {
    'mycc.harness_verify.target': args.target,
    'mycc.harness_verify.write_report': !args.noWrite,
  });
  const selectedTargetIds = resolveSelectedTargets(args.target);
  const expandedTargets = expandTargetGroups(selectedTargetIds);
  const startedAt = new Date();
  try {
    const results = expandedTargets.map(runTarget);
    const report = {
      ok: results.every((result) => result.ok),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      target: args.target,
      results,
    };

    span.setAttributes({
      'mycc.harness_verify.failed_count': results.filter((result) => !result.ok).length,
      'mycc.harness_verify.ok': report.ok,
      'mycc.harness_verify.target_count': results.length,
    });
    setHarnessSpanStatus(span, report.ok ? 'ok' : 'error', report.ok ? 'passed' : 'failed');

    const markdown = formatMarkdownReport(report);
    const json = JSON.stringify(report, null, 2);
    console.log(markdown);

    if (!args.noWrite) {
      mkdirSync(outputRoot, { recursive: true });
      const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
      const name = `${stamp}-${args.target.replace(/[^a-z0-9._-]+/gi, '-')}`;
      const jsonPath = path.join(outputRoot, `${name}.json`);
      const markdownPath = path.join(outputRoot, `${name}.md`);
      writeFileSync(jsonPath, `${json}\n`);
      writeFileSync(markdownPath, `${markdown}\n`);
      console.log(`\nReports written:\n- ${jsonPath}\n- ${markdownPath}`);
    }

    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    span.recordException(error);
    setHarnessSpanStatus(span, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    span.end();
  }
}

function parseArgs(argv: string[]): {
  list: boolean;
  noWrite: boolean;
  target: string;
} {
  let target = 'release';
  let list = false;
  let noWrite = false;

  for (const arg of argv) {
    if (arg === '--list') {
      list = true;
      continue;
    }
    if (arg === '--no-write') {
      noWrite = true;
      continue;
    }
    if (arg.startsWith('--target=')) {
      target = arg.slice('--target='.length).trim() || target;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { list, noWrite, target };
}

function resolveSelectedTargets(raw: string): HarnessTargetId[] {
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean) as HarnessTargetId[];
  if (ids.length === 0) return ['release'];

  for (const id of ids) {
    if (!targetById.has(id)) {
      throw new Error(`Unknown harness target: ${id}. Run npm run harness:verify -- --list`);
    }
  }

  return ids;
}

function expandTargetGroups(ids: HarnessTargetId[]): HarnessTarget[] {
  const expanded: HarnessTarget[] = [];
  const seen = new Set<HarnessTargetId>();

  for (const id of ids) {
    const target = targetById.get(id);
    if (!target) continue;
    const children = target.group ?? [target.id];
    for (const childId of children) {
      if (seen.has(childId)) continue;
      const child = targetById.get(childId);
      if (!child || child.group) continue;
      expanded.push(child);
      seen.add(childId);
    }
  }

  return expanded;
}

function runTarget(target: HarnessTarget): HarnessResult {
  const span = startHarnessSpan('mycc.harness_verify.target', {
    'mycc.harness_verify.target_id': target.id,
    'mycc.harness_verify.target_label': target.label,
  });
  if (!target.command) {
    setHarnessSpanStatus(span, 'error', 'missing command');
    span.end();
    return {
      id: target.id,
      label: target.label,
      ok: false,
      exitCode: null,
      durationMs: 0,
      command: '<missing>',
      stdout: '',
      stderr: 'Harness target is missing a command.',
    };
  }

  const startedAt = Date.now();
  try {
    const result = spawnSync(target.command, target.args ?? [], {
      cwd: target.cwd ?? backendRoot,
      encoding: 'utf8',
      env: buildTargetEnv(target),
    });
    const ok = result.status === 0;
    const durationMs = Date.now() - startedAt;

    span.setAttributes({
      'mycc.harness_verify.duration_ms': durationMs,
      'mycc.harness_verify.exit_code': result.status,
      'mycc.harness_verify.ok': ok,
    });
    setHarnessSpanStatus(span, ok ? 'ok' : 'error', ok ? 'passed' : 'failed');

    return {
      id: target.id,
      label: target.label,
      ok,
      exitCode: result.status,
      durationMs,
      command: [target.command, ...(target.args ?? [])].join(' '),
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    span.recordException(error);
    setHarnessSpanStatus(span, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    span.end();
  }
}

function buildTargetEnv(target: HarnessTarget): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!target.env) return env;

  for (const [key, value] of Object.entries(target.env)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

function formatMarkdownReport(report: {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  target: string;
  results: HarnessResult[];
}): string {
  const lines = [
    '# MyCC Harness Verification Report',
    '',
    `- Target: \`${report.target}\``,
    `- Status: ${report.ok ? 'ok' : 'failed'}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    '',
    '| Target | Status | Exit | Duration |',
    '| --- | --- | ---: | ---: |',
    ...report.results.map((result) => {
      return `| \`${result.id}\` | ${result.ok ? 'ok' : 'failed'} | ${result.exitCode ?? 'n/a'} | ${result.durationMs}ms |`;
    }),
    '',
  ];

  for (const result of report.results) {
    lines.push(`## ${result.label}`);
    lines.push('');
    lines.push(`Command: \`${result.command}\``);
    lines.push('');
    if (result.stdout) {
      lines.push('### stdout');
      lines.push('');
      lines.push('```text');
      lines.push(result.stdout);
      lines.push('```');
      lines.push('');
    }
    if (result.stderr) {
      lines.push('### stderr');
      lines.push('');
      lines.push('```text');
      lines.push(result.stderr);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function printTargetList(): void {
  for (const target of targets) {
    const suffix = target.expensive ? ' (expensive)' : '';
    const group = target.group ? ` group=[${target.group.join(', ')}]` : '';
    console.log(`${target.id}${suffix}${group} - ${target.description}`);
  }
}

function printHelp(): void {
  console.log([
    'Usage: npm run harness:verify -- [--target=release] [--list] [--no-write]',
    '',
    'Examples:',
    '  npm run harness:verify -- --list',
    '  npm run harness:verify -- --target=agent-eval-static --no-write',
    '  npm run harness:verify -- --target=e2b-release --no-write',
    '  npm run harness:verify -- --target=e2b-release,sandbox-template',
    '  npm run harness:verify -- --target=landing --no-write',
    '  BASE_URL=http://localhost:8080 npm run harness:verify -- --target=landing-live --no-write',
  ].join('\n'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
