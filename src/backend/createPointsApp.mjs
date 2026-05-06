/**
 * 将积分 SQLite API + 管理页挂到 Express 的指定前缀（默认 `/pts`），与 3721 Auth 同进程单端口部署。
 *
 * 注意：不在本文件顶层静态 import `./db/sqlite.js`，否则 Auth 进程在 `import()` 本模块时就会加载 better-sqlite3；
 * 若原生模块与当前 Node 不匹配，整个 import 失败，/pts 路由永远不会注册（表现为 Cannot GET /pts/admin）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const adminDir = path.join(__dirname, 'admin')

/**
 * @param {import('express').Express} app
 * @param {{ mountPrefix?: string }} [opts]
 */
export async function attachPointsRoutes(app, opts = {}) {
  const mountPrefix = String(opts.mountPrefix ?? '/pts').replace(/\/$/, '') || '/pts'
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'flowid.db')
  /**
   * 与 `server/auth-server.cjs` 的 `AUTH_ADMIN_SECRET` 默认一致（`flowid-admin-dev`）。
   * 不再依赖 NODE_ENV：若机器上误设了 NODE_ENV=production，此前会导致 apiAdminToken 为空、管理 API 一直 503。
   * 生产环境请务必设置 `ADMIN_TOKEN` 或 `AUTH_ADMIN_SECRET` 覆盖默认值。
   */
  const envAdminToken = String(process.env.ADMIN_TOKEN || process.env.AUTH_ADMIN_SECRET || '').trim()
  const apiAdminToken = envAdminToken || 'flowid-admin-dev'

  try {
    const [{ openDb }, { createLicenseRouter }, { createPointsRouter }, { createAdminRouter, verifyAdminHtmlAccess }] =
      await Promise.all([
        import('./db/sqlite.js'),
        import('./routes/license.js'),
        import('./routes/points.js'),
        import('./routes/admin.js'),
      ])

    const db = openDb(dbPath)
    const r = express.Router()
    const authLicenseVerifyUrl = String(
      process.env.AUTH_INTERNAL_LICENSE_VERIFY_URL || 'http://127.0.0.1:3721/license/verify',
    ).trim()
    const proMembershipNodeKinds = String(process.env.POINTS_PRO_MEMBERSHIP_NODE_KINDS || '').trim()

    r.use('/api/license', createLicenseRouter(db))
    r.use(
      '/api/points',
      createPointsRouter(db, { adminToken: apiAdminToken, authLicenseVerifyUrl, proMembershipNodeKinds }),
    )
    r.use('/api/admin', createAdminRouter(db, { adminToken: apiAdminToken }))

    r.use('/admin/static', express.static(path.join(adminDir, 'static')))

    /** 仅当显式配置了口令时才锁 HTML；未配置时仍可打开页面，由 API 的 apiAdminToken（开发默认）完成写操作鉴权。 */
    const guardAdminHtml = verifyAdminHtmlAccess({ adminToken: envAdminToken })
    const sendAdminPage = (fileName) => (_req, res) => {
      const abs = path.join(adminDir, fileName)
      res.sendFile(abs, (err) => {
        if (err) {
          // eslint-disable-next-line no-console
          console.error('[flowid-points] admin html sendFile failed', fileName, err.message)
          if (!res.headersSent) {
            res.status(500).type('html').send('<!doctype html><meta charset="utf-8"/><p>管理页加载失败。</p>')
          }
        }
      })
    }

    r.get('/admin', guardAdminHtml, sendAdminPage('admin.html'))
    r.get('/admin/', guardAdminHtml, sendAdminPage('admin.html'))
    r.get('/admin/licenses', guardAdminHtml, sendAdminPage('licenses.html'))
    r.get('/admin/points-pricing', guardAdminHtml, sendAdminPage('points-pricing.html'))
    r.get('/admin/confirm-failures', guardAdminHtml, sendAdminPage('confirm-failures.html'))
    r.get('/admin/batch-refund', guardAdminHtml, sendAdminPage('batch-refund.html'))
    r.get('/admin/points-logs', guardAdminHtml, sendAdminPage('batch-refund.html'))

    app.use(mountPrefix, r)
    // eslint-disable-next-line no-console
    console.log(`[flowid-points] mounted at ${mountPrefix}/ (api + admin html)`)
    if (process.env.NODE_ENV === 'production' && apiAdminToken === 'flowid-admin-dev') {
      // eslint-disable-next-line no-console
      console.warn(
        '[flowid-points] 生产环境 NODE_ENV=production 且未设置 ADMIN_TOKEN/AUTH_ADMIN_SECRET：管理 API 仍使用默认口令，存在严重安全风险，请务必改为强随机密钥。',
      )
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[flowid-points] 无法挂载 SQLite 积分模块（常见原因：better-sqlite3 与 Node 版本不匹配）:', err)
    mountPointsFallback(app, mountPrefix, err)
  }
}

/**
 * 积分模块加载失败时仍注册 /pts，避免 Express 默认 Cannot GET；并提示修复步骤。
 * @param {import('express').Express} app
 * @param {string} mountPrefix
 * @param {unknown} err
 */
function mountPointsFallback(app, mountPrefix, err) {
  const msg = String(err?.message || err || 'unknown_error')
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  const r = express.Router()
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>积分模块未加载</title></head>
<body style="font-family:system-ui;padding:24px;max-width:720px;line-height:1.55;background:#0f1419;color:#e6edf3">
<h1>积分服务（/pts）未能启动</h1>
<p>本页表示 Auth 进程已运行，但 <strong>better-sqlite3</strong> 或数据库初始化失败，积分 API 与管理页未挂载。</p>
<pre style="background:#161b22;padding:12px;border-radius:8px;overflow:auto;font-size:12px">${esc(msg)}</pre>
<p><strong>建议：</strong>在项目根目录执行 <code>npm rebuild better-sqlite3</code>，或使用与当前 Node 主版本一致的 Node 再运行 <code>npm run auth:dev</code>。</p>
<p>Auth 其它功能（3721 根路径、<code>/admin.html</code>）不受影响。</p>
</body></html>`
  r.get('/admin', (_req, res) => res.type('html').send(html))
  r.get('/admin/', (_req, res) => res.type('html').send(html))
  r.get('/admin/licenses', (_req, res) => res.type('html').send(html))
  r.get('/admin/points-pricing', (_req, res) => res.type('html').send(html))
  r.get('/admin/confirm-failures', (_req, res) => res.type('html').send(html))
  r.get('/admin/batch-refund', (_req, res) => res.type('html').send(html))
  r.get('/admin/points-logs', (_req, res) => res.type('html').send(html))
  r.use('/api', (_req, res) =>
    res.status(503).json({
      success: false,
      message: 'points_module_unavailable',
      detail: msg.slice(0, 500),
    }),
  )
  app.use(mountPrefix, r)
  // eslint-disable-next-line no-console
  console.warn(`[flowid-points] fallback mounted at ${mountPrefix}/ (no SQLite)`)
}
