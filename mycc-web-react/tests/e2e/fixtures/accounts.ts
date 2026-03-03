import type { TestInfo } from "@playwright/test";

export interface E2EAccount {
  credential: string;
  password: string;
}

const CASE_ID_PATTERN = /\b([A-Z]+-\d{3})\b/;

function toEnvCaseId(caseId: string): string {
  return caseId.replace(/-/g, "_");
}

function parseCaseId(testInfo: TestInfo): string {
  const joined = testInfo.titlePath.join(" ");
  const matched = joined.match(CASE_ID_PATTERN);
  if (!matched?.[1]) {
    throw new Error(
      `未在测试标题中找到用例 ID（格式如 RECENT-001）。当前标题：${testInfo.title}`,
    );
  }
  return matched[1];
}

function fromCaseEnv(caseId: string): E2EAccount | null {
  const envCaseId = toEnvCaseId(caseId);
  const credential = process.env[`E2E_ACCOUNT_${envCaseId}_CREDENTIAL`];
  const password = process.env[`E2E_ACCOUNT_${envCaseId}_PASSWORD`];
  if (credential && password) {
    return { credential, password };
  }
  return null;
}

function fromSharedEnv(): E2EAccount | null {
  const credential = process.env.E2E_SHARED_CREDENTIAL;
  const password = process.env.E2E_SHARED_PASSWORD;
  if (credential && password) {
    return { credential, password };
  }
  return null;
}

export function resolveCaseAccount(testInfo: TestInfo): E2EAccount {
  const caseId = parseCaseId(testInfo);
  const strictCaseAccount = process.env.E2E_ALLOW_SHARED_ACCOUNT !== "1";

  const caseAccount = fromCaseEnv(caseId);
  if (caseAccount) {
    return caseAccount;
  }

  if (!strictCaseAccount) {
    const shared = fromSharedEnv();
    if (shared) return shared;
  }

  const envCaseId = toEnvCaseId(caseId);
  throw new Error(
    `缺少独立测试账号：请设置 E2E_ACCOUNT_${envCaseId}_CREDENTIAL 和 E2E_ACCOUNT_${envCaseId}_PASSWORD。`,
  );
}
