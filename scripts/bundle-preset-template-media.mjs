/**
 * 将 server/templates/*.workflow.json 中的节点媒体打包到 public/flowid-bundled/presets/assets/，
 * 并回写 workflow JSON（相对路径 flowid-bundled/presets/assets/<模板id>/…）。
 *
 * 媒体文件来源（按优先级）：
 * 1. 节点 resultThumbnails[].diskPath（导出机器上可读的路径）
 * 2. server/templates/preset-assets/<srcAssetId>.png|jpg|mp4|…
 * 3. 节点内 http(s) / data: URL
 *
 * 用法：
 *   npm run bundle:preset-media
 *   npm run bundle:preset-media -- --write-server   # 同时更新 server/templates/*.workflow.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundlePresetWorkflowJson } from './lib/preset-template-media-bundle.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const TEMPLATES_DIR = path.join(REPO_ROOT, 'server', 'templates')
const PUBLIC_BUNDLED = path.join(REPO_ROOT, 'public', 'flowid-bundled')
const WF_OUT_DIR = path.join(PUBLIC_BUNDLED, 'presets', 'workflows')

const writeServer = process.argv.includes('--write-server')

async function main() {
  const names = await fs.readdir(TEMPLATES_DIR)
  const workflowFiles = names.filter((n) => n.endsWith('.workflow.json'))
  if (!workflowFiles.length) {
    // eslint-disable-next-line no-console
    console.warn('[bundle-preset-media] 未找到 server/templates/*.workflow.json')
    return
  }

  // eslint-disable-next-line no-console
  console.log(`[bundle-preset-media] 处理 ${workflowFiles.length} 个预设…`)
  let totalBundled = 0
  let totalSkipped = 0

  for (const file of workflowFiles) {
    const templateId = file.replace(/\.workflow\.json$/i, '')
    const srcPath = path.join(TEMPLATES_DIR, file)
    const text = await fs.readFile(srcPath, 'utf8')
    // eslint-disable-next-line no-console
    console.log(`\n[bundle-preset-media] ${templateId}`)
    const { json, stats } = await bundlePresetWorkflowJson(text, templateId, {
      repoRoot: REPO_ROOT,
      log: (msg) => console.log(msg),
    })
    totalBundled += stats.bundled
    totalSkipped += stats.skipped
    // eslint-disable-next-line no-console
    console.log(
      `[bundle-preset-media] 完成：新打包 ${stats.bundled}，复用 ${stats.reused}，跳过 ${stats.skipped}`,
    )

    await fs.mkdir(WF_OUT_DIR, { recursive: true })
    await fs.writeFile(path.join(WF_OUT_DIR, `${templateId}.json`), json, 'utf8')

    if (writeServer) {
      await fs.writeFile(srcPath, json, 'utf8')
      // eslint-disable-next-line no-console
      console.log(`[bundle-preset-media] 已回写 ${srcPath}`)
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n[bundle-preset-media] 全部完成：打包 ${totalBundled} 个文件，跳过 ${totalSkipped} 处引用。输出：public/flowid-bundled/presets/`,
  )
  if (!writeServer) {
    // eslint-disable-next-line no-console
    console.log(
      '提示：若需同步更新 server/templates 内 JSON，请加参数 --write-server；打包安装包前请执行 npm run export:bundled-gallery。',
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
