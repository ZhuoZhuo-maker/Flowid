/**
 * 桌面端打包入口（`npm run pack:desktop`）。
 * 通过环境变量注入 Vite 构建参数；可选先导出随包画廊到 public/flowid-bundled。
 *
 * 配置方式（任选其一）：
 * - 运行前设置环境变量 FLOWID_PUBLIC_SERVER 等
 * - 或在下方 PACK_DEFAULTS 中填写（勿把真实地址提交 Git）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 本地默认打包参数（可被环境变量覆盖） */
const PACK_DEFAULTS = {
  FLOWID_PUBLIC_SERVER: 'https://YOUR_SERVER_URL_HERE',
  // FLOWID_EXCHANGE_GROUP_QQ: '1103016040',
  // FLOWID_LOCAL_GALLERY: '1',
  // FLOWID_EXPORT_GALLERY_BASE: 'http://127.0.0.1:3721',
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  })
  const code = r.status ?? 1
  if (code !== 0) process.exit(code)
}

function envStr(key, fallback = '') {
  const v = String(process.env[key] ?? '').trim()
  if (v) return v
  const d = PACK_DEFAULTS[key]
  return d != null ? String(d).trim() : fallback
}

function main() {
  const flowidPublicServer = envStr('FLOWID_PUBLIC_SERVER')
  const exchangeQq = envStr('FLOWID_EXCHANGE_GROUP_QQ')
  const localGallery = envStr('FLOWID_LOCAL_GALLERY')
  let exportGalleryBase = envStr('FLOWID_EXPORT_GALLERY_BASE')

  console.log('==========================================')
  console.log('Flowid desktop pack')
  console.log('==========================================')
  console.log('Work dir:', root)
  console.log('Public server:', flowidPublicServer || '(empty)')
  console.log('Local gallery:', localGallery || '(off)')
  console.log()

  if (!flowidPublicServer) {
    console.error('[ERR] Set FLOWID_PUBLIC_SERVER (env or PACK_DEFAULTS in scripts/run-pack-flowid-desktop.mjs)')
    process.exit(1)
  }
  if (/YOUR_SERVER_URL_HERE/i.test(flowidPublicServer)) {
    console.error('[ERR] Replace YOUR_SERVER_URL_HERE with your real Auth URL.')
    process.exit(1)
  }

  const crossEnvBin =
    process.platform === 'win32'
      ? path.join(root, 'node_modules', '.bin', 'cross-env.cmd')
      : path.join(root, 'node_modules', '.bin', 'cross-env')
  if (!fs.existsSync(crossEnvBin)) {
    console.error('[ERR] Missing cross-env — run: npm install')
    process.exit(1)
  }

  if (localGallery === '1') {
    if (!exportGalleryBase) exportGalleryBase = flowidPublicServer
    process.env.FLOWID_EXPORT_GALLERY_BASE = exportGalleryBase
    if (!process.env.FLOWID_EXPORT_FETCH_TIMEOUT_MS) {
      process.env.FLOWID_EXPORT_FETCH_TIMEOUT_MS = '300000'
    }
    if (!process.env.FLOWID_EXPORT_FETCH_RETRIES) {
      process.env.FLOWID_EXPORT_FETCH_RETRIES = '4'
    }
    console.log('[pack] Local gallery ON — export from', exportGalleryBase)
    run(process.execPath, [path.join(root, 'scripts', 'export-flowid-bundled-gallery.mjs')])
    console.log()
  }

  console.log('[pack] Building with Vite env inject…')
  const viteEnv = [
    `VITE_FLOWID_PUBLIC_SERVER_ORIGIN=${flowidPublicServer}`,
    `VITE_FLOWID_EXCHANGE_GROUP_QQ=${exchangeQq}`,
    `VITE_FLOWID_LOCAL_GALLERY=${localGallery}`,
  ]
  run(crossEnvBin, [...viteEnv, 'npm', 'run', 'desktop:build:deliverables'])

  const deliverables = path.join(root, 'deliverables')
  console.log()
  console.log('[OK] Installer output:', deliverables)
  if (process.platform === 'win32' && fs.existsSync(deliverables)) {
    spawnSync('explorer', [deliverables], { stdio: 'ignore', shell: true })
  }
}

main()
