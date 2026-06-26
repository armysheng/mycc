import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStaticAgentEvalSuite } from '../src/harness/index.js';

async function main() {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = path.resolve(backendRoot, '..');
  const evalRoot = path.join(repoRoot, 'evals', 'agent');
  const suite = await runStaticAgentEvalSuite(evalRoot);

  console.log(JSON.stringify(suite, null, 2));

  if (!suite.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
