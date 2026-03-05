const ONBOARDING_BOOTSTRAP_PENDING_KEY = "mycc_onboarding_bootstrap_pending";
const ONBOARDING_BOOTSTRAP_PENDING_EVENT = "mycc:onboarding-bootstrap-pending";

export function getOnboardingBootstrapPending(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(ONBOARDING_BOOTSTRAP_PENDING_KEY) === "1";
}

export function setOnboardingBootstrapPending(pending: boolean): void {
  if (typeof window === "undefined") return;
  if (pending) {
    window.sessionStorage.setItem(ONBOARDING_BOOTSTRAP_PENDING_KEY, "1");
  } else {
    window.sessionStorage.removeItem(ONBOARDING_BOOTSTRAP_PENDING_KEY);
  }
  window.dispatchEvent(
    new CustomEvent(ONBOARDING_BOOTSTRAP_PENDING_EVENT, {
      detail: { pending },
    }),
  );
}

export function subscribeOnboardingBootstrapPending(
  onChange: (pending: boolean) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ pending?: boolean }>).detail;
    onChange(Boolean(detail?.pending));
  };
  window.addEventListener(ONBOARDING_BOOTSTRAP_PENDING_EVENT, handler);
  return () => {
    window.removeEventListener(ONBOARDING_BOOTSTRAP_PENDING_EVENT, handler);
  };
}
