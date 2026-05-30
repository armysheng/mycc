export function shouldInitializeSshAtStartup(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.MYCC_SKIP_SSH_STARTUP_CHECK || '').trim() === 'true') {
    return false;
  }

  const runtime = (env.MYCC_AGENT_RUNTIME || 'remote-claude').trim();
  const ideProvider = (env.MYCC_IDE_PROVIDER || 'disabled').trim();
  const workspaceProvider = (env.MYCC_WORKSPACE_PROVIDER || 'ssh').trim();

  return !(runtime === 'e2b-claude-agent-sdk' && ideProvider === 'e2b' && workspaceProvider === 'e2b');
}
