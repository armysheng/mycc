import {
  getAuthHeaders,
  getBillingPlansUrl,
  getBillingSubscriptionUrl,
  getBillingUpgradeUrl,
} from "../config/api";

export interface BillingSubscription {
  plan: "free" | "basic" | "pro";
  plan_name: string;
  monthly_price_cny: number;
  tokens_limit: number;
  tokens_used: number;
  tokens_remaining: number;
  usage_percentage: number;
  cny_per_1k_tokens: number;
  estimated_deep_tasks: number;
  reset_at: string;
  expires_at?: string;
}

export interface BillingPlan {
  id: "free" | "basic" | "pro";
  name: string;
  description: string;
  monthly_price_cny: number;
  tokens_limit: number;
  estimated_deep_tasks: number;
  cny_per_1k_tokens: number;
  tokens_per_cny: number;
  highlights: string[];
  is_current: boolean;
  can_upgrade: boolean;
  is_recommended: boolean;
}

export interface BillingPlansResponse {
  currency: string;
  current_plan: "free" | "basic" | "pro";
  projected_monthly_tokens: number;
  recommendation: {
    plan: "free" | "basic" | "pro";
    reason: string;
  };
  plans: BillingPlan[];
}

async function parseJsonOrThrow<T>(response: Response, fallbackError: string): Promise<T> {
  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || fallbackError);
  }
  return data.data as T;
}

export async function getBillingSubscription(token: string): Promise<BillingSubscription> {
  const response = await fetch(getBillingSubscriptionUrl(), {
    headers: getAuthHeaders(token),
  });
  return parseJsonOrThrow<BillingSubscription>(response, "获取订阅信息失败");
}

export async function getBillingPlans(token: string): Promise<BillingPlansResponse> {
  const response = await fetch(getBillingPlansUrl(), {
    headers: getAuthHeaders(token),
  });
  return parseJsonOrThrow<BillingPlansResponse>(response, "获取套餐列表失败");
}

export async function upgradePlan(token: string, plan: "basic" | "pro"): Promise<void> {
  const response = await fetch(getBillingUpgradeUrl(), {
    method: "POST",
    headers: getAuthHeaders(token),
    body: JSON.stringify({ plan }),
  });
  await parseJsonOrThrow<Record<string, never>>(response, "升级套餐失败");
}
