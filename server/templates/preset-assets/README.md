# 预设模板节点媒体（随包资源）

预设工程 JSON（`*.workflow.json`）里若只有 `blob:` 或本机 `srcAssetId`，其他用户无法看到示例图/视频。

请把媒体文件按 **IndexedDB 资产 id** 命名放在本目录，例如：

- `a2435f28-5c8a-41e4-b8d7-e160270a697f.png`
- `dc0b8866-0f97-4c43-9ec4-b205ac89a449.jpg`

然后在仓库根目录执行：

```bash
npm run bundle:preset-media
# 可选：同时回写 server/templates/*.workflow.json
npm run bundle:preset-media -- --write-server
```

打包安装包前再执行 `npm run export:bundled-gallery`（已内置媒体打包逻辑）。

输出目录：`public/flowid-bundled/presets/assets/<模板id>/`
