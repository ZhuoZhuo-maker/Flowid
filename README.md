# Flowid

Flowid 无限画布工作室（React + TypeScript + Vite）。

## 授权服务部署（线上授权码 / 预设模板）

把 **`server/auth-server.cjs`** 部署到公网时，可按步骤操作：**[docs/deploy-auth-server.md](./docs/deploy-auth-server.md)**。

## 本地积分服务（SQLite + `npm run points:dev`）

- 默认数据库：`data/flowid.db`（可用环境变量 **`DB_PATH`** 覆盖）。
- 积分 SQLite 管理页与 API：与 Auth **同端口 3721**，路径前缀 **`/pts`**（例如 `http://127.0.0.1:3721/pts/admin/licenses`）。`npm run dev` 会并行启动 Vite + Auth（已含 `/pts`）。口令可用 **`ADMIN_TOKEN`** 或回退 **`AUTH_ADMIN_SECRET`**，请求头 `x-admin-token` 或 URL `?token=`。
- 管理 API 前缀：`/api/admin/*`；积分 API：`/api/points/*`。

### 历史死信时间戳回填

1. 在 SQLite 客户端打开与线上相同的库文件。
2. 执行 **`scripts/points-confirm-failures-backfill-preview.sql`** 中的 **SELECT / COUNT**（仅预览）。
3. 核对行数与样例无误后，**先备份数据库**，再取消注释其中的 **UPDATE** 段执行：用 `created_at` 回填 `resolved_at` / `ignored_at`，`resolved_by` / `ignored_by` 置为 `'backfill'`。

### 授权码生成与管理

- **命令行生成**：`npm run gen-license -- --points 1000 --count 10 --expireDays 30`（`--expireDays 0` 表示永久）。写入 `licenses` 表，并导出 CSV 至 **`exports/licenses_YYYYMMDD_HHMMSS.csv`**（列：code, points, expire_time, created_at, status）。也可用 `node scripts/generate-licenses.js`（与 `.mjs` 等价）。
- **Web 管理**：浏览器打开 `/admin/licenses`，支持按 code 模糊、按状态（active / 已过期 / revoked）筛选、每页 20 条、批量生成弹窗、单条禁用（二次确认）。
- **API**：`GET /api/admin/licenses`（`code`、`statusFilter`、`page`、`pageSize`）、`POST /api/admin/licenses`（body：`points`, `count`, `expireDays`）、`POST /api/admin/licenses/:code/revoke`。

### 积分低余额提示

- 接口：`GET /api/points/balance-alert?licenseCode=&machineCode=&threshold=100`（须通过授权 + 机器码校验）。
- 客户端：`LicenseModal` 在打开且已有所需信息后请求该接口；若 `belowThreshold=true`，顶部显示黄色提示条（可关闭，关闭后仅本次会话内隐藏；再次打开弹窗会重新检测）。

### 死信自动重试（定时任务）

- 脚本：`npm run retry-dlq`（即 `node scripts/retry-dlq.js`，可加 `--once` 与定时任务约定一致；当前每次进程均只跑一轮）。对 `points_confirm_failures` 中 **`status=pending`** 的记录调用本机 **`POST /api/points/confirm`**；成功则死信标为 **resolved**（`resolved_by=auto_retry`）；失败则 **`retry_count`** 自增，**≥3** 后标为 **ignored**（`ignored_by=auto_retry`）。环境变量 **`POINTS_API_BASE`** 默认 `http://127.0.0.1:3721/pts`，**`DB_PATH`** 默认 `data/flowid.db`。
- **Linux cron**（每小时，需先 `cd` 到仓库根目录并保证 `node` 在 PATH）：

  `0 * * * * cd /path/to/FLOWID && /usr/bin/node scripts/retry-dlq.js >> /var/log/flowid-retry-dlq.log 2>&1`

- **Windows 任务计划程序**：创建基本任务 → 触发器「每天」后改为「重复任务间隔 1 小时」→ 操作「启动程序」：`程序` 填 `node`，`参数` 填 `scripts\retry-dlq.js`，`起始于` 填仓库根目录。

### 积分 API 单元测试

- `npm run test:points`：内存 SQLite + 临时 HTTP，覆盖 reserve / confirm / cancel / 余额不足 / confirm-failure 死信写入。
- 若报错 **better-sqlite3 与当前 Node 版本不匹配**，在本机仓库根目录执行 **`npm rebuild better-sqlite3`** 后重试。

### 运维检查清单（建议）

- **每日**：查看死信表是否存在 **`pending` 超过 24 小时** 的记录（可用 `/admin/confirm-failures` 筛选 + 时间条件）。
- **每月**：导出授权码列表备份（管理页 CSV 或 `GET /api/admin/licenses` 拉取）。
- **每月**：将超过 **1 年** 的 `points_log` **归档**到外存或汇总表后按需清理（执行前务必备份库）。

## 敏感词主词库（Aho–Corasick + 按需加载）

- **运行时**：`src/lib/sensitiveWords.ts` 对外 API 不变；启动后先请求轻量 **`public/lexicon/sensitive.meta.json`** 比对版本，IndexedDB 命中同版本则**不下载**大文件 `sensitive.json`；否则再拉取主词库并缓存。首包仅内置 **`src/data/sensitiveCore.ts`** 小表作 fast path。
- **更新词库**：先按需拉取开源子集（若使用）`npm run gen:sensitive-lexicon`，再合并生成 JSON：  
  **`npm run build:lexicon`** → 写入 `public/lexicon/sensitive.json` 与 **`sensitive.meta.json`**（勿手改，可提交到仓库或随 CI 产物发布）。
- **测试**：`npm run test:sensitive`；**性能粗测**：`npm run bench:sensitive`（需已执行 `build:lexicon`）。

---

以下为创建工程时自带的 Vite 模板说明（可忽略）。

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
