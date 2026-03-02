import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'src', 'skills', 'catalog');
const targetDir = path.join(projectRoot, 'dist', 'skills', 'catalog');

async function syncSkillsCatalog() {
  await fs.access(sourceDir);
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
  console.log(`[build] synced skills catalog: ${sourceDir} -> ${targetDir}`);
}

syncSkillsCatalog().catch((error) => {
  console.error('[build] failed to sync skills catalog', error);
  process.exit(1);
});
