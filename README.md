# Flowid

Flowid 无限画布工作室（React + TypeScript + Vite）。**开源协议：MIT**（见 [LICENSE](./LICENSE)）。

**开源版说明**：客户端不再包含授权码激活、积分预扣/计费；画布与 Agent 可直接执行工作流。可选自建 **Auth 服务** 分发预设模板、云端工作流元数据等（非强制）。

### 云端模型 / API Key（开源仓库）

- 仓库内 **`server/cloud-assist-models.json`** 默认为空目录，**不包含**任何第三方 API 地址或 Key。
- 自建 Auth 时可参考 **`server/cloud-assist-models.example.json`**，在管理后台「云端模型配置」中填写自己的 OpenAI 兼容网关。
- 示例预设 workflow（`server/templates/*.workflow.json`）已清空节点上的 `cloudModelUrl` / `cloudApiKey` / `flowid-assist` 绑定；使用者需在「设置 → 云端模型」或节点里自行配置。
- **`public/flowid-bundled/`**、**`release/`**、**`dist/`** 已在 `.gitignore` 中，不会随 Git 提交；重新打包前请勿把私钥写入模板再执行 `export:bundled-gallery`。
- 若曾将真实 Key 提交过 Git，请在服务商侧**轮换 Key**，勿仅依赖删除文件（历史提交仍可能被检索）。
- 发布前执行 **`npm run check:open-source-secrets`**；完整步骤见 **[docs/open-source-security-checklist.md](./docs/open-source-security-checklist.md)**。

## 本地开发

```bash
npm install
npm run dev          # Vite (5173) + Auth (3721)
# 或仅前端：npm run dev:vite
# 或仅 Auth：npm run auth:dev
```

- 画布：<http://127.0.0.1:5173>
- Auth 健康检查：<http://127.0.0.1:3721/healthz>
- Auth 管理控制台：<http://127.0.0.1:3721/admin.html>

## Auth 服务部署

把 **`server/auth-server.cjs`** 部署到公网时，见 **[docs/deploy-auth-server.md](./docs/deploy-auth-server.md)**。

管理端可维护：云端 Comfy 工作流、预设模板、系统提示词、灵感小镇、用户协议等。环境变量示例见 **`.env.example`**。

## 桌面端打包

```bash
# 设置 FLOWID_PUBLIC_SERVER 等环境变量，或编辑 scripts/run-pack-flowid-desktop.mjs 中的 PACK_DEFAULTS：
npm run pack:desktop
```

注入的环境变量包括 **`VITE_FLOWID_PUBLIC_SERVER_ORIGIN`**（Auth 根地址）、**`VITE_FLOWID_EXCHANGE_GROUP_QQ`**、可选 **`VITE_FLOWID_LOCAL_GALLERY`**。不再使用 `VITE_LICENSE_API_URL`。

随包画廊与远端拉取区别见 **[docs/pack-bundled-vs-remote.md](./docs/pack-bundled-vs-remote.md)**。

## 敏感词主词库（Aho–Corasick + 按需加载）

- **运行时**：`src/lib/sensitiveWords.ts`；启动后先请求 **`public/lexicon/sensitive.meta.json`**，IndexedDB 命中同版本则跳过大文件下载。
- **更新词库**：`npm run build:lexicon` → 写入 `public/lexicon/sensitive.json` 与 `sensitive.meta.json`。
- **测试**：`npm run test:sensitive`；**粗测**：`npm run bench:sensitive`。

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
