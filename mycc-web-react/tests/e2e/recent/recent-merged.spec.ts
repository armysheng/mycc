import { test, expect } from "../fixtures/test";
import { chatInput, expectChatReady, gotoHome, login, maybeSkipOnboarding } from "../support/auth";

test("[RECENT-001] 403 会话无权限时自动清理 session 并重试一次", async ({ page, account }) => {
  await gotoHome(page);
  expect((await login(page, account)).status()).toBe(200);
  await maybeSkipOnboarding(page);
  await expectChatReady(page);

  await page.route("**/api/chat/sessions/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { messages: [] } }),
    });
  });

  await page.goto("/?sessionId=e2e-forbidden-session");
  await expectChatReady(page);

  const requests: Array<Record<string, unknown>> = [];
  let attempt = 0;

  await page.route("**/api/chat", async (route) => {
    attempt += 1;
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(payload);

    if (attempt === 1) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "无权访问该会话" }),
      });
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "e2e forced stop after retry" }),
    });
  });

  await chatInput(page).fill("e2e recent forbidden retry");
  await page.getByRole("button", { name: /发送|规划/ }).click();

  await expect.poll(() => attempt, { timeout: 15_000 }).toBe(2);
  await expect.poll(() => new URL(page.url()).search, { timeout: 10_000 }).toBe("");

  expect(requests[0]?.sessionId).toBe("e2e-forbidden-session");
  expect(requests[1]?.sessionId).toBeUndefined();
});

test("[RECENT-002] 安装+升级接口不再返回“技能不存在于目录中”", async ({
  page,
  account,
  request,
}) => {
  await gotoHome(page);
  expect((await login(page, account)).status()).toBe(200);
  await maybeSkipOnboarding(page);
  await expectChatReady(page);

  const token = await page.evaluate(() => localStorage.getItem("token"));
  expect(token).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };

  const listRes = await request.get("/api/skills", { headers });
  expect(listRes.status()).toBe(200);
  const listJson = await listRes.json();
  const skills = (listJson?.data?.skills || []) as Array<{ id: string; installed?: boolean }>;
  const candidate = skills.find((s) => !s.installed) ?? skills[0];
  expect(candidate?.id).toBeTruthy();
  const skillId = candidate.id;

  const installRes = await request.post(`/api/skills/${encodeURIComponent(skillId)}/install`, {
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    data: {},
  });
  const installBody = await installRes.text();
  expect(installRes.status()).toBe(200);
  expect(installBody).not.toContain("技能不存在于目录中");

  const upgradeRes = await request.post(`/api/skills/${encodeURIComponent(skillId)}/upgrade`, {
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    data: {},
  });
  const upgradeBody = await upgradeRes.text();
  expect(upgradeRes.status()).toBe(200);
  expect(upgradeBody).not.toContain("技能不存在于目录中");
});
