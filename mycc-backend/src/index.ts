import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { billingRoutes } from './routes/billing.js';
import { skillsRoutes } from './routes/skills.js';
import { automationsRoutes } from './routes/automations.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { pool } from './db/client.js';
import { initSSHPool, getSSHPool } from './ssh/pool.js';
import type { SSHConfig } from './ssh/types.js';
import { validateRegistry } from './skills/skill-registry.js';
import { AutomationScheduler } from './automations/scheduler.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 加载环境变量
dotenv.config();

const PORT = parseInt(process.env.PORT || '8080');
const HOST = '0.0.0.0';
let automationScheduler: AutomationScheduler | null = null;

// 创建 Fastify 实例
const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
});

// 注册 CORS
await fastify.register(cors, {
  origin: ['http://localhost:3001', 'http://localhost:3000', 'http://127.0.0.1:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// 健康检查
fastify.get('/health', async () => {
  try {
    // 测试 SSH 连接
    const sshPool = getSSHPool();
    const sshOk = await sshPool.testConnection();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      vps: sshOk ? 'connected' : 'disconnected'
    };
  } catch (err) {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      vps: 'not_initialized'
    };
  }
});

// 注册路由
await fastify.register(authRoutes);
await fastify.register(chatRoutes);
await fastify.register(billingRoutes);
await fastify.register(skillsRoutes);
await fastify.register(automationsRoutes);
await fastify.register(onboardingRoutes);

// 启动服务器
async function start() {
  try {
    // 测试数据库连接
    await pool.query('SELECT NOW()');
    console.log('✅ 数据库连接成功');

    // 初始化 SSH 连接池
    const sshConfig: SSHConfig = {
      host: process.env.VPS_HOST || '',
      port: parseInt(process.env.VPS_SSH_PORT || '22'),
      username: process.env.VPS_SSH_USER || '',
      privateKeyPath: process.env.VPS_SSH_KEY_PATH || '',
      maxConnections: parseInt(process.env.VPS_SSH_MAX_CONNECTIONS || '5'),
      readyTimeoutMs: parseInt(process.env.VPS_SSH_READY_TIMEOUT_MS || '30000'),
      forceIPv4: process.env.VPS_SSH_FORCE_IPV4 !== 'false',
      keepaliveIntervalMs: parseInt(process.env.VPS_SSH_KEEPALIVE_INTERVAL_MS || '10000'),
      keepaliveCountMax: parseInt(process.env.VPS_SSH_KEEPALIVE_COUNT_MAX || '3'),
    };

    if (!sshConfig.host || !sshConfig.username || !sshConfig.privateKeyPath) {
      throw new Error('VPS SSH 配置不完整，请检查环境变量');
    }

    initSSHPool(sshConfig);
    console.log('✅ SSH 连接池初始化成功');

    // 测试 SSH 连接
    const sshPool = getSSHPool();
    const sshOk = await sshPool.testConnection();
    if (!sshOk) {
      throw new Error('SSH 连接测试失败');
    }
    console.log('✅ VPS 连接测试成功');

    const schedulerEnabled = process.env.AUTOMATIONS_SCHEDULER_ENABLED !== 'false';
    if (schedulerEnabled) {
      const tickMs = parseInt(process.env.AUTOMATIONS_SCHEDULER_TICK_MS || '60000', 10);
      const maxUsersPerTick = parseInt(process.env.AUTOMATIONS_SCHEDULER_MAX_USERS_PER_TICK || '500', 10);
      automationScheduler = new AutomationScheduler(tickMs, maxUsersPerTick);
      automationScheduler.start();
    } else {
      console.log('ℹ️ 自动化调度器已禁用（AUTOMATIONS_SCHEDULER_ENABLED=false）');
    }

    // 技能注册表一致性校验
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const catalogPath = process.env.SKILLS_CATALOG_DIR || path.join(__dirname, 'skills', 'catalog');
    const missing = validateRegistry(catalogPath);
    if (missing.length > 0) {
      console.warn(`[SkillRegistry] ${missing.length} 个 SKILL.md 文件缺失:`);
      for (const m of missing) console.warn(`  ${m}`);
      if (process.env.NODE_ENV === 'production') {
        console.error('[SkillRegistry] 生产环境不允许缺失，退出');
        process.exit(1);
      }
    }

    // 启动服务器
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`🚀 服务器启动成功: http://${HOST}:${PORT}`);
    console.log(`📊 健康检查: http://${HOST}:${PORT}/health`);
  } catch (err) {
    console.error('❌ 启动失败:', err);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n⏳ 正在关闭服务器...');
  if (automationScheduler) {
    automationScheduler.stop();
    automationScheduler = null;
  }
  await fastify.close();
  await pool.end();

  // 销毁 SSH 连接池
  try {
    const sshPool = getSSHPool();
    await sshPool.destroy();
  } catch (err) {
    // SSH 连接池可能未初始化
  }

  console.log('✅ 服务器已关闭');
  process.exit(0);
});

start();
