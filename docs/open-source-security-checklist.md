# 开源前安全检查清单（API Key / 第三方网关）

避免将 **nowcoding.ai**、真实 **API Key**、个人 Auth 地址误提交到公开仓库或安装包。

## 一、仓库内一键扫描

```bash
npm run check:open-source-secrets
```

若退出码非 0，按输出路径逐项处理后再开源。

手动全量清理（模板 workflow + Auth 目录 JSON）：

```bash
npm run sanitize:cloud-secrets
npm run check:open-source-secrets
```

## 二、必须清空的文件（随 Git 发布）

| 路径 | 说明 |
|------|------|
| `server/cloud-assist-models.json` | 应为空 `kinds` 或仅自建占位；参考 `server/cloud-assist-models.example.json` |
| `server/cloud-models.json` | 建议 `providers: []` |
| `server/templates/*.workflow.json` | 节点 `data` 内勿含 `cloudModelUrl` / `cloudApiKey` / `flowid-assist:…` 指向私网 |
| `scripts/run-pack-flowid-desktop.mjs` | 勿把个人 Auth 地址提交进 Git；打包前用环境变量设置 `FLOWID_PUBLIC_SERVER` |
| `.env` / 本地配置 | 勿提交 |
| `server/auth-db.json` | 已在 `.gitignore`；仓库内仅保留 `server/auth-db.example.json` 空壳 |
| `build/pyi_work/` | PyInstaller 中间产物，勿提交 |
| `workflows/` | 本地临时导入，勿提交 |

## 三、不要进 Git 的构建产物（已在 .gitignore）

| 路径 | 风险 |
|------|------|
| `public/flowid-bundled/` | 导出画廊时可能把带 Key 的 workflow 打进随包 |
| `dist/`、`release/`、`deliverables/` | 旧安装包或已编译进前端的 `VITE_*` 地址 |

打包前确认：`npm run export:bundled-gallery` 使用的 Auth 源与模板已脱敏。

## 四、Git 历史（曾提交过 Key 时必做）

仅删除当前文件 **不能** 抹掉历史提交中的 `sk-…`。

1. **先在服务商侧轮换 / 作废** 已泄露的 Key（按泄露时间评估）。
2. 若仓库尚未公开或允许改历史，可用 [git-filter-repo](https://github.com/newren/git-filter-repo) 等工具从全历史删除敏感文件内容，然后 **force push**（需与协作者同步）。
3. 若已公开很久，假定 Key 已泄露，以轮换为主，历史清理为辅。

搜索历史是否出现过 nowcoding / sk-：

```bash
git log -p --all -S "nowcoding.ai" -- .
git log -p --all -S "sk-" -- server/templates
```

已从历史中剔除的路径（若需在新克隆上重做，需安装 [git-filter-repo](https://github.com/newren/git-filter-repo) 后执行 `node scripts/purge-sensitive-git-history.mjs`）：

- `licenses_export_*.csv`、`server/auth-db.json`、`pack-flowid-user-config.bat*`
- `build/pyi_work/`

重写历史后推远程：

```bash
git push --force-with-lease origin HEAD
```

## 五、本机与旧安装包（不进 Git，但需自查）

浏览器 **Application → Local Storage**（域名对应 FLOWID 页面）：

- `flowid.cloud.self.presets.v1`
- `flowid.cloud.assist.apiKeys.v1`
- `flowid.cloudModelPresets.v1` / `flowid.cloudModelPresetsByKind.v2`

本机工程 JSON、IndexedDB「我的预设」、桌面版 `release/` 目录中的旧包——开源前不必上传，但勿把含 Key 的工程当作公开示例分发。

## 六、开源后他人如何配置（不会自动用你的线路）

- 克隆仓库 → 自建 Auth → 在管理后台填写 **自己的** `cloud-assist-models`（见 example 文件）。
- 用户在「设置 → 云端模型」自行新增预设；节点不会自带你的 nowcoding。

## 七、发布前勾选（打印自用）

- [ ] `npm run check:open-source-secrets` 通过
- [ ] `server/cloud-assist-models.json` 无真实第三方 `baseUrl`
- [ ] `server/templates` 无 `sk-` / nowcoding
- [ ] 未提交 `public/flowid-bundled/`、`dist/`、`release/`
- [ ] `PACK_DEFAULTS` / 环境变量未含个人私网/公网 Auth 地址（仅占位 `YOUR_SERVER_URL_HERE`）
- [ ] 已轮换历史上出现过的 API Key
- [ ] README 中未写个人私钥或内网-only 地址
