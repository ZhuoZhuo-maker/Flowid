# 桌面端打包说明（Windows）

## 1. 安装依赖

```bash
npm install
```

## 2. 本地联调（Vite + Electron）

```bash
npm run desktop:dev
```

说明：
- 前端开发地址：`http://127.0.0.1:5173`
- Electron 会自动等待前端启动后再打开桌面窗口

## 3. 生成可执行安装包

```bash
npm run desktop:build
```

输出目录：
- `release/`

## 4. 仅生成目录产物（不打包安装器）

```bash
npm run desktop:dir
```

## 5. 自动更新配置（骨架）

当前已接入 `electron-updater`，默认逻辑：
- 应用启动后自动检查更新
- 更新下载完成后弹窗提示“立即更新/稍后”

你需要在发布阶段补充更新源配置（例如 GitHub Release 或私有更新服务器）。

## 6. 授权状态提示（本地快照）

已接入本地授权状态模型：
- `active`
- `expiring_soon`
- `expired`
- `frozen`

默认提示策略：
- `expiring_soon`：到期前 3 天、1 天提醒
- `expired/frozen`：启动即提示“只读/不可提交”

后续可在登录接口回包后写入：
- `src/lib/license.ts`

## 7. 本地认证后端（开发环境）

已内置最小可用认证服务：

```bash
npm run auth:dev
```

也可用批处理脚本：

```bash
restart-auth-dev.bat
stop-auth-dev.bat
```

默认地址：
- `http://127.0.0.1:3721`

管理员口令（用于冻结/续期/用户列表）：
- 默认：`flowid-admin-dev`
- 可通过环境变量覆盖：`AUTH_ADMIN_SECRET`

接口：
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/license/status`（Bearer token）

数据库文件：
- `server/auth-db.json`
