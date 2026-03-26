export type PlanId = 'free' | 'basic' | 'pro';

export const PLAN_ORDER: Record<PlanId, number> = {
  free: 0,
  basic: 1,
  pro: 2,
};

export const UPGRADABLE_PLAN_IDS = ['basic', 'pro'] as const;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  monthlyPriceCny: number;
  tokensLimit: number;
  highlights: string[];
  isRecommended?: boolean;
}

export interface PlanView extends PlanDefinition {
  estimatedDeepTasks: number;
  cnyPer1kTokens: number;
  tokensPerCny: number;
}

function toInt(envValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(envValue || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPrice(envValue: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(envValue || '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getPlanCatalog(): PlanDefinition[] {
  const freeTokens = toInt(process.env.PLAN_FREE_TOKENS, 300000);
  const basicTokens = toInt(process.env.PLAN_BASIC_TOKENS, 3000000);
  const proTokens = toInt(process.env.PLAN_PRO_TOKENS, 12000000);

  const basicPrice = toPrice(process.env.PLAN_BASIC_PRICE_CNY, 39);
  const proPrice = toPrice(process.env.PLAN_PRO_PRICE_CNY, 99);

  return [
    {
      id: 'free',
      name: '免费版',
      description: '轻度体验，适合偶尔使用',
      monthlyPriceCny: 0,
      tokensLimit: freeTokens,
      highlights: ['基础聊天', '基础技能市场浏览'],
    },
    {
      id: 'basic',
      name: '基础版',
      description: '个人高频使用，主打性价比',
      monthlyPriceCny: basicPrice,
      tokensLimit: basicTokens,
      highlights: ['高频日常问答', '技能安装与使用', '优先队列'],
      isRecommended: true,
    },
    {
      id: 'pro',
      name: '专业版',
      description: '重度使用与自动化场景',
      monthlyPriceCny: proPrice,
      tokensLimit: proTokens,
      highlights: ['大额度', '复杂任务与多轮对话', '自动化重度运行'],
    },
  ];
}

export function getPlanById(planId: PlanId, catalog: PlanDefinition[] = getPlanCatalog()): PlanDefinition {
  const found = catalog.find((plan) => plan.id === planId);
  if (!found) {
    throw new Error(`未知套餐: ${planId}`);
  }
  return found;
}

export function toPlanView(plan: PlanDefinition): PlanView {
  const cnyPer1kTokens = plan.monthlyPriceCny > 0
    ? Number((plan.monthlyPriceCny / (plan.tokensLimit / 1000)).toFixed(4))
    : 0;
  const tokensPerCny = plan.monthlyPriceCny > 0
    ? Math.floor(plan.tokensLimit / plan.monthlyPriceCny)
    : 0;
  const estimatedDeepTasks = Math.max(1, Math.floor(plan.tokensLimit / 12000));

  return {
    ...plan,
    estimatedDeepTasks,
    cnyPer1kTokens,
    tokensPerCny,
  };
}

export function comparePlanLevel(a: PlanId, b: PlanId): number {
  return PLAN_ORDER[a] - PLAN_ORDER[b];
}

export function suggestPlan(projectedTokens: number, catalog: PlanDefinition[] = getPlanCatalog()): {
  planId: PlanId;
  reason: string;
} {
  const freePlan = getPlanById('free', catalog);
  const basicPlan = getPlanById('basic', catalog);

  if (projectedTokens <= freePlan.tokensLimit) {
    return {
      planId: 'free',
      reason: '预计月用量仍在免费额度内，可继续使用免费版。',
    };
  }

  if (projectedTokens <= basicPlan.tokensLimit) {
    return {
      planId: 'basic',
      reason: '预计月用量将超出免费额度，基础版是最划算升级档位。',
    };
  }

  return {
    planId: 'pro',
    reason: '预计月用量较高，建议专业版避免频繁触达额度上限。',
  };
}
