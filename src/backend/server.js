/**
 * @fileoverview 独立运行积分服务（默认 3001，路径前缀 `/pts`，与并入 3721 时一致）。
 * 前期推荐只开：`npm run auth:dev`（3721 已含 `/pts`）。
 */
import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { attachPointsRoutes } from './createPointsApp.mjs'

const PORT = Number(process.env.PORT || 3001)
const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '512kb' }))

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'flowid-points-standalone', port: PORT, pointsMount: '/pts' })
})

;(async () => {
  await attachPointsRoutes(app, { mountPrefix: '/pts' })

  app.use((_req, res) => {
    res.status(404).json({ ok: false, message: 'not_found' })
  })

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[flowid-points-api] http://127.0.0.1:${PORT}  管理页与 API 前缀: /pts/`)
  })
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[flowid-points-api] startup failed', e)
  process.exit(1)
})
