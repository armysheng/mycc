import { test as base } from "@playwright/test";
import type { E2EAccount } from "./accounts";
import { resolveCaseAccount } from "./accounts";

type Fixtures = {
  account: E2EAccount;
};

export const test = base.extend<Fixtures>({
  account: async ({}, use, testInfo) => {
    await use(resolveCaseAccount(testInfo));
  },
});

export { expect } from "@playwright/test";
