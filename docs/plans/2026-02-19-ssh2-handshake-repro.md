# SSH2 握手问题最小复现（2026-02-19）

## 现象
- 后端启动阶段执行 `sshPool.testConnection()` 偶发失败，报错：
  - `Connection lost before handshake`
  - `Timed out while waiting for handshake`
- 同机执行系统 `ssh` 可以连接同一台 VPS。

## 复现命令

1. 系统 SSH（成功）
```bash
ssh -i "$VPS_SSH_KEY_PATH" -p "${VPS_SSH_PORT:-22}" \
  -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
  "$VPS_SSH_USER@$VPS_HOST" 'echo SSH_OK'
```

2. Node ssh2（历史上出现握手超时）
```bash
node --input-type=module -e '
import { Client } from "ssh2";
import { readFileSync } from "fs";
import dotenv from "dotenv";
dotenv.config();
const c = new Client();
c.on("ready", () => { console.log("READY"); c.end(); });
c.on("error", (e) => { console.error("ERR", e.message); process.exit(1); });
c.connect({
  host: process.env.VPS_HOST,
  port: Number(process.env.VPS_SSH_PORT || 22),
  username: process.env.VPS_SSH_USER,
  privateKey: readFileSync(process.env.VPS_SSH_KEY_PATH),
  readyTimeout: 10000
});
'
```

## 修复策略
- 在 `ssh2` 连接参数中增加更稳妥的默认值：
  - `readyTimeout=30000`
  - `forceIPv4=true`
  - `keepaliveInterval=10000`
  - `keepaliveCountMax=3`
- 并通过环境变量暴露：
  - `VPS_SSH_READY_TIMEOUT_MS`
  - `VPS_SSH_FORCE_IPV4`
  - `VPS_SSH_KEEPALIVE_INTERVAL_MS`
  - `VPS_SSH_KEEPALIVE_COUNT_MAX`

## 关联代码
- `mycc-backend/src/ssh/pool.ts`
- `mycc-backend/src/ssh/types.ts`
- `mycc-backend/src/index.ts`
- `mycc-backend/.env.example`
