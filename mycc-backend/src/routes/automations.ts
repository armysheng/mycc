import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { getSSHPool } from '../ssh/pool.js';
import { findUserById } from '../db/client.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';
import { AutomationStore, AutomationStoreError } from '../automations/store.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../automations/types.js';

const createAutomationSchema = z.object({
  name: z.string().trim().min(1, '任务名不能为空').max(80, '任务名过长'),
  description: z.string().trim().max(500, '描述过长').optional().default(''),
  enabled: z.boolean().optional().default(true),
  trigger: z.object({
    type: z.enum(['cron', 'manual']).default('cron'),
    cron: z.string().trim().max(80, 'cron 过长').optional().default(''),
    timezone: z.string().trim().max(64, '时区过长').optional().default('Asia/Shanghai'),
  }),
  execution: z.object({
    type: z.literal('skill').default('skill'),
    skill: z.string().trim().max(80, 'skill 过长').optional().default('-'),
    prompt: z.string().trim().max(2000, '提示词过长').optional().default(''),
  }),
  delivery: z.object({
    type: z.literal('inbox').default('inbox'),
    enabled: z.boolean().default(true),
  }).optional(),
});

const updateAutomationSchema = z.object({
  name: z.string().trim().min(1, '任务名不能为空').max(80, '任务名过长').optional(),
  description: z.string().trim().max(500, '描述过长').optional(),
  enabled: z.boolean().optional(),
  status: z.enum(['healthy', 'paused', 'error']).optional(),
  trigger: z.object({
    type: z.enum(['cron', 'manual']).optional(),
    cron: z.string().trim().max(80, 'cron 过长').optional(),
    timezone: z.string().trim().max(64, '时区过长').optional(),
  }).optional(),
  execution: z.object({
    type: z.literal('skill').optional(),
    skill: z.string().trim().max(80, 'skill 过长').optional(),
    prompt: z.string().trim().max(2000, '提示词过长').optional(),
  }).optional(),
  delivery: z.object({
    type: z.literal('inbox').optional(),
    enabled: z.boolean().optional(),
  }).optional(),
});

const paramsSchema = z.object({
  id: z.string().trim().min(1, '无效的自动化任务 ID'),
});

function sendAutomationError(reply: { status: (statusCode: number) => { send: (payload: unknown) => unknown } }, err: unknown) {
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      success: false,
      error: '参数错误',
      details: err.errors,
    });
  }
  if (err instanceof AutomationStoreError) {
    return reply.status(err.statusCode).send({
      success: false,
      error: err.message,
    });
  }
  return reply.status(500).send({
    success: false,
    error: err instanceof Error ? err.message : '自动化任务操作失败',
  });
}

export async function automationsRoutes(fastify: FastifyInstance) {
  const withStore = async (
    userId: number,
    handler: (store: AutomationStore) => Promise<unknown>,
  ) => {
    const user = await findUserById(userId);
    if (!user) {
      throw new AutomationStoreError(404, '用户不存在');
    }

    const linuxUser = sanitizeLinuxUsername(user.linux_user);
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();
    try {
      const run = (command: string) => sshPool.exec(connection, command);
      const runAsUser = (command: string) =>
        sshPool.exec(connection, AutomationStore.buildUserCommand(linuxUser, command));
      const store = new AutomationStore(linuxUser, run, runAsUser);
      return await handler(store);
    } finally {
      sshPool.release(connection);
    }
  };

  fastify.get('/api/automations', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }
    try {
      const data = await withStore(request.user.userId, (store) => store.listAutomations());
      return reply.send({
        success: true,
        data,
      });
    } catch (err) {
      return sendAutomationError(reply, err);
    }
  });

  fastify.post('/api/automations', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }
    try {
      const input = createAutomationSchema.parse(request.body) as CreateAutomationInput;
      if (input.trigger.type === 'cron' && !input.trigger.cron) {
        return reply.status(400).send({
          success: false,
          error: 'cron 触发任务必须提供 trigger.cron',
        });
      }
      const automation = await withStore(request.user.userId, (store) => store.createAutomation(input));
      return reply.send({
        success: true,
        data: { automation },
      });
    } catch (err) {
      return sendAutomationError(reply, err);
    }
  });

  fastify.put('/api/automations/:id', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }
    try {
      const { id } = paramsSchema.parse(request.params);
      const patch = updateAutomationSchema.parse(request.body) as UpdateAutomationInput;
      if (patch.trigger?.type === 'cron' && patch.trigger.cron !== undefined && !patch.trigger.cron.trim()) {
        return reply.status(400).send({
          success: false,
          error: 'cron 触发任务的 trigger.cron 不能为空',
        });
      }
      const automation = await withStore(request.user.userId, (store) => store.updateAutomation(id, patch));
      return reply.send({
        success: true,
        data: { automation },
      });
    } catch (err) {
      return sendAutomationError(reply, err);
    }
  });

  fastify.delete('/api/automations/:id', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }
    try {
      const { id } = paramsSchema.parse(request.params);
      await withStore(request.user.userId, (store) => store.deleteAutomation(id));
      return reply.send({
        success: true,
        data: { deleted: true },
      });
    } catch (err) {
      return sendAutomationError(reply, err);
    }
  });

  fastify.post('/api/automations/:id/enable', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }
    try {
      const { id } = paramsSchema.parse(request.params);
      const automation = await withStore(request.user.userId, (store) => store.setEnabled(id, true));
      return reply.send({
        success: true,
        data: { automation },
      });
    } catch (err) {
      return sendAutomationError(reply, err);
    }
  });

  fastify.post('/api/automations/:id/disable', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }
    try {
      const { id } = paramsSchema.parse(request.params);
      const automation = await withStore(request.user.userId, (store) => store.setEnabled(id, false));
      return reply.send({
        success: true,
        data: { automation },
      });
    } catch (err) {
      return sendAutomationError(reply, err);
    }
  });

  fastify.post('/api/automations/:id/run', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }
    try {
      const { id } = paramsSchema.parse(request.params);
      const result = await withStore(request.user.userId, (store) => store.runOnce(id));
      return reply.send({
        success: true,
        data: result,
      });
    } catch (err) {
      return sendAutomationError(reply, err);
    }
  });
}
