# 安装包：随包本地画廊 vs 运行时走后端

构建时由 `npm run pack:desktop`（`scripts/run-pack-flowid-desktop.mjs`）通过 `cross-env` 注入的 Vite 变量决定行为；**安装包内逻辑在构建时已编译进前端**，用户一般不能在 exe 里改这些地址（`VITE_FLOWID_PUBLIC_SERVER_ORIGIN` 等会锁定授权根地址）。

## 一、`VITE_FLOWID_LOCAL_GALLERY=1` 时（随包「本地画廊」）

**前提**：打包前成功执行 `scripts/export-flowid-bundled-gallery.mjs`（或先 `npm run bundle:preset-media` 再 export），把数据写入 **`public/flowid-bundled/`**，再经 `vite build` 进入 **`dist/flowid-bundled/`**（与 `dist/index.html` 等一起打进安装包）。

| 数据 | 来源 |
|------|------|
| **预设模板列表** | 安装包内 `dist/flowid-bundled/preset-groups.json`（`fetch` 相对当前页） |
| **单个预设的 workflow JSON** | 安装包内 `dist/flowid-bundled/presets/workflows/<templateId>.json` |
| **预设模板节点示例图/视频** | 安装包内 `dist/flowid-bundled/presets/assets/<templateId>/*`（打包前用 `npm run bundle:preset-media` 或 `export:bundled-gallery` 从 `server/templates/preset-assets/` 生成） |
| **灵感小镇：分类、列表、条目正文、封面文件** | 安装包内 `dist/flowid-bundled/inspiration/**` |
| **云端 Comfy 工作流：目录 + 每条完整 JSON** | 安装包内 `dist/flowid-bundled/cloud-workflows/catalog.json` 与 `dist/flowid-bundled/cloud-workflows/workflows/<id>.json` |

以上 **不依赖** 运行时再去请求 `GET /templates/groups`、大段 `/inspiration-market/*` 列表（省流量、弱网可用）。**云端工作流**在随包导出完整后，运行时 **`fetchCloudWorkflowJson` / `fetchCloudWorkflowsMeta` 优先读随包**，不再每次访问 `GET {Auth}/cloud-workflows/...`（香港等远端慢时可明显提速）；若随包缺少某 id 或旧包未导出该目录，则 **回退** 到原 Auth 根地址拉取（逻辑与未随包时一致）。

## 二、未开启或导出失败时（默认走「注入的后端」）

此时 `templateCatalog` / `inspirationMarketApi` 使用 **`loadLicenseServerConfig().baseUrl`**，即构建时写入的 **`VITE_FLOWID_PUBLIC_SERVER_ORIGIN`**（Auth 根，如 `https://host:3721`）。

| 数据 | 来源 |
|------|------|
| **预设模板列表与 workflow** | `GET {base}/templates/groups`、`GET {base}/templates/:id/workflow`（等） |
| **灵感小镇** | `GET {base}/inspiration-market/meta`、`/list`、`/item/:id`、`/image/:id` 等 |
| **云端工作流目录、云端模型目录** | 同一 Auth 根下的公开/鉴权 API（见各 `*Api.ts`） |
| **用户协议等远程文案** | 由对应模块的 `fetch` URL 决定（若有） |

## 三、几乎总是走后端或用户自填的（与是否本地画廊无关）

| 能力 | 说明 |
|------|------|
| **ComfyUI / 厂商 API** | 用户在设置里填的本地或云端地址 |
| **可选 Auth 服务** | 打包注入 `VITE_FLOWID_PUBLIC_SERVER_ORIGIN`；用于模板/云端工作流目录等，开源版**无**积分与授权码接口 |

## 四、打包随包画廊你需要提供 / 配置什么

1. **环境变量或 `scripts/run-pack-flowid-desktop.mjs` 内 `PACK_DEFAULTS`**  
   - `FLOWID_PUBLIC_SERVER`：线上 Auth 根地址（安装包运行时要连的那台）。  
   - **`set "FLOWID_LOCAL_GALLERY=1"`**：打开随包导出 + 构建注入 `VITE_FLOWID_LOCAL_GALLERY=1`。  
   - 可选 **`FLOWID_EXPORT_GALLERY_BASE`**：导出脚本拉数据的地址；**不填则等于 `FLOWID_PUBLIC_SERVER`**。若公网慢、超时，可改为 **`http://127.0.0.1:3721`**，并在本机先 **`npm run auth:dev`**，从本机拉完再打包。  
   - 可选 **`FLOWID_EXPORT_FETCH_TIMEOUT_MS`** / **`FLOWID_EXPORT_FETCH_RETRIES`**：单次请求超时与重试次数（`run-pack-flowid-desktop.mjs` 在未设置时默认 `300000` ms 与 `4` 次；脚本内另有默认值，见 `scripts/export-flowid-bundled-gallery.mjs`）。

2. **打包机必须能访问导出源**  
   若 `FLOWID_PUBLIC_SERVER` 是公网，而你在 **无法访问该地址** 的环境（如隔离 CI）里打包，导出会报 `fetch failed`。请改用 **`FLOWID_EXPORT_GALLERY_BASE=http://127.0.0.1:3721`**，并在 **同一台机器** 先 **`npm run auth:dev`** 再打包。

3. **导出时 Auth 必须可访问**  
   能响应 `GET /templates/groups`、`GET /templates/:id/workflow`、`GET /cloud-workflows`、`GET /cloud-workflows/:id/workflow`、`GET /inspiration-market/*` 等（无需 admin token）。

4. **仓库目录**  
   导出写入 **`public/flowid-bundled/`**（体积可能较大，勿误删后再未导出就打包）。

## 五、与「项目档案」本地磁盘的区别

**工程、封面、flowid-zy 等** 由应用读写 **用户本机路径**，与 `VITE_FLOWID_LOCAL_GALLERY` 无关；那是「用户数据」，不是「随包内置画廊」。
