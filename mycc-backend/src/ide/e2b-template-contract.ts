import type { E2bSandboxProvider, StartedCodeServerSession } from './e2b-provider.js';
import { escapeShellArg } from '../utils/validation.js';

export type E2bTemplateContractProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>;

export type E2bTemplateContractOptions = {
  requireCodeServer?: boolean;
  requireClaudeCli?: boolean;
  requireAgentSdkBridge?: boolean;
  requireNativeBuildTools?: boolean;
  requireCcrRouter?: boolean;
  requireDesktop?: boolean;
  requirePythonRuntime?: boolean;
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
  'gawk',
  'grep',
  'find',
  'xargs',
  'tar',
  'gzip',
  'rg',
  'jq',
  'file',
  'lsof',
  'realpath',
  'stat',
  'timeout',
] as const;

const GNU_VERSION_COMMANDS = [
  'bash',
  'gawk',
  'sed',
  'grep',
  'find',
  'xargs',
  'tar',
  'gzip',
  'realpath',
  'stat',
  'timeout',
] as const;

const NATIVE_BUILD_TOOL_COMMANDS = [
  'make',
  'gcc',
  'g++',
  'pkg-config',
] as const;

const DESKTOP_COMMANDS = [
  'Xvfb',
  'xfwm4',
  'startxfce4',
  'x11vnc',
  'websockify',
  'dbus-launch',
  'xdpyinfo',
] as const;

const GNU_IDENTITY_PATTERNS: Record<string, string> = {
  bash: 'gnu bash',
  gawk: 'gnu awk|gawk',
  sed: 'gnu sed',
  grep: 'gnu grep',
  find: 'gnu findutils|gnu find',
  xargs: 'gnu findutils|gnu xargs',
  tar: 'gnu tar',
  gzip: 'free software foundation|gnu gzip',
  realpath: 'gnu coreutils|coreutils',
  stat: 'gnu coreutils|coreutils',
  timeout: 'gnu coreutils|coreutils',
  make: 'gnu make',
};

const DEFAULT_AGENT_SDK_BRIDGE_PATH = '/opt/mycc-agent-runtime/bridge.mjs';
const DEFAULT_TEMPLATE_CONTRACT_TIMEOUT_MS = 60_000;

export function buildE2bTemplateContractCommand(options: E2bTemplateContractOptions = {}): string {
  const requiredCommands = new Set<string>(BASE_REQUIRED_COMMANDS);
  const gnuCommands = new Set<string>(GNU_VERSION_COMMANDS);
  if (options.requireCodeServer) {
    requiredCommands.add('code-server');
  }
  if (options.requireClaudeCli) {
    requiredCommands.add('claude');
  }
  if (options.requireNativeBuildTools) {
    NATIVE_BUILD_TOOL_COMMANDS.forEach((cmd) => requiredCommands.add(cmd));
    gnuCommands.add('make');
  }
  if (options.requireCcrRouter) {
    requiredCommands.add('ccr');
  }
  if (options.requireDesktop) {
    DESKTOP_COMMANDS.forEach((cmd) => requiredCommands.add(cmd));
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
    ...Array.from(gnuCommands).flatMap((cmd) => [
      `if command -v ${escapeShellArg(cmd)} >/dev/null 2>&1 && ! ${cmd} --version 2>&1 | grep -Eiq ${escapeShellArg(GNU_IDENTITY_PATTERNS[cmd] || 'gnu')}; then`,
      `  missing="$missing gnu:${cmd}"`,
      'fi',
    ]),
    ...(options.requireAgentSdkBridge ? [
      `bridge_path=${escapeShellArg(bridgePath)}`,
      'if [ ! -f "$bridge_path" ]; then',
      '  missing="$missing file:$bridge_path"',
      'fi',
    ] : []),
    ...(options.requireNativeBuildTools ? buildNativeRuntimeSmokeLines({ includePythonRuntime: true }) : []),
    ...(options.requirePythonRuntime && !options.requireNativeBuildTools
      ? buildPythonRuntimeSmokeLines()
      : []),
    'if [ -n "$missing" ]; then',
    '  echo "E2B template contract missing:$missing" >&2',
    '  exit 42',
    'fi',
    'echo "E2B template contract ok"',
  ];

  return `sh -lc ${escapeShellArg(lines.join('\n'))}`;
}

function buildNativeRuntimeSmokeLines(options: { includePythonRuntime?: boolean } = {}): string[] {
  return [
    'contract_dir="$(mktemp -d)"',
    'trap \'rm -rf "$contract_dir"\' EXIT',
    'cat > "$contract_dir/hello.c" <<\'MYCC_C_EOF\'',
    '#include <stdio.h>',
    'int main(void) { puts("mycc-c-ok"); return 0; }',
    'MYCC_C_EOF',
    'cat > "$contract_dir/hello.cc" <<\'MYCC_CXX_EOF\'',
    '#include <iostream>',
    'int main() { std::cout << "mycc-cxx-ok\\n"; return 0; }',
    'MYCC_CXX_EOF',
    'cat > "$contract_dir/Makefile" <<\'MYCC_MAKE_EOF\'',
    'CC=gcc',
    'CXX=g++',
    'all:',
    '\t$(CC) hello.c -o hello-c',
    '\t$(CXX) hello.cc -o hello-cxx',
    'MYCC_MAKE_EOF',
    'if ! make -C "$contract_dir" >/dev/null 2>&1; then',
    '  missing="$missing native:make"',
    'fi',
    'if ! ([ -x "$contract_dir/hello-c" ] && "$contract_dir/hello-c" | grep -qx "mycc-c-ok"); then',
    '  missing="$missing native:gcc"',
    'fi',
    'if ! ([ -x "$contract_dir/hello-cxx" ] && "$contract_dir/hello-cxx" | grep -qx "mycc-cxx-ok"); then',
    '  missing="$missing native:g++"',
    'fi',
    ...(options.includePythonRuntime ? buildPythonRuntimeSmokeLines('contract_dir') : []),
    'mkdir -p "$contract_dir/npm"',
    'cat > "$contract_dir/npm/native.c" <<\'MYCC_NPM_C_EOF\'',
    '#include <stdio.h>',
    'int main(void) { puts("mycc-npm-native-ok"); return 0; }',
    'MYCC_NPM_C_EOF',
    'cat > "$contract_dir/npm/package.json" <<\'MYCC_PACKAGE_EOF\'',
    '{"scripts":{"smoke":"gcc native.c -o native && ./native > npm-native-ok.txt"}}',
    'MYCC_PACKAGE_EOF',
    'if ! npm --prefix "$contract_dir/npm" run --silent smoke >/dev/null 2>&1; then',
    '  missing="$missing npm:lifecycle"',
    'fi',
    'if ! grep -qx "mycc-npm-native-ok" "$contract_dir/npm/npm-native-ok.txt" 2>/dev/null; then',
    '  missing="$missing npm:write"',
    'fi',
  ];
}

function buildPythonRuntimeSmokeLines(contractDirVariable = ''): string[] {
  const needsTempDir = !contractDirVariable;
  const contractDir = contractDirVariable ? `"${'$'}${contractDirVariable}"` : '"$python_contract_dir"';
  return [
    ...(needsTempDir ? [
      'python_contract_dir="$(mktemp -d)"',
      'trap \'rm -rf "$python_contract_dir"\' EXIT',
    ] : []),
    `if ! python3 -m venv ${contractDir}/venv >/dev/null 2>&1; then`,
    '  missing="$missing python:venv"',
    'fi',
    `if ! ${contractDir}/venv/bin/python -m pip --version >/dev/null 2>&1; then`,
    '  missing="$missing python:pip"',
    'fi',
    `if ! ${contractDir}/venv/bin/python -c "print('mycc-python-ok')" | grep -qx "mycc-python-ok"; then`,
    '  missing="$missing python:runtime"',
    'fi',
  ];
}

export async function assertE2bTemplateContract(params: AssertE2bTemplateContractParams): Promise<void> {
  const result = await params.e2bProvider.runCommandInSession(
    params.session,
    buildE2bTemplateContractCommand(params),
    {
      cwd: params.workspaceDir,
      timeoutMs: params.timeoutMs ?? DEFAULT_TEMPLATE_CONTRACT_TIMEOUT_MS,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.error || result.stdout || `E2B template contract failed: exit=${result.exitCode}`);
  }
}
