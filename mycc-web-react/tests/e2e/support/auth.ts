import { expect, type Page, type Response } from "@playwright/test";
import type { E2EAccount } from "../fixtures/accounts";

export function chatInput(page: Page) {
  return page.getByPlaceholder("输入你的问题，Enter 发送");
}

export async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
}

export async function login(page: Page, account: E2EAccount): Promise<Response> {
  const credentialInput = page.getByPlaceholder("请输入手机号或邮箱");
  await expect(credentialInput).toBeVisible();

  await credentialInput.fill(account.credential);
  await page.getByPlaceholder("请输入密码").fill(account.password);

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/login") &&
      response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "进入工作空间" }).click();
  return loginResponsePromise;
}

export async function maybeSkipOnboarding(page: Page): Promise<void> {
  const overlayTitle = page.getByText("初始化助手");
  const visible = await overlayTitle.isVisible({ timeout: 2_500 }).catch(() => false);

  if (!visible) return;

  const skipButton = page.getByRole("button", { name: "稍后设置，使用默认值" });
  await expect(skipButton).toBeVisible();

  const initResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/onboarding/initialize") &&
      response.request().method() === "POST",
  );
  await skipButton.click();
  const initResponse = await initResponsePromise;
  expect(initResponse.ok()).toBeTruthy();
  await expect(overlayTitle).toBeHidden({ timeout: 20_000 });
}

export async function expectChatReady(page: Page): Promise<void> {
  await expect(chatInput(page)).toBeVisible({ timeout: 20_000 });
}
