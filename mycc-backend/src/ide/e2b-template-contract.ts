import type { E2bSandboxProvider, StartedCodeServerSession } from './e2b-provider.js';
import { escapeShellArg } from '../utils/validation.js';

export type E2bTemplateContractProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>;

export type E2bTemplateContractOptions = {
  requireCodeServer?: boolean;
  requireClaudeCli?: boolean;
  requireAgentSdkBridge?: boolean;
  bridgePath?: string;
};

export type AssertE2bTemplateContractParams = E2bTemplateContractOptions & {
  e2bProvider: E2bTemplateContractProvider;
  session: StartedCodeServerSession;
  workspaceDir: string;
  timeoutMs?: number;
};

const BASE_REQUIRED_COMMANDS = [
  'sh',
  'bash',
  'git',
  'node',
  'npm',
  'python3',
  'curl',
  'sed',
  'awk',
  'grep',
  'find',
  'xargs',
  'tar',
  'gzip',
  'realpath',
  'stat',
  'timeout',
] as const;

const GNU_VERSION_COMMANDS = [
  'sed',
  'grep',
  'find',
  'xargs',
  'tar',
  'realpath',
  'stat',
  'timeout',
] as const;

const DEFAULT_AGENT_SDK_BRIDGE_PATH = '/opt/mycc-agent-runtime/bridge.mjs';

export function buildE2bTemplateContractCommand(options: E2bTemplateContractOptions = {}): string {
  const requiredCommands = new Set<string>(BASE_REQUIRED_COMMANDS);
  if (options.requireCodeServer) {
    requiredCommands.add('code-server');
  }
  if (options.requireClaudeCli) {
    requiredCommands.add('claude');
  }

  const bridgePath = options.bridgePath || DEFAULT_AGENT_SDK_BRIDGE_PATH;
  const lines = [
    'set -u',
    'missing=""',
    `for cmd in ${Array.from(requiredCommands).map(escapeShellArg).join(' ')}; do`,
    '  if ! command -v "$cmd" >/dev/null 2>&1; then',
    '    missing="$missing command:$cmd"',
    '  fi',
    'done',
    ...GNU_VERSION_COMMANDS.flatMap((cmd) => [
      `if command -v ${escapeShellArg(cmd)} >/dev/null 2>&1 && ! ${cmd} --version >/dev/null 2>&1; then`,
      `  missing="$missing gnu:${cmd}"`,
      'fi',
    ]),
    ...(options.requireAgentSdkBridge ? [
      `bridge_path=${escapeShellArg(bridgePath)}`,
      'if [ ! -f "$bridge_path" ]; then',
      '  missing="$missing file:$bridge_path"',
      'fi',
    ] : []),
    'if [ -n "$missing" ]; then',
    '  echo "E2B template contract missing:$missing" >&2',
    '  exit 42',
    'fi',
    'echo "E2B template contract ok"',
  ];

  return `sh -lc ${escapeShellArg(lines.join('\n'))}`;
}

export async function assertE2bTemplateContract(params: AssertE2bTemplateContractParams): Promise<void> {
  const result = await params.e2bProvider.runCommandInSession(
    params.session,
    buildE2bTemplateContractCommand(params),
    {
      cwd: params.workspaceDir,
      timeoutMs: params.timeoutMs ?? 30_000,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.error || result.stdout || `E2B template contract failed: exit=${result.exitCode}`);
  }
}
