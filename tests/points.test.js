/**
 * 积分 API 行为测试（内存 SQLite + 临时 Express）。
 * 运行：npm run test:points
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import Database from 'better-sqlite3'
import { applyFlowidSqliteSchema } from '../src/backend/db/sqlite.js'
import { createAdminRouter } from '../src/backend/routes/admin.js'
import { createLicenseRouter } from '../src/backend/routes/license.js'
import { createPointsRouter } from '../src/backend/routes/points.js'

const TEST_CODE = 'AAAA-BBBB-CCCC-DDDD'
const MACHINE = 'machine-test-01'

async function postJson(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  return { res, j }
}

async function run() {
  let db
  try {
    db = new Database(':memory:')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[points.test] SKIP: better-sqlite3 原生模块与当前 Node 不匹配，请在本机执行 npm rebuild better-sqlite3 后重试。', e)
    process.exit(0)
  }
  applyFlowidSqliteSchema(db)

  db.prepare(
    `INSERT INTO licenses (code, machine_code, points, total_earned, total_spent, bind_time, expire_time, status)
     VALUES (?, ?, 500, 500, 0, NULL, NULL, 'active')`,
  ).run(TEST_CODE, MACHINE)

  const app = express()
  app.use(express.json({ limit: '256kb' }))
  app.use('/api/points', createPointsRouter(db, { adminToken: '' }))
  const server = app.listen(0)
  await once(server, 'listening')
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/api/points`

  let r = await postJson(base, '/reserve', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-r1',
    nodeKind: 'text',
    executionTarget: 'model',
  })
  assert.equal(r.j.success, true)
  assert.equal(r.j.remainingPoints, 499)

  r = await postJson(base, '/reserve', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-r1',
    nodeKind: 'text',
    executionTarget: 'model',
  })
  assert.equal(r.j.success, true)
  assert.equal(r.j.idempotent, true)

  r = await postJson(base, '/confirm', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-r1',
  })
  assert.equal(r.j.success, true)
  const spent = db.prepare(`SELECT total_spent FROM licenses WHERE code = ?`).get(TEST_CODE)
  assert.equal(spent.total_spent, 1)
  const log = db.prepare(`SELECT type FROM points_log WHERE dedupe_key = 'dedupe-r1'`).get()
  assert.equal(log.type, 'consume')

  r = await postJson(base, '/reserve', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-r2',
    nodeKind: 'text',
    executionTarget: 'model',
  })
  assert.equal(r.j.success, true)
  r = await postJson(base, '/cancel', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-r2',
  })
  assert.equal(r.j.success, true)
  const ptsAfterCancel = db.prepare(`SELECT points FROM licenses WHERE code = ?`).get(TEST_CODE)
  assert.equal(ptsAfterCancel.points, 499)
  const logUserCancel = db
    .prepare(`SELECT type, amount FROM points_log WHERE dedupe_key LIKE 'dedupe-r2:void:%'`)
    .get()
  assert.equal(logUserCancel.type, 'cancelled')
  assert.ok(Number(logUserCancel.amount) < 0)

  r = await postJson(base, '/reserve', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-r3',
    nodeKind: 'text',
    executionTarget: 'model',
    metadata: { workflowName: '单元流', cloudModelName: 'glm' },
  })
  assert.equal(r.j.success, true)
  r = await postJson(base, '/cancel', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-r3',
    cancelReason: 'failure',
    error: 'ComfyUI 超时',
  })
  assert.equal(r.j.success, true)
  assert.equal(r.j.ledgerType, 'refund')
  const logFailRefund = db
    .prepare(`SELECT type, amount, meta_json FROM points_log WHERE dedupe_key LIKE 'dedupe-r3:void:%'`)
    .get()
  assert.equal(logFailRefund.type, 'refund')
  assert.equal(Number(logFailRefund.amount), 1)
  const meta = JSON.parse(logFailRefund.meta_json || '{}')
  assert.ok(String(meta.error || '').includes('超时'))
  assert.equal(meta.workflowName, '单元流')

  const fr = await fetch(
    `${base}/failures?licenseCode=${encodeURIComponent(TEST_CODE)}&machineCode=${encodeURIComponent(MACHINE)}`,
  )
  const fj = await fr.json()
  assert.equal(fr.status, 200)
  assert.equal(fj.success, true)
  assert.ok(Array.isArray(fj.failures) && fj.failures.length >= 1)
  assert.ok(fj.failures.some((x) => String(x.dedupe_key || '').includes('dedupe-r3:void')))

  db.prepare(`UPDATE licenses SET points = 0 WHERE code = ?`).run(TEST_CODE)
  r = await postJson(base, '/reserve', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-low',
    nodeKind: 'video',
    executionTarget: 'workflow',
  })
  assert.equal(r.j.success, false)

  db.prepare(`UPDATE licenses SET points = 100 WHERE code = ?`).run(TEST_CODE)
  r = await postJson(base, '/reserve', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-cf',
    nodeKind: 'text',
    executionTarget: 'model',
  })
  assert.equal(r.j.success, true)
  r = await postJson(base, '/confirm-failure', {
    licenseCode: TEST_CODE,
    machineCode: MACHINE,
    dedupeKey: 'dedupe-cf',
    errorText: 'unit test dlq',
  })
  assert.equal(r.j.success, true)
  const dlq = db.prepare(`SELECT COUNT(*) AS c FROM points_confirm_failures WHERE dedupe_key = 'dedupe-cf'`).get()
  assert.ok(Number(dlq.c) >= 1)

  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })

  /** 与生产一致的 /pts 前缀：管理端发码 → verify 绑定 → reserve 预扣 → 列表可查 */
  const mount = '/pts'
  const admTok = 'e2e-admin-token'
  const appFull = express()
  appFull.use(express.json({ limit: '256kb' }))
  appFull.use(`${mount}/api/points`, createPointsRouter(db, { adminToken: admTok }))
  appFull.use(`${mount}/api/license`, createLicenseRouter(db))
  appFull.use(`${mount}/api/admin`, createAdminRouter(db, { adminToken: admTok }))
  const fullServer = appFull.listen(0)
  await once(fullServer, 'listening')
  const fPort = /** @type {import('node:net').AddressInfo} */ (fullServer.address()).port
  const origin = `http://127.0.0.1:${fPort}`

  const postPts = (path, body) =>
    fetch(`${origin}${mount}/api/points${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (res) => ({ res, j: await res.json().catch(() => ({})) }))

  let fr = await fetch(`${origin}${mount}/api/admin/licenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': admTok },
    body: JSON.stringify({ points: 80, count: 1, expireDays: 1 }),
  }).then(async (res) => ({ res, j: await res.json().catch(() => ({})) }))
  assert.equal(fr.res.status, 200, `admin batch create: ${JSON.stringify(fr.j)}`)
  assert.equal(fr.j.ok, true)
  assert.ok(Array.isArray(fr.j.created) && fr.j.created.length === 1)
  const batchCode = String(fr.j.created[0].code || '')
  assert.ok(batchCode.length > 8)

  const e2eMachine = 'e2e-machine-fullflow'
  fr = await fetch(`${origin}${mount}/api/license/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseCode: batchCode, machineCode: e2eMachine }),
  }).then(async (res) => ({ res, j: await res.json().catch(() => ({})) }))
  assert.equal(fr.res.status, 200)
  assert.equal(fr.j.valid, true)
  assert.equal(fr.j.points, 80)

  fr = await postPts('/reserve', {
    licenseCode: batchCode,
    machineCode: e2eMachine,
    dedupeKey: 'e2e-fullflow-reserve-1',
    nodeKind: 'text',
    executionTarget: 'model',
  })
  assert.equal(fr.res.status, 200)
  assert.equal(fr.j.success, true)
  assert.equal(fr.j.remainingPoints, 79)

  fr = await fetch(
    `${origin}${mount}/api/admin/licenses?page=1&pageSize=50&code=${encodeURIComponent(batchCode.slice(0, 4))}`,
    { headers: { 'x-admin-token': admTok } },
  ).then(async (res) => ({ res, j: await res.json().catch(() => ({})) }))
  assert.equal(fr.res.status, 200)
  assert.equal(fr.j.ok, true)
  assert.ok((fr.j.licenses || []).some((row) => String(row.code) === batchCode))

  await new Promise((resolve, reject) => {
    fullServer.close((err) => (err ? reject(err) : resolve()))
  })

  db.close()
  // eslint-disable-next-line no-console
  console.log('points.test.js: OK')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
