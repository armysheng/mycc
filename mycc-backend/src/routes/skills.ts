import { FastifyInstance } from 'fastify';
import { findUserById } from '../db/client.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { createSkillsService, SkillsError } from '../skills/index.js';

const skillsService = createSkillsService();

export async function skillsRoutes(fastify: FastifyInstance) {
  const withUser = async (userId: number) => {
    const user = await findUserById(userId);
    if (!user) {
      throw new SkillsError(404, '用户不存在');
    }
    return user;
  };

  fastify.get('/api/skills', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const user = await withUser(request.user.userId);

      const data = await skillsService.listSkills({
        userId: request.user.userId,
        linuxUser: user.linux_user,
      });

      return reply.send({
        success: true,
        data,
      });
    } catch (err) {
      if (err instanceof SkillsError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: err.message,
        });
      }
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取技能列表失败',
      });
    }
  });

  fastify.post('/api/skills/:skillId/install', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { skillId } = request.params as { skillId: string };
      const user = await withUser(request.user.userId);

      const data = await skillsService.installSkill({
        userId: request.user.userId,
        linuxUser: user.linux_user,
      }, skillId);

      return reply.send({
        success: true,
        data,
      });
    } catch (err) {
      if (err instanceof SkillsError) {
        return reply.status(err.statusCode).send({
          success: false,
          error: err.message,
        });
      }
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '安装技能失败',
      });
    }
  });

  fastify.post('/api/skills/:skillId/upgrade', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { skillId } = request.params as { skillId: string };
      const user = await withUser(request.user.userId);
      const data = await skillsService.upgradeSkill({
        userId: request.user.userId,
        linuxUser: user.linux_user,
      }, skillId);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof SkillsError) {
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      }
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '升级技能失败',
      });
    }
  });

  fastify.post('/api/skills/:skillId/enable', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { skillId } = request.params as { skillId: string };
      const user = await withUser(request.user.userId);
      const data = await skillsService.enableSkill({
        userId: request.user.userId,
        linuxUser: user.linux_user,
      }, skillId);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof SkillsError) {
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      }
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '启用技能失败',
      });
    }
  });

  fastify.post('/api/skills/:skillId/disable', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { skillId } = request.params as { skillId: string };
      const user = await withUser(request.user.userId);
      const data = await skillsService.disableSkill({
        userId: request.user.userId,
        linuxUser: user.linux_user,
      }, skillId);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof SkillsError) {
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      }
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '禁用技能失败',
      });
    }
  });
}
