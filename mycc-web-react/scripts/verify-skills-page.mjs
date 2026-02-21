import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_URL = 'http://127.0.0.1:3000/';
const API_URL = 'http://127.0.0.1:8080';
const USER = '+8613800138000';
const PASS = 'test123456';
const countFromTab = (label) => {
  const m = label.match(/\((\d+)\)/);
  return m ? Number(m[1]) : 0;
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(__dirname, '../../output/playwright');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await mkdir(screenshotDir, { recursive: true });
  const loginRes = await context.request.post(`${API_URL}/api/auth/login`, {
    data: { credential: USER, password: PASS },
    timeout: 30000,
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok() || !loginJson?.success || !loginJson?.data?.token) {
    throw new Error(`登录失败: ${JSON.stringify(loginJson)}`);
  }

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((token) => {
    localStorage.setItem('token', token);
  }, loginJson.data.token);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.locator('aside').getByRole('button', { name: '技能', exact: true }).click({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Skills' }).waitFor({ timeout: 30000 });

  const loading = page.getByText('加载中...');
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  }

  const errorBanners = page.locator('text=/系统错误：/');
  const errorCount = await errorBanners.count();
  const errors = [];
  for (let i = 0; i < errorCount; i += 1) {
    errors.push((await errorBanners.nth(i).innerText()).trim());
  }

  const installedTabButton = page.getByRole('button', { name: /已安装/ });
  const marketTabButton = page.getByRole('button', { name: /市场/ });
  const installedTab = (await installedTabButton.innerText()).trim();
  const marketTab = (await marketTabButton.innerText()).trim();
  const installedBefore = countFromTab(installedTab);

  await marketTabButton.click();
  await page.waitForTimeout(800);
  const marketCards = await page.locator('article').count();
  const marketCountMatch = marketTab.match(/\((\d+)\)/);
  const marketCount = marketCountMatch ? Number(marketCountMatch[1]) : 0;

  if (marketCount > 0 && marketCards === 0) {
    errors.push(`市场计数为 ${marketCount}，但卡片为 0`);
  }

  let installTried = false;
  if (marketCards > 0) {
    const installButton = page.locator('article button', { hasText: '安装' }).first();
    if (await installButton.isVisible().catch(() => false)) {
      installTried = true;
      await installButton.click();
      let installedAfter = installedBefore;
      for (let i = 0; i < 24; i += 1) {
        await page.waitForTimeout(1000);
        const label = (await installedTabButton.innerText()).trim();
        installedAfter = countFromTab(label);
        if (installedAfter > installedBefore) break;
      }
      if (installedAfter <= installedBefore) {
        errors.push('点击安装后，已安装数量未增加');
      }
    }
  }

  if (!installTried && marketCount > 0) {
    errors.push('市场存在技能，但未找到可点击的安装按钮');
  }

  await installedTabButton.click();
  await page.waitForTimeout(800);
  const installedCards = await page.locator('article').count();

  const screenshotPath = path.join(screenshotDir, 'e2e-skills-after-fix.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const result = {
    installedTab,
    marketTab,
    installedCards,
    marketCards,
    errors,
    screenshotPath,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exitCode = 1;
  }
} catch (err) {
  const failPath = path.join(screenshotDir, 'e2e-skills-after-fix-fail.png');
  await page.screenshot({ path: failPath, fullPage: true }).catch(() => {});
  console.error(`FAILED_SCREENSHOT=${failPath}`);
  throw err;
} finally {
  await browser.close();
}
