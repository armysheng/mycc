# Changelog

## [Unreleased]

## [2026-01-28]

### Added
- `retryWithBackoff` 通用重试函数
- `waitForReady` 主动探测等待函数
- Worker `/info/{token}` 接口用于验证连接
- `config.ts` 统一配置管理
- `adapters` 适配器架构

### Changed
- tunnel 等待从固定 10 秒改为主动探测（最多 30 秒，快的时候 2-3 秒）
- 注册/验证失败后有明确提示

### Fixed
- 后端重启后前端无法自动重连的问题
- `onRetry` 回调重复调用的 bug

## [2026-01-27]

### Added
- 首次发布
- 基础后端架构
- 网页端配对功能
