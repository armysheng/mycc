import { FastifyInstance } from 'fastify';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { getSubscription, getUsageStats, upgradePlan } from '../db/client.js';
import { z } from 'zod';
import {
  comparePlanLevel,
  getPlanById,
  getPlanCatalog,
  suggestPlan,
  toPlanView,
  type PlanId,
  UPGRADABLE_PLAN_IDS,
} from '../billing/plan-catalog.js';

// 升级套餐请求验证
const upgradePlanSchema = z.object({
  plan: z.enum(UPGRADABLE_PLAN_IDS),
});

function estimateProjectedMonthlyTokens(tokensUsed: number, resetAt: Date): number {
  const now = Date.now();
  const reset = new Date(resetAt);
  const cycleStart = new Date(reset);
  cycleStart.setMonth(cycleStart.getMonth() - 1);

  const elapsedMs = Math.max(1, now - cycleStart.getTime());
  const cycleMs = Math.max(elapsedMs, reset.getTime() - cycleStart.getTime());
  const projected = Math.ceil(tokensUsed * (cycleMs / elapsedMs));
  return Math.max(tokensUsed, projected);
}

export async function billingRoutes(fastify: FastifyInstance) {
  // GET /api/billing/plans - 获取套餐目录与推荐
  fastify.get('/api/billing/plans', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const subscription = await getSubscription(request.user.userId);
      if (!subscription) {
        return reply.status(404).send({
          success: false,
          error: '订阅信息不存在',
        });
      }

      const catalog = getPlanCatalog();
      const currentPlan = getPlanById(subscription.plan as PlanId, catalog);
      const projectedMonthlyTokens = estimateProjectedMonthlyTokens(
        subscription.tokens_used,
        new Date(subscription.reset_at)
      );
      const recommendation = suggestPlan(projectedMonthlyTokens, catalog);

      const plans = catalog.map((plan) => {
        const view = toPlanView(plan);
        return {
          id: view.id,
          name: view.name,
          description: view.description,
          monthly_price_cny: view.monthlyPriceCny,
          tokens_limit: view.tokensLimit,
          estimated_deep_tasks: view.estimatedDeepTasks,
          cny_per_1k_tokens: view.cnyPer1kTokens,
          tokens_per_cny: view.tokensPerCny,
          highlights: view.highlights,
          is_current: view.id === currentPlan.id,
          can_upgrade: comparePlanLevel(view.id, currentPlan.id) > 0,
          is_recommended: Boolean(view.isRecommended),
        };
      });

      return reply.send({
        success: true,
        data: {
          currency: 'CNY',
          current_plan: currentPlan.id,
          projected_monthly_tokens: projectedMonthlyTokens,
          recommendation: {
            plan: recommendation.planId,
            reason: recommendation.reason,
          },
          plans,
        },
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取套餐列表失败',
      });
    }
  });

  // GET /api/billing/subscription - 获取订阅信息
  fastify.get('/api/billing/subscription', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const subscription = await getSubscription(request.user.userId);

      if (!subscription) {
        return reply.status(404).send({
          success: false,
          error: '订阅信息不存在',
        });
      }

      const planView = toPlanView(getPlanById(subscription.plan as PlanId));
      const usagePercentage = subscription.tokens_limit > 0
        ? Number(((subscription.tokens_used / subscription.tokens_limit) * 100).toFixed(1))
        : 0;

      return reply.send({
        success: true,
        data: {
          plan: subscription.plan,
          plan_name: planView.name,
          monthly_price_cny: planView.monthlyPriceCny,
          tokens_limit: subscription.tokens_limit,
          tokens_used: subscription.tokens_used,
          tokens_remaining: subscription.tokens_limit - subscription.tokens_used,
          usage_percentage: usagePercentage,
          cny_per_1k_tokens: planView.cnyPer1kTokens,
          estimated_deep_tasks: planView.estimatedDeepTasks,
          reset_at: subscription.reset_at,
          expires_at: subscription.expires_at,
        },
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取订阅信息失败',
      });
    }
  });

  // GET /api/billing/usage - 获取使用量统计
  fastify.get('/api/billing/usage', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };

      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? new Date(endDate) : undefined;

      const stats = await getUsageStats(request.user.userId, start, end);

      // 计算总计
      const total = stats.reduce((acc, item) => ({
        tokens: acc.tokens + parseInt(item.tokens as any),
        cost: acc.cost + parseFloat(item.cost as any),
      }), { tokens: 0, cost: 0 });

      return reply.send({
        success: true,
        data: {
          daily: stats,
          total,
        },
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取使用统计失败',
      });
    }
  });

  // POST /api/billing/upgrade - 升级套餐
  fastify.post('/api/billing/upgrade', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const body = upgradePlanSchema.parse(request.body);

      // 检查当前套餐
      const currentSubscription = await getSubscription(request.user.userId);
      if (!currentSubscription) {
        return reply.status(404).send({
          success: false,
          error: '订阅信息不存在',
        });
      }

      // 检查是否降级（不允许）
      if (comparePlanLevel(body.plan, currentSubscription.plan as PlanId) <= 0) {
        return reply.status(400).send({
          success: false,
          error: '不支持降级或重复升级',
        });
      }

      // 执行升级
      await upgradePlan(request.user.userId, body.plan);

      // 获取新的订阅信息
      const newSubscription = await getSubscription(request.user.userId);
      const targetPlan = getPlanById(body.plan);

      return reply.send({
        success: true,
        data: {
          plan: newSubscription?.plan,
          plan_name: targetPlan.name,
          monthly_price_cny: targetPlan.monthlyPriceCny,
          tokens_limit: newSubscription?.tokens_limit,
          expires_at: newSubscription?.expires_at,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '升级套餐失败',
      });
    }
  });

  // GET /api/billing/stats - 获取并发统计（管理员）
  fastify.get('/api/billing/stats', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    // 简单的管理员检查（可以改进）
    if (request.user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: '需要管理员权限',
      });
    }

    try {
      const { concurrencyLimiter } = await import('../concurrency-limiter.js');
      const stats = concurrencyLimiter.getStats();

      return reply.send({
        success: true,
        data: stats,
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取统计失败',
      });
    }
  });
}
