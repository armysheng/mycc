import { spawnSync } from 'node:child_process';

type BucketId =
  | 'pr1-landing-gate'
  | 'pr2-skills-product'
  | 'pr3-backend-runtime'
  | 'pr4-sandbox-desktop'
  | 'pr5-frontend-workbench'
  | 'needs-owner-review'
  | 'do-not-stage'
  | 'unclassified';

type Rule = {
  bucket: BucketId;
  patterns: string[];
  reason: string;
};

type DirtyFile = {
  status: string;
  path: string;
};

const rules: Rule[] = [
  {
    bucket: 'do-not-stage',
    reason: 'generated artifact, local output, screenshot, or redesign experiment',
    patterns: [
      '.codex-artifacts/**',
      'output/**',
      'home-design-sample.html',
      'design-qa.md',
      'mycc-web-react-redesign/**',
    ],
  },
  {
    bucket: 'needs-owner-review',
    reason: 'landing-relevant but not yet assigned to a clean PR boundary',
    patterns: [
      'mycc-backend/src/automations/**',
      'mycc-backend/src/chat/openclaw-context.ts',
      'mycc-backend/src/chat/openclaw-context.test.ts',
      'mycc-backend/src/routes/harness.ts',
      'mycc-backend/src/routes/harness.test.ts',
      'mycc-backend/src/sandbox/**',
      'mycc-web-react/src/components/AutomationsPage.tsx',
      'mycc-web-react/src/components/HistoryView.tsx',
      'mycc-web-react/src/components/SettingsButton.tsx',
      'mycc-web-react/src/components/SettingsModal.tsx',
      'mycc-web-react/src/components/WorkspacePage.tsx',
      'mycc-web-react/src/components/WorkspacePage.test.tsx',
      'mycc-web-react/src/components/panel/SkillList.tsx',
    ],
  },
  {
    bucket: 'pr1-landing-gate',
    reason: 'release gate, harness verifier, migrations runner, docs, CI, or staging workflow',
    patterns: [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy-staging.yml',
      'scripts/dev-codex.sh',
      'scripts/**',
      'evals/agent/**',
      'evals/**',
      'docs/harness/**',
      'mycc-backend/package.json',
      'mycc-backend/package-lock.json',
      'mycc-backend/scripts/harness-verify.ts',
      'mycc-backend/scripts/agent-eval-static.ts',
      'mycc-backend/scripts/apply-migrations.ts',
      'mycc-backend/scripts/landing-pr-classify.ts',
      'mycc-backend/scripts/verify-e2b-release-readiness.ts',
      'mycc-backend/scripts/smoke-e2b-ide.ts',
      'mycc-backend/scripts/smoke-e2b-desktop.ts',
      'mycc-backend/src/harness/**',
      'mycc-backend/src/scripts/migration-sql.ts',
      'mycc-backend/src/scripts/apply-migrations.test.ts',
      'mycc-backend/src/scripts/staging-workflow.test.ts',
      'mycc-backend/docs/landing-readiness.md',
      'mycc-backend/docs/landing-pr-coordination.md',
      'mycc-backend/docs/landing-pr-submit-checklist.md',
      'mycc-backend/docs/landing-pr-staging-plan.md',
      'mycc-backend/docs/landing-dirty-worktree-audit.md',
      'mycc-backend/docs/e2b-release-readiness.md',
      'mycc-backend/README.md',
      'mycc-backend/DEPLOYMENT.md',
    ],
  },
  {
    bucket: 'pr2-skills-product',
    reason: 'skills registry, install path, SkillsPage, API, and skills tests',
    patterns: [
      'docs/mycc-skill-center-integration.md',
      'mycc-backend/src/skills/**',
      'mycc-backend/src/routes/skills.ts',
      'mycc-backend/src/routes/skills.test.ts',
      'mycc-web-react/src/api/skills.ts',
      'mycc-web-react/src/api/skills.test.ts',
      'mycc-web-react/src/components/SkillsPage.tsx',
      'mycc-web-react/src/components/SkillsPage.test.tsx',
      'mycc-web-react/src/components/ui/**',
      'mycc-web-react/tests/e2e/skills/**',
    ],
  },
  {
    bucket: 'pr3-backend-runtime',
    reason: 'Agent SDK runtime, E2B session reuse, trace, readiness, keepalive, and migrations',
    patterns: [
      'mycc-backend/.env.example',
      'mycc-backend/db/schema.sql',
      'mycc-backend/db/migrations/007-add-agent-run-trace.sql',
      'mycc-backend/db/migrations/008-add-ide-session-identity.sql',
      'mycc-backend/scripts/smoke-e2b-agent-workspace.ts',
      'mycc-backend/src/adapters/remote-claude-adapter.ts',
      'mycc-backend/src/agent-runtime/**',
      'mycc-backend/src/auth/service.ts',
      'mycc-backend/src/auth/service.test.ts',
      'mycc-backend/src/ide/**',
      'mycc-backend/src/index.ts',
      'mycc-backend/src/routes/assistant.test.ts',
      'mycc-backend/src/routes/chat.ts',
      'mycc-backend/src/routes/chat*.test.ts',
      'mycc-backend/src/routes/ide.test.ts',
      'mycc-backend/src/routes/onboarding.ts',
      'mycc-backend/src/routes/onboarding.test.ts',
      'mycc-backend/src/routes/workspace.ts',
      'mycc-backend/src/routes/workspace.test.ts',
      'mycc-backend/src/startup/readiness.ts',
      'mycc-backend/src/startup/readiness.test.ts',
      'mycc-backend/src/startup/ssh-startup.ts',
      'mycc-backend/src/workspace/**',
      'mycc-backend/templates/e2b-code-server/agent-sdk-bridge.mjs',
      'mycc-backend/templates/user-workspace/**',
    ],
  },
  {
    bucket: 'pr4-sandbox-desktop',
    reason: 'assistant sandbox template, desktop/browser helpers, template contracts, and sandbox docs',
    patterns: [
      'docs/mycc-assistant-sandbox-integration.md',
      'docs/plans/2026-05-29-e2b-codeserver-sandbox-poc.md',
      'mycc-sandbox/**',
      'mycc-backend/templates/e2b-code-server/**',
    ],
  },
  {
    bucket: 'pr5-frontend-workbench',
    reason: 'frontend product shell, workbench, product copy, and related tests',
    patterns: [
      'mycc-web-react/package.json',
      'mycc-web-react/package-lock.json',
      'mycc-web-react/playwright.config.ts',
      'mycc-web-react/src/App.tsx',
      'mycc-web-react/src/App.test.tsx',
      'mycc-web-react/src/components/ChatPage.tsx',
      'mycc-web-react/src/components/ChatPage.workbench.test.tsx',
      'mycc-web-react/src/components/LoginPage.test.tsx',
      'mycc-web-react/src/components/MessageComponents.tsx',
      'mycc-web-react/src/components/MessageComponents.test.tsx',
      'mycc-web-react/src/components/assistant/AssistantHomePanel.tsx',
      'mycc-web-react/src/components/assistant/AssistantHomePanel.test.tsx',
      'mycc-web-react/src/components/chat/**',
      'mycc-web-react/src/components/layout/Sidebar.tsx',
      'mycc-web-react/src/components/layout/Sidebar.test.tsx',
      'mycc-web-react/src/components/settings/GeneralSettings.tsx',
      'mycc-web-react/src/components/settings/GeneralSettings.test.tsx',
      'mycc-web-react/src/config/api.ts',
      'mycc-web-react/src/config/api.test.ts',
      'mycc-web-react/src/contexts/AuthContext.tsx',
      'mycc-web-react/src/hooks/streaming/**',
      'mycc-web-react/src/test/**',
      'mycc-web-react/src/types.ts',
      'mycc-web-react/src/utils/UnifiedMessageProcessor.test.ts',
      'mycc-web-react/src/utils/apiError.ts',
      'mycc-web-react/src/utils/productCopy.ts',
      'mycc-web-react/src/utils/productCopy.test.ts',
      'mycc-web-react/src/utils/workbenchActivity.ts',
      'mycc-web-react/src/utils/workbenchActivity.test.ts',
      'mycc-web-react/src/vite-env.d.ts',
      'mycc-web-react/tests/e2e/chat-flow/**',
      'mycc-web-react/tests/e2e/fixtures/**',
      'mycc-web-react/vite.config.ts',
    ],
  },
];

const bucketOrder: BucketId[] = [
  'pr1-landing-gate',
  'pr2-skills-product',
  'pr3-backend-runtime',
  'pr4-sandbox-desktop',
  'pr5-frontend-workbench',
  'needs-owner-review',
  'do-not-stage',
  'unclassified',
];

function main() {
  const args = new Set(process.argv.slice(2));
  const files = listDirtyFiles();
  const classified = files.map((file) => ({
    ...file,
    ...classifyPath(file.path),
  }));

  const report = bucketOrder.map((bucket) => ({
    bucket,
    files: classified.filter((item) => item.bucket === bucket),
  }));

  if (args.has('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  const hasUnclassified = classified.some((item) => item.bucket === 'unclassified');
  if (args.has('--fail-on-unclassified') && hasUnclassified) {
    process.exitCode = 1;
  }
}

function listDirtyFiles(): DirtyFile[] {
  const result = spawnSync('git', ['status', '--short'], {
    cwd: repoRoot(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git status failed');
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3);
      const path = rawPath.includes(' -> ')
        ? rawPath.split(' -> ').pop() || rawPath
        : rawPath;
      return { status, path };
    });
}

function classifyPath(path: string): { bucket: BucketId; reason: string } {
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => matchPattern(path, pattern))) {
      return {
        bucket: rule.bucket,
        reason: rule.reason,
      };
    }
  }
  return {
    bucket: 'unclassified',
    reason: 'no landing PR rule matched this path',
  };
}

function matchPattern(path: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (pattern.includes('*')) {
    return globToRegExp(pattern).test(path);
  }
  return path === pattern;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function printReport(report: Array<{ bucket: BucketId; files: Array<DirtyFile & { reason: string }> }>) {
  console.log('# Landing PR dirty file classification');
  console.log('');
  for (const section of report) {
    console.log(`## ${section.bucket} (${section.files.length})`);
    if (section.files.length === 0) {
      console.log('');
      continue;
    }
    console.log(`Reason: ${section.files[0].reason}`);
    console.log('');
    for (const file of section.files) {
      console.log(`- ${file.status} ${file.path}`);
    }
    console.log('');
  }
}

function repoRoot(): string {
  return new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
}

main();
