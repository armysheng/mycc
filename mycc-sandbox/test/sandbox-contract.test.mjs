import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function imagePreloadSkillIds() {
  return imagePreloadSkills().map((skill) => skill.id);
}

function imagePreloadSkills() {
  const manifest = readJson('../mycc-backend/src/skills/image-preload-skills.json');
  return manifest.skills;
}

test('assistant sandbox module exposes the expected file contract', () => {
  for (const relativePath of [
    'package.json',
    'templates/e2b-assistant-sandbox/Dockerfile',
    'templates/e2b-assistant-sandbox/template.ts',
    'templates/e2b-assistant-sandbox/contracts/template-contract.sh',
    'templates/e2b-assistant-sandbox/bin/mycc-start-code-server',
    'templates/e2b-assistant-sandbox/bin/mycc-start-ccr',
    'templates/e2b-assistant-sandbox/bin/mycc-start-desktop',
    'templates/e2b-assistant-sandbox/bin/mycc-health-desktop',
    'templates/e2b-assistant-sandbox/bin/mycc-browser',
    'templates/e2b-assistant-sandbox/bin/mycc-register-deliverable',
    'scripts/sync-base-skills.mjs',
    'scripts/create-template.sh',
    'scripts/doctor-template.mjs',
    'scripts/smoke-local-contract.mjs',
    'scripts/smoke-e2b-template.mjs',
    'README.md',
  ]) {
    assert.ok(existsSync(path.join(root, relativePath)), `${relativePath} should exist`);
  }
});

test('Dockerfile builds an AI browser automation ready assistant image', () => {
  const dockerfile = read('templates/e2b-assistant-sandbox/Dockerfile');

  assert.match(dockerfile, /mcr\.microsoft\.com\/playwright\/python:.*noble/);
  assert.match(dockerfile, /ARG CODE_SERVER_VERSION=/);
  assert.match(dockerfile, /ARG CLAUDE_CODE_VERSION=/);
  assert.match(dockerfile, /ARG CLAUDE_AGENT_SDK_VERSION=/);
  assert.match(dockerfile, /ARG CLAUDE_CODE_ROUTER_VERSION=/);
  assert.match(dockerfile, /ARG BROWSER_USE_VERSION=/);
  assert.match(dockerfile, /@anthropic-ai\/claude-code/);
  assert.match(dockerfile, /@anthropic-ai\/claude-agent-sdk/);
  assert.match(dockerfile, /@musistudio\/claude-code-router/);
  assert.match(dockerfile, /code-server\.dev\/install\.sh/);
  assert.match(dockerfile, /browser-use==\$\{BROWSER_USE_VERSION\}/);
  assert.match(dockerfile, /playwright==\$\{PLAYWRIGHT_VERSION\}/);
  assert.match(dockerfile, /playwright install chromium/);
  assert.match(dockerfile, /ln -sf "\$\{MYCC_BROWSER_AGENT_VENV\}\/bin\/uv" \/usr\/local\/bin\/uv/);
  assert.match(dockerfile, /ln -sfn \/ms-playwright \/home\/mycc\/\.cache\/ms-playwright/);
  assert.match(dockerfile, /xfce4/);
  assert.match(dockerfile, /x11vnc/);
  assert.match(dockerfile, /novnc/);
  assert.match(dockerfile, /websockify/);
  assert.match(dockerfile, /xdg-utils/);
  assert.match(dockerfile, /xvfb/);
  assert.match(dockerfile, /chromium/);
  assert.equal((dockerfile.match(/printf '%s\\\\n'/g) || []).length, 4);
  assert.equal(dockerfile.includes(String.raw`printf '%s\n'`), false);
  assert.match(dockerfile, /mycc-browser\.desktop/);
  assert.match(dockerfile, /WebBrowser=mycc-browser/);
  assert.match(dockerfile, /\/usr\/share\/xfce4\/helpers\/mycc-browser\.desktop/);
  assert.match(dockerfile, /X-XFCE-CommandsWithParameter=\/usr\/local\/bin\/mycc-browser "%s"/);
  assert.match(dockerfile, /x-scheme-handler\/http=mycc-browser\.desktop/);
  assert.match(dockerfile, /ln -sf \/usr\/local\/bin\/mycc-browser \/usr\/local\/bin\/x-www-browser/);
  assert.match(dockerfile, /ln -sf \/usr\/local\/bin\/mycc-browser \/usr\/local\/bin\/sensible-browser/);
  assert.match(dockerfile, /\/home\/mycc\/workspace/);
});

test('template ready command runs the sandbox contract inside the user image', () => {
  const template = read('templates/e2b-assistant-sandbox/template.ts');

  assert.match(template, /mycc-assistant-sandbox-dev/);
  assert.match(template, /\.setUser\('mycc'\)/);
  assert.match(template, /\.setWorkdir\('\/home\/mycc\/workspace'\)/);
  assert.match(template, /\/opt\/mycc\/contracts\/template-contract\.sh --ready/);
});

test('Agent SDK bridge loads Claude native skills from user and project sources', () => {
  const bridge = read('templates/e2b-assistant-sandbox/scripts/agent-sdk-bridge.mjs');

  assert.match(bridge, /const DEFAULT_MODEL = 'claude-opus-4-7'/);
  assert.match(bridge, /'claude-opus-4\.7': 'claude-opus-4-7'/);
  assert.match(bridge, /MYCC_AGENT_SDK_SETTING_SOURCES \|\| 'user,project'/);
  assert.match(bridge, /MYCC_AGENT_SDK_SKILLS \|\| 'all'/);
  assert.match(bridge, /settingSources,\s+skills,/);
  assert.doesNotMatch(bridge, /settingSources:\s*\[\]/);
});

test('template contract covers runtime, browser automation, desktop, and service scripts', () => {
  const contract = read('templates/e2b-assistant-sandbox/contracts/template-contract.sh');

  for (const expected of [
    'code-server',
    'claude',
    'ccr',
    'node',
    'npm',
    'python3',
    'pip',
    'uv',
    'rg',
    'jq',
    'git',
    'gcc',
    'make',
    'Xvfb',
    'xfwm4',
    'startxfce4',
    'x11vnc',
    'websockify',
    'dbus-launch',
    'xdpyinfo',
    'chromium',
    'xdg-open',
    'x-www-browser',
    'sensible-browser',
    'exo-open',
    'mycc-browser',
    'mycc-start-code-server',
    'mycc-start-ccr',
    'mycc-start-desktop',
    'mycc-health-desktop',
    'mycc-register-deliverable',
  ]) {
    assert.match(contract, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(contract, /import browser_use/);
  assert.match(contract, /import playwright/);
  assert.match(contract, /mycc-python-ok/);
  assert.match(contract, /mycc-node-ok/);
  assert.match(contract, /mycc-browser-use-ok/);
  assert.match(contract, /timeout 30s .*claude/);
  assert.match(contract, /timeout 30s ccr -h/);
  assert.match(contract, /timeout 30s .*chromium/);
  assert.match(contract, /timeout 30s .*mycc-browser --version/);
  assert.match(contract, /WebBrowser=mycc-browser/);
  assert.match(contract, /mycc-browser\.desktop/);
  assert.match(contract, /\/usr\/share\/xfce4\/helpers\/mycc-browser\.desktop/);
  assert.match(contract, /x-scheme-handler\/http=mycc-browser\.desktop/);
  assert.doesNotMatch(contract, /mycc-open-browser/);
  assert.match(contract, /mycc-register-deliverable/);
  assert.match(contract, /deliverables\.json/);
  assert.match(contract, /\.mycc-preload-skills\.json/);
  assert.match(contract, /jq -r '\.skills\[\]\.id/);
  assert.doesNotMatch(contract, /for skill in browser-use browser pdf/);
});

test('assistant sandbox includes the MyCC base skill set', () => {
  for (const skillId of imagePreloadSkillIds()) {
    const skillPath = path.join(root, 'templates/e2b-assistant-sandbox/skills', skillId, 'SKILL.md');
    assert.ok(existsSync(skillPath), `${skillId} should be available in the assistant sandbox`);
  }
});

test('base skill sync script mirrors registry image preload skills', () => {
  const syncScript = read('scripts/sync-base-skills.mjs');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mycc-skill-sync-'));
  const catalogRoot = path.join(tempDir, 'catalog');
  const targetRoot = path.join(tempDir, 'sandbox-skills');
  const preloadSkills = imagePreloadSkills();
  const preloadIds = preloadSkills.map((skill) => skill.id);

  assert.match(syncScript, /image-preload-skills\.json/);
  assert.match(syncScript, /\.mycc-preload-skills\.json/);
  assert.match(syncScript, /Missing sandbox skill/);
  assert.doesNotMatch(syncScript, /const baseSkillIds = \[/);

  for (const { id: skillId, source } of preloadSkills) {
    if (source === 'sandbox') {
      const targetDir = path.join(targetRoot, skillId);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'SKILL.md'), `# ${skillId}\n`);
      continue;
    }
    const sourceDir = path.join(catalogRoot, skillId);
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), `# ${skillId}\n`);
  }

  execFileSync('node', ['scripts/sync-base-skills.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      MYCC_SKILL_CATALOG_ROOT: catalogRoot,
      MYCC_SANDBOX_SKILLS_ROOT: targetRoot,
    },
    stdio: 'pipe',
  });

  const generatedManifest = JSON.parse(
    fs.readFileSync(path.join(targetRoot, '.mycc-preload-skills.json'), 'utf8')
  );
  assert.deepEqual(generatedManifest.skills, preloadSkills);

  for (const skillId of preloadIds) {
    assert.ok(
      existsSync(path.join(targetRoot, skillId, 'SKILL.md')),
      `${skillId} should be copied from the catalog`
    );
  }
});

test('template contract exits after fast ready checks', () => {
  const contract = read('templates/e2b-assistant-sandbox/contracts/template-contract.sh');

  assert.match(
    contract,
    /if \[ "\$ready_only" -eq 1 \]; then\s+finish_contract\s+exit 0\s+fi/
  );
});

test('service scripts keep secrets out of argv and expose stable ports', () => {
  const startCcr = read('templates/e2b-assistant-sandbox/bin/mycc-start-ccr');
  const startCodeServer = read('templates/e2b-assistant-sandbox/bin/mycc-start-code-server');
  const startDesktop = read('templates/e2b-assistant-sandbox/bin/mycc-start-desktop');
  const healthDesktop = read('templates/e2b-assistant-sandbox/bin/mycc-health-desktop');
  const browserWrapper = read('templates/e2b-assistant-sandbox/bin/mycc-browser');
  const browserUseSkill = read('templates/e2b-assistant-sandbox/skills/browser-use/SKILL.md');
  const registerDeliverable = read('templates/e2b-assistant-sandbox/bin/mycc-register-deliverable');
  const workspaceClaude = read('../mycc-backend/templates/user-workspace/CLAUDE.md');

  assert.match(startCcr, /MYCC_CCR_PORT/);
  assert.match(startCcr, /MYCC_CCR_CONFIG_DIR/);
  assert.match(startCcr, /MYCC_CCR_PROVIDER_NAME="\$\{MYCC_CCR_PROVIDER_NAME:-zhuji\}"/);
  assert.match(startCcr, /MYCC_CCR_MODEL="\$\{MYCC_CCR_MODEL:-claude-opus-4-7\}"/);
  assert.match(startCcr, /const providerName = process\.env\.MYCC_CCR_PROVIDER_NAME \|\| 'zhuji'/);
  assert.match(startCcr, /'claude-opus-4\.7': 'claude-opus-4-7'/);
  assert.match(startCcr, /const rawModel = process\.env\.MYCC_CCR_MODEL \|\| 'claude-opus-4-7'/);
  assert.doesNotMatch(startCcr, /echo .*TOKEN/i);
  assert.doesNotMatch(startCcr, /echo .*KEY/i);

  assert.match(startCodeServer, /MYCC_CODE_SERVER_PORT/);
  assert.match(startCodeServer, /--auth none/);
  assert.match(startCodeServer, /\/home\/mycc\/workspace/);

  assert.match(startDesktop, /MYCC_DESKTOP_NOVNC_PORT/);
  assert.match(startDesktop, /MYCC_DESKTOP_NOVNC_HOST/);
  assert.match(startDesktop, /MYCC_DESKTOP_RESOLUTION="\$\{MYCC_DESKTOP_RESOLUTION:-1440x900\}"/);
  assert.match(startDesktop, /MYCC_DESKTOP_MODE="\$\{MYCC_DESKTOP_MODE:-browser-only\}"/);
  assert.match(startDesktop, /MYCC_DESKTOP_OPEN_BROWSER="\$\{MYCC_DESKTOP_OPEN_BROWSER:-1\}"/);
  assert.match(startDesktop, /MYCC_DESKTOP_START_URL="\$\{MYCC_DESKTOP_START_URL:-about:blank\}"/);
  assert.match(startDesktop, /MYCC_DESKTOP_BROWSER_WINDOW_SIZE="\$\{MYCC_DESKTOP_BROWSER_WINDOW_SIZE:-\$\{MYCC_DESKTOP_RESOLUTION\/x\/,\}\}"/);
  assert.match(startDesktop, /0\.0\.0\.0/);
  assert.match(startDesktop, /MYCC_DESKTOP_VNC_PORT/);
  assert.match(startDesktop, /MYCC_DESKTOP_DISPLAY/);
  assert.match(startDesktop, /browser-only\|browser/);
  assert.match(startDesktop, /xfwm4 --replace --compositor=off/);
  assert.match(startDesktop, /xfce\|desktop/);
  assert.match(startDesktop, /startxfce4/);
  assert.match(startDesktop, /mycc-browser "\$MYCC_DESKTOP_START_URL"/);
  assert.match(startDesktop, /websockify/);
  assert.match(startDesktop, /websockify\.log/);
  assert.match(startDesktop, /websockify_pid=/);
  assert.match(startDesktop, /wait "\$websockify_pid"/);
  assert.doesNotMatch(startDesktop, /trap cleanup EXIT/);
  assert.match(startDesktop, /x11vnc/);
  assert.doesNotMatch(startDesktop, /chromium/);

  assert.match(healthDesktop, /\/websockify/);
  assert.match(healthDesktop, /Sec-WebSocket-Key/);
  assert.match(healthDesktop, /payload\.startswith\(b"RFB "\)/);

  assert.match(browserWrapper, /chromium/);
  assert.match(browserWrapper, /--no-sandbox/);
  assert.match(browserWrapper, /--disable-dev-shm-usage/);
  assert.match(browserWrapper, /--password-store=basic/);
  assert.match(browserWrapper, /--start-maximized/);
  assert.match(browserWrapper, /MYCC_DESKTOP_BROWSER_CDP_HOST="\$\{MYCC_DESKTOP_BROWSER_CDP_HOST:-127\.0\.0\.1\}"/);
  assert.match(browserWrapper, /MYCC_DESKTOP_BROWSER_CDP_PORT="\$\{MYCC_DESKTOP_BROWSER_CDP_PORT:-9222\}"/);
  assert.match(browserWrapper, /--remote-debugging-address="\$MYCC_DESKTOP_BROWSER_CDP_HOST"/);
  assert.match(browserWrapper, /--remote-debugging-port="\$MYCC_DESKTOP_BROWSER_CDP_PORT"/);
  assert.match(browserWrapper, /MYCC_DESKTOP_BROWSER_WINDOW_SIZE="\$\{MYCC_DESKTOP_BROWSER_WINDOW_SIZE:-1440,900\}"/);
  assert.match(browserWrapper, /MYCC_DESKTOP_CHROMIUM_PROFILE/);

  assert.match(browserUseSkill, /`baidu` or `百度`/);
  assert.match(browserUseSkill, /https:\/\/www\.baidu\.com\//);
  assert.match(browserUseSkill, /exo-open --launch WebBrowser/);
  assert.match(browserUseSkill, /visible CC computer browser/i);
  assert.match(browserUseSkill, /127\.0\.0\.1:9222/);
  assert.match(browserUseSkill, /do not launch a hidden Chrome for Testing/i);
  assert.match(browserUseSkill, /MYCC_DESKTOP_BROWSER_WINDOW_SIZE:-1440,900/);
  assert.doesNotMatch(browserUseSkill, /chromium --no-sandbox/);
  assert.doesNotMatch(browserUseSkill, /mycc-open-browser/);

  assert.match(workspaceClaude, /CC 的电脑/);
  assert.match(workspaceClaude, /可见浏览器/);
  assert.match(workspaceClaude, /不要.*隐藏.*浏览器/);

  assert.match(registerDeliverable, /deliverables\.json/);
  assert.match(registerDeliverable, /allowedKinds/);
  assert.match(registerDeliverable, /secretWords/);
  assert.doesNotMatch(registerDeliverable, /console\.log/);
});

test('deliverable registry helper writes safe entries and rejects secret-looking input', () => {
  const helperPath = path.join(root, 'templates/e2b-assistant-sandbox/bin/mycc-register-deliverable');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mycc-deliverables-'));

  try {
    const output = execFileSync(process.execPath, [
      helperPath,
      '--workspace',
      workspace,
      '--path',
      '/reports/summary.md',
      '--title',
      'Summary report',
      '--kind',
      'report',
      '--description',
      'Useful project summary',
    ], { encoding: 'utf8' });
    const entry = JSON.parse(output);
    assert.equal(entry.path, '/reports/summary.md');

    const registry = JSON.parse(readFileSync(path.join(workspace, '.mycc/deliverables.json'), 'utf8'));
    assert.equal(registry.deliverables[0].title, 'Summary report');

    assert.throws(() => execFileSync(process.execPath, [
      helperPath,
      '--workspace',
      workspace,
      '--path',
      '/reports/token-leak.md',
      '--title',
      'Token leak',
      '--kind',
      'report',
    ], { encoding: 'utf8', stdio: 'pipe' }));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('create script uses the assistant sandbox template name and full ready contract', () => {
  const createScript = read('scripts/create-template.sh');

  assert.match(createScript, /MYCC_SANDBOX_TEMPLATE/);
  assert.match(createScript, /mycc-assistant-sandbox-dev/);
  assert.match(createScript, /template create/);
  assert.match(createScript, /template-contract\.sh --ready/);
  assert.match(createScript, /E2B_ACCESS_TOKEN/);
});

test('package exposes local and E2B smoke checks', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.scripts['smoke:local-contract'], 'node scripts/smoke-local-contract.mjs');
  assert.equal(packageJson.scripts['smoke:e2b-template'], 'node scripts/smoke-e2b-template.mjs');
  assert.equal(packageJson.scripts['smoke:e2b-agent-browser'], 'node scripts/smoke-e2b-agent-browser.mjs');
});

test('E2B smoke checks runtime services without exposing raw sandbox access', () => {
  const smoke = read('scripts/smoke-e2b-template.mjs');

  assert.match(smoke, /Sandbox\.create/);
  assert.match(smoke, /allowPublicTraffic:\s*false/);
  assert.match(smoke, /template-contract\.sh --full/);
  assert.match(smoke, /mycc-start-code-server/);
  assert.match(smoke, /mycc-start-desktop/);
  assert.match(smoke, /mycc-health-desktop/);
  assert.match(smoke, /desktop-browser-only-mode/);
  assert.match(smoke, /pgrep -af "\[x\]fwm4"/);
  assert.match(smoke, /pgrep -af "\[c\]hromium\.\*--password-store=basic\.\*--remote-debugging-address=127\.0\.0\.1\.\*--remote-debugging-port=9222"/);
  assert.match(smoke, /pgrep -af "\[x\]fce4-panel"/);
  assert.match(smoke, /DISPLAY=:99/);
  assert.match(smoke, /MYCC_DESKTOP_CHROMIUM_PROFILE=\/tmp\/mycc-desktop\/chromium-profile-smoke/);
  assert.match(smoke, /MYCC_DESKTOP_BROWSER_WINDOW_SIZE=1360,820/);
  assert.match(smoke, /MYCC_DESKTOP_BROWSER_CDP_PORT=9233/);
  assert.match(smoke, /exo-open --launch WebBrowser about:blank/);
  assert.match(smoke, /pgrep -af "\[c\]hromium\.\*--password-store=basic\.\*--remote-debugging-port=9233\.\*chromium-profile-smoke"/);
  assert.match(smoke, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(smoke, /--remote-debugging-port=9222/);
  assert.match(smoke, /127\.0\.0\.1:9222\/json\/version/);
  assert.match(smoke, /127\.0\.0\.1:9233\/json\/version/);
  assert.doesNotMatch(smoke, /chromium-smoke\.log 2>&1 &'/);
  assert.doesNotMatch(smoke, /&;\s*for/);
  assert.match(smoke, /playwright/);
  assert.match(smoke, /onStdout/);
  assert.match(smoke, /onStderr/);
  assert.match(smoke, /redacted-secret/);
  assert.doesNotMatch(smoke, /\.getHost\(/);
  assert.doesNotMatch(smoke, /trafficAccessToken/);
});

test('E2B agent browser smoke verifies Claude opens the mirrored browser safely', () => {
  const smoke = read('scripts/smoke-e2b-agent-browser.mjs');

  assert.match(smoke, /MYCC_AGENT_SDK_SKILLS/);
  assert.match(smoke, /user,project/);
  assert.match(smoke, /sawDesktopBrowserToolUse/);
  assert.match(smoke, /exo-open/);
  assert.match(smoke, /mycc-browser/);
  assert.match(smoke, /baidu/);
  assert.match(smoke, /pgrep -af chromium/);
  assert.match(smoke, /allowPublicTraffic:\s*false/);
  assert.match(smoke, /sanitize/);
  assert.doesNotMatch(smoke, /\.getHost\(/);
  assert.doesNotMatch(smoke, /trafficAccessToken/);
});
