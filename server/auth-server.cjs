const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const express = require('express')
const cors = require('cors')

const PORT = Number(process.env.AUTH_SERVER_PORT || 3721)
const LICENSE_DAYS = Number(process.env.AUTH_LICENSE_DAYS || 30)
const ADMIN_SECRET = process.env.AUTH_ADMIN_SECRET || 'flowid-admin-dev'
const SYSTEM_PROMPT_HMAC_SECRET =
  process.env.SYSTEM_PROMPT_HMAC_SECRET || process.env.AUTH_JWT_SECRET || 'flowid-system-prompt-dev-secret'
const DB_PATH = path.resolve(__dirname, 'auth-db.json')
const TEMPLATES_DIR = path.resolve(__dirname, 'templates')
const TEMPLATE_INDEX_PATH = path.join(TEMPLATES_DIR, 'index.json')
const SYSTEM_PROMPTS_DIR = path.resolve(__dirname, 'system-prompts')
const SYSTEM_PROMPTS_INDEX_PATH = path.join(SYSTEM_PROMPTS_DIR, 'index.json')
const CLOUD_MODELS_PATH = path.resolve(__dirname, 'cloud-models.json')
const USER_AGREEMENT_PATH = path.resolve(__dirname, 'user-agreement.json')
const DAY_MS = 24 * 60 * 60 * 1000
const TASK_TIMEOUT_MS = 30 * 60 * 1000
const tasks = new Map()

/**
 * @typedef {'active'|'expiring_soon'|'expired'|'frozen'} LicenseStatus
 */

/**
 * @typedef {{
 *  id: string
 *  account: string
 *  nickname: string
 *  passwordHash: string
 *  machineCode?: string
 *  expiresAtMs: number
 *  frozen: boolean
 *  createdAtMs: number
 * }} UserRecord
 */

/**
 * @typedef {{
 *  users?: UserRecord[]
 *  licenses?: Array<{
 *    codeHash: string
 *    expiresAtMs: number
 *    entitlements?: Record<string, any>
 *    frozen?: boolean
 *    boundMachineId?: string
 *    createdAtMs: number
 *  }>
 * }} AuthDb
 */

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: [], licenses: [] }
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8')
  }
}

/**
 * @returns {AuthDb}
 */
function readDb() {
  ensureDb()
  const raw = fs.readFileSync(DB_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return { users: [], licenses: [] }
  if (!Array.isArray(parsed.users)) parsed.users = []
  if (!Array.isArray(parsed.licenses)) parsed.licenses = []
  return parsed
}

/**
 * @param {AuthDb} db
 */
function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
}

function ensureCloudModels() {
  if (!fs.existsSync(CLOUD_MODELS_PATH)) {
    const initial = { token: '', providers: [] }
    fs.writeFileSync(CLOUD_MODELS_PATH, JSON.stringify(initial, null, 2), 'utf8')
  }
}

function readCloudModels() {
  ensureCloudModels()
  try {
    const raw = fs.readFileSync(CLOUD_MODELS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { token: '', providers: [] }
    if (!Array.isArray(parsed.providers)) parsed.providers = []
    parsed.token = String(parsed.token || '')
    // 兼容旧数据：曾有版本把对象模型 String() 成 "[object Object]"，这里丢弃这些脏值
    parsed.providers = parsed.providers
      .map((p) => {
        const modelsRaw = Array.isArray(p?.models) ? p.models : []
        const models = modelsRaw
          .map((m) => {
            if (typeof m === 'string') {
              const s = String(m).trim()
              if (!s || s === '[object Object]') return null
              return s
            }
            if (m && typeof m === 'object') {
              const name = String(m?.name || m?.model || '').trim()
              if (!name || name === '[object Object]') return null
              return { name, nodeKind: String(m?.nodeKind || '').trim() }
            }
            return null
          })
          .filter(Boolean)
        return { ...p, models }
      })
      .filter((p) => p && (p.id || p.provider))
    return parsed
  } catch {
    return { token: '', providers: [] }
  }
}

function writeCloudModels(next) {
  const token = String(next?.token || '')
  const providers = Array.isArray(next?.providers) ? next.providers : []
  fs.writeFileSync(CLOUD_MODELS_PATH, JSON.stringify({ token, providers }, null, 2), 'utf8')
}

function readUserAgreement() {
  try {
    if (!fs.existsSync(USER_AGREEMENT_PATH)) {
      return { version: '2026-04', text: '', updatedAtMs: 0 }
    }
    const raw = fs.readFileSync(USER_AGREEMENT_PATH, 'utf8')
    const j = JSON.parse(raw)
    return {
      version: String(j?.version || '2026-04').trim() || '2026-04',
      text: String(j?.text || ''),
      updatedAtMs: Number(j?.updatedAtMs) || 0,
    }
  } catch {
    return { version: '2026-04', text: '', updatedAtMs: 0 }
  }
}

/**
 * @param {{ version?: string, text: string, updatedAtMs?: number }} next
 */
function writeUserAgreement(next) {
  const version = String(next?.version || '').trim() || '2026-04'
  const text = String(next?.text || '')
  const updatedAtMs = Number.isFinite(Number(next?.updatedAtMs)) ? Number(next.updatedAtMs) : Date.now()
  fs.writeFileSync(USER_AGREEMENT_PATH, JSON.stringify({ version, text, updatedAtMs }, null, 2), 'utf8')
}

function ensureTemplatesIndex() {
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true })
  if (!fs.existsSync(TEMPLATE_INDEX_PATH)) {
    fs.writeFileSync(
      TEMPLATE_INDEX_PATH,
      JSON.stringify(
        {
          templates: [],
        },
        null,
        2,
      ),
      'utf8',
    )
  }
}

function readTemplatesIndex() {
  ensureTemplatesIndex()
  const raw = fs.readFileSync(TEMPLATE_INDEX_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed.templates) ? parsed.templates : []
}

/**
 * @param {Array<Record<string, unknown>>} templates
 */
function writeTemplatesIndex(templates) {
  ensureTemplatesIndex()
  fs.writeFileSync(
    TEMPLATE_INDEX_PATH,
    JSON.stringify(
      {
        templates,
      },
      null,
      2,
    ),
    'utf8',
  )
}

function ensureSystemPromptsIndex() {
  if (!fs.existsSync(SYSTEM_PROMPTS_DIR)) fs.mkdirSync(SYSTEM_PROMPTS_DIR, { recursive: true })
  if (!fs.existsSync(SYSTEM_PROMPTS_INDEX_PATH)) {
    fs.writeFileSync(
      SYSTEM_PROMPTS_INDEX_PATH,
      JSON.stringify(
        {
          prompts: [],
        },
        null,
        2,
      ),
      'utf8',
    )
  }
}

function readSystemPromptsIndex() {
  ensureSystemPromptsIndex()
  const raw = fs.readFileSync(SYSTEM_PROMPTS_INDEX_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed.prompts) ? parsed.prompts : []
}

/**
 * @param {Array<Record<string, unknown>>} prompts
 */
function writeSystemPromptsIndex(prompts) {
  ensureSystemPromptsIndex()
  fs.writeFileSync(
    SYSTEM_PROMPTS_INDEX_PATH,
    JSON.stringify(
      {
        prompts,
      },
      null,
      2,
    ),
    'utf8',
  )
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex')
}

function hmacHex(text) {
  return crypto.createHmac('sha256', String(SYSTEM_PROMPT_HMAC_SECRET || '')).update(String(text || ''), 'utf8').digest('hex')
}

/**
 * 生成安全的 workflow 文件名片段，仅保留字母/数字/-/_。
 * @param {string} raw
 */
function toSafeFileToken(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 将请求中的工作流 JSON 统一解析为对象。
 * @param {unknown} input
 */
function parseWorkflowJsonInput(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) throw new Error('workflowJson 不能为空')
    return JSON.parse(trimmed)
  }
  if (input && typeof input === 'object') return input
  throw new Error('workflowJson 格式错误，需为 JSON 字符串或对象')
}

function resolveRequestBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

function getComfyAuthHeaders(provider) {
  const headers = { 'Content-Type': 'application/json' }
  if (provider && typeof provider.apiKey === 'string' && provider.apiKey.trim()) {
    headers.Authorization = `Bearer ${provider.apiKey.trim()}`
  }
  return headers
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function replacePlaceholders(value, params) {
  if (typeof value === 'string') {
    if (/^__[A-Z0-9_]+__$/u.test(value)) {
      const key = value.slice(2, -2).toLowerCase()
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        return params[key]
      }
      return value
    }
    let out = value
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`__${String(k).toUpperCase()}__`, String(v))
    }
    return out
  }
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, params))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = replacePlaceholders(v, params)
    return out
  }
  return value
}

function extractRenderableUrls(historyEntry, requestBase) {
  const urls = []
  const pushRef = (record) => {
    if (!record || typeof record !== 'object') return
    const filename = typeof record.filename === 'string' ? record.filename : null
    if (!filename) return
    const subfolder = typeof record.subfolder === 'string' ? record.subfolder : ''
    const type = typeof record.type === 'string' ? record.type : 'output'
    const params = new URLSearchParams({ filename, subfolder, type })
    urls.push(`${requestBase}/view?${params.toString()}`)
  }
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    pushRef(value)
    Object.values(value).forEach(walk)
  }
  walk(historyEntry.outputs)
  walk(historyEntry.ui)
  return Array.from(new Set(urls))
}

async function submitTemplateTask({
  taskId,
  template,
  provider,
  params,
}) {
  const task = tasks.get(taskId)
  if (!task) return
  try {
    task.status = 'submitting'
    const templatePath = path.join(TEMPLATES_DIR, template.workflowFile)
    if (!fs.existsSync(templatePath)) throw new Error(`模板文件不存在：${template.workflowFile}`)
    const templateRaw = fs.readFileSync(templatePath, 'utf8')
    const templateJson = JSON.parse(templateRaw)
    const prompt = replacePlaceholders(templateJson, params)
    const requestBase = resolveRequestBase(provider.baseUrl)
    if (!requestBase) throw new Error('provider.baseUrl 不能为空')

    const submitRes = await fetch(`${requestBase}/prompt`, {
      method: 'POST',
      headers: getComfyAuthHeaders(provider),
      body: JSON.stringify({ prompt }),
    })
    const submitJson = await submitRes.json().catch(() => ({}))
    if (!submitRes.ok) {
      throw new Error(String(submitJson.error || submitJson.message || `提交失败 ${submitRes.status}`))
    }
    const promptId = String(submitJson.prompt_id || '').trim()
    if (!promptId) throw new Error('Comfy 未返回 prompt_id')
    task.promptId = promptId
    task.status = 'running'

    const deadline = Date.now() + TASK_TIMEOUT_MS
    while (Date.now() < deadline) {
      const historyRes = await fetch(`${requestBase}/history/${encodeURIComponent(promptId)}`, {
        headers: getComfyAuthHeaders(provider),
      })
      if (historyRes.ok) {
        const scopedJson = await historyRes.json().catch(() => ({}))
        const entry =
          scopedJson && typeof scopedJson === 'object'
            ? scopedJson[promptId] || scopedJson
            : null
        if (entry && typeof entry === 'object') {
          const urls = extractRenderableUrls(entry, requestBase)
          if (urls.length) {
            task.status = 'success'
            task.result = { mediaUrls: urls, history: entry }
            task.finishedAtMs = Date.now()
            return
          }
        }
      }
      await sleep(2000)
    }
    task.status = 'error'
    task.error = `任务超时（>${TASK_TIMEOUT_MS / 1000}s）`
    task.finishedAtMs = Date.now()
  } catch (error) {
    task.status = 'error'
    task.error = String(error?.message || error || '未知错误')
    task.finishedAtMs = Date.now()
  }
}

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function normalizeTier(v) {
  const t = String(v || '').trim().toLowerCase()
  return t === 'pro' ? 'pro' : 'free'
}

function isLicenseActive(license) {
  if (!license) return false
  if (license.frozen) return false
  return Number(license.expiresAtMs || 0) > Date.now()
}

function pickEntitlements(license) {
  const ent = license && typeof license.entitlements === 'object' ? license.entitlements : null
  return ent && !Array.isArray(ent) ? ent : undefined
}

function resolveLicenseFromHeaders(req) {
  const licenseCode = String(req.headers['x-license-code'] || '').trim()
  const machineId = String(req.headers['x-machine-id'] || '').trim()
  if (!licenseCode || !machineId) return { ok: false, message: '缺少授权信息（x-license-code / x-machine-id）' }
  const db = readDb()
  const codeHash = sha256(licenseCode)
  const license = (db.licenses || []).find((l) => l.codeHash === codeHash)
  if (!license) return { ok: false, message: '授权码无效' }
  if (license.boundMachineId && license.boundMachineId !== machineId) {
    return { ok: false, message: '授权码已绑定其他设备' }
  }
  if (license.frozen) return { ok: false, message: '授权已冻结' }
  if (!Number(license.expiresAtMs || 0) || Number(license.expiresAtMs || 0) <= Date.now()) {
    return { ok: false, message: '授权已到期' }
  }
  return { ok: true, license, licenseCode, machineId, db }
}

function resolveLicenseFromHeadersOptional(req) {
  const licenseCode = String(req.headers['x-license-code'] || '').trim()
  const machineId = String(req.headers['x-machine-id'] || '').trim()
  if (!licenseCode || !machineId) return { ok: true, license: null, entitlements: {}, reason: 'missing_headers' }
  const db = readDb()
  const codeHash = sha256(licenseCode)
  const license = (db.licenses || []).find((l) => l.codeHash === codeHash)
  if (!license) return { ok: true, license: null, entitlements: {}, reason: 'invalid_code' }
  if (license.boundMachineId && license.boundMachineId !== machineId) {
    return { ok: true, license: null, entitlements: {}, reason: 'machine_mismatch' }
  }
  if (license.frozen) return { ok: true, license: null, entitlements: {}, reason: 'frozen' }
  return { ok: true, license, entitlements: pickEntitlements(license) || {}, reason: 'ok' }
}

/**
 * @param {UserRecord} user
 * @returns {LicenseStatus}
 */
function resolveLicenseStatus(user) {
  if (user.frozen) return 'frozen'
  const left = user.expiresAtMs - Date.now()
  if (left <= 0) return 'expired'
  if (left <= 3 * DAY_MS) return 'expiring_soon'
  return 'active'
}

/**
 * @param {UserRecord} user
 */
function toAuthPayload(user) {
  return {
    userId: user.id,
    account: user.account,
    nickname: user.nickname,
    machineCode: user.machineCode || '',
    licenseStatus: resolveLicenseStatus(user),
    expiresAtMs: user.expiresAtMs,
    token: '',
  }
}

const app = express()
app.use(cors())
// Proxy requests (OpenAI compat) may include larger JSON payloads.
app.use(express.json({ limit: '25mb' }))

// 用户协议：必须在 express.static 之前注册，避免与 public 下路径混淆；若进程未加载到这些路由会表现为 HTTP 404。
app.get('/user-agreement', (_req, res) => {
  const u = readUserAgreement()
  res.json({
    version: u.version,
    text: u.text,
    updatedAtMs: u.updatedAtMs,
    serverTimeMs: Date.now(),
  })
})
app.get('/admin/user-agreement', adminMiddleware, (_req, res) => {
  const u = readUserAgreement()
  res.json({ ...u, serverTimeMs: Date.now() })
})
app.post('/admin/user-agreement/save', adminMiddleware, (req, res) => {
  const text = String(req.body?.text ?? '')
  if (!String(text).trim()) {
    res.status(400).json({ message: '协议正文不能为空' })
    return
  }
  const prev = readUserAgreement()
  const versionIn = String(req.body?.version ?? '').trim()
  const bump = Boolean(req.body?.bumpVersion)
  const prevVersion = String(prev.version || '2026-04').trim() || '2026-04'
  const textChanged = text !== String(prev.text || '')
  const versionTouched = Boolean(versionIn) && versionIn !== prevVersion
  let version = versionIn || prevVersion
  if (bump || (textChanged && !versionIn)) {
    version = `rev-${Date.now()}`
  }
  const prevMs = Number(prev.updatedAtMs) || 0
  const shouldBumpTime = bump || textChanged || versionTouched || version !== prevVersion
  const updatedAtMs = shouldBumpTime ? Date.now() : prevMs
  writeUserAgreement({ version, text, updatedAtMs })
  res.json({ ok: true, version, text, updatedAtMs, serverTimeMs: Date.now() })
})

/**
 * 公开：下载模板工程 JSON 正文。
 * 必须放在 express.static 之前：否则 `public/` 下若出现与 URL 重叠的路径，可能被静态中间件先处理并 404，动态路由永远接不到。
 */
function sendPublicTemplateWorkflow(req, res) {
  try {
    const id = String(req.params.id || '').trim()
    const template = readTemplatesIndex().find((item) => item.id === id)
    if (!template) {
      res.status(404).json({ message: '模板不存在' })
      return
    }
    const tier = normalizeTier(template.tier)
    const resolved = resolveLicenseFromHeadersOptional(req)
    const canSeePro = Boolean(resolved.entitlements?.proTemplates) && isLicenseActive(resolved.license)
    if (tier === 'pro' && !canSeePro) {
      res.status(403).json({ message: '该模板为会员内容，请先激活授权' })
      return
    }
    const fileName = String(template.workflowFile || '').trim()
    if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      res.status(400).json({ message: '模板 workflow 文件名无效' })
      return
    }
    const templatePath = path.join(TEMPLATES_DIR, fileName)
    if (!fs.existsSync(templatePath)) {
      res.status(404).json({ message: `模板文件不存在：${fileName}` })
      return
    }
    const raw = fs.readFileSync(templatePath, 'utf8')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.send(raw)
  } catch (error) {
    res.status(500).json({ message: String(error?.message || error || '读取模板失败') })
  }
}

app.get('/templates/:id/workflow', sendPublicTemplateWorkflow)
app.get('/templates/:id/workflow.json', sendPublicTemplateWorkflow)

app.use(express.static(path.join(__dirname, 'public')))

// 后端管理页入口（静态页面；接口仍由 /admin/* 提供）
app.get('/admin', (_req, res) => {
  res.redirect('/admin.html')
})

function isAllowedProxyTarget(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim())
    const host = u.hostname.toLowerCase()
    // Allowlist: DashScope OpenAI-compatible endpoint.
    // Extend here if you add more providers.
    if (host === 'dashscope.aliyuncs.com') return true
    return false
  } catch {
    return false
  }
}

/**
 * CORS-safe proxy for OpenAI-compatible APIs.
 * Frontend (5173) cannot directly call some cloud endpoints due to CORS.
 * This proxy runs on 3721 and forwards the request server-side.
 *
 * Body: { url, method, headers?, json? }
 */
app.post('/proxy/openai', async (req, res) => {
  const url = String(req.body?.url || '').trim()
  const method = String(req.body?.method || 'GET').trim().toUpperCase()
  const headers = req.body?.headers && typeof req.body.headers === 'object' ? req.body.headers : {}
  const json = req.body?.json
  if (!url || !isAllowedProxyTarget(url)) {
    res.status(400).json({ message: 'Proxy target not allowed' })
    return
  }
  try {
    const upstream = await fetch(url, {
      method,
      headers,
      body: json != null && method !== 'GET' ? JSON.stringify(json) : undefined,
    })
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    res.status(upstream.status)
    res.setHeader('content-type', contentType)
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.send(buf)
  } catch (e) {
    res.status(502).json({ message: String(e?.message || e || 'proxy failed') })
  }
})

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'flowid-auth-server' })
})

/**
 * 辅助模式（配置下发）：拉取后台预设的「模型 + 接口地址」配置。
 * - 不做鉴权：用户请求与结果都直连第三方；此处仅下发可用的 baseUrl/model 清单。
 * - Response: { providers: [{ id, label, baseUrl, models[] }], serverTimeMs }
 */
app.get('/cloud-models', (_req, res) => {
  const cfg = readCloudModels()
  const providers = (cfg.providers || [])
    .map((p) => ({
      id: String(p?.id || p?.provider || ''),
      label: String(p?.label || p?.id || p?.provider || ''),
      baseUrl: String(p?.baseUrl || ''),
      models: Array.isArray(p?.models)
        ? p.models
            .map((m) => {
              if (typeof m === 'string') return { name: String(m), nodeKind: '' }
              if (m && typeof m === 'object')
                return {
                  name: String(m?.name || m?.model || ''),
                  nodeKind: String(m?.nodeKind || ''),
                }
              return null
            })
            .filter(Boolean)
        : [],
    }))
    .filter((p) => p.id && p.baseUrl)
  res.json({ providers, serverTimeMs: Date.now() })
})

app.get('/templates', licenseMiddleware, (req, res) => {
  // legacy: kept for compatibility, but we now allow public free listing via optional license.
  res.redirect('/templates/groups')
})

app.get('/templates/groups', (req, res) => {
  const resolved = resolveLicenseFromHeadersOptional(req)
  const canSeePro = Boolean(resolved.entitlements?.proTemplates) && isLicenseActive(resolved.license)
  const all = readTemplatesIndex().map((item) => ({
    id: item.id,
    name: item.name,
    version: item.version,
    category: item.category || 'image',
    description: item.description || '',
    paramsSchema: item.paramsSchema || {},
    tier: normalizeTier(item.tier),
  }))
  const free = all.filter((t) => t.tier === 'free')
  const pro = canSeePro ? all.filter((t) => t.tier === 'pro') : []
  res.json({
    groups: [
      { id: 'free', label: '免费预设模板', tier: 'free', items: free },
      { id: 'member', label: '会员预设模板', tier: 'pro', items: pro },
    ],
    serverTimeMs: Date.now(),
  })
})

app.get('/templates/:id', (req, res) => {
  const id = String(req.params.id || '').trim()
  const template = readTemplatesIndex().find((item) => item.id === id)
  if (!template) {
    res.status(404).json({ message: '模板不存在' })
    return
  }
  const tier = normalizeTier(template.tier)
  const resolved = resolveLicenseFromHeadersOptional(req)
  const canSeePro = Boolean(resolved.entitlements?.proTemplates) && isLicenseActive(resolved.license)
  if (tier === 'pro' && !canSeePro) {
    res.status(403).json({ message: '该模板为会员内容，请先激活授权' })
    return
  }
  res.json({
    id: template.id,
    name: template.name,
    version: template.version,
    category: template.category || 'image',
    description: template.description || '',
    paramsSchema: template.paramsSchema || {},
    workflowFile: template.workflowFile,
    tier,
  })
})

app.get('/system-prompts', (req, res) => {
  // legacy endpoint: return groups as well (keeps old clients working)
  res.redirect('/system-prompts/groups')
})

app.get('/system-prompts/groups', (req, res) => {
  const resolved = resolveLicenseFromHeadersOptional(req)
  const canSeePro = Boolean(resolved.entitlements?.proTemplates) && isLicenseActive(resolved.license)
  const all = readSystemPromptsIndex().map((item) => ({
    id: item.id,
    name: item.name,
    version: item.version,
    category: item.category || 'general',
    description: item.description || '',
    tier: normalizeTier(item.tier),
  }))
  const free = all.filter((p) => p.tier === 'free')
  const pro = canSeePro ? all.filter((p) => p.tier === 'pro') : []
  res.json({
    groups: [
      { id: 'free', label: '免费提示词模板', tier: 'free', items: free },
      { id: 'member', label: '会员提示词模板', tier: 'pro', items: pro },
    ],
    serverTimeMs: Date.now(),
  })
})

app.get('/system-prompts/:id', (req, res) => {
  const id = String(req.params.id || '').trim()
  const prompt = readSystemPromptsIndex().find((item) => item.id === id)
  if (!prompt) {
    res.status(404).json({ message: '系统提示词不存在' })
    return
  }
  const tier = normalizeTier(prompt.tier)
  const resolved = resolveLicenseFromHeadersOptional(req)
  const canSeePro = Boolean(resolved.entitlements?.proTemplates) && isLicenseActive(resolved.license)
  if (tier === 'pro' && !canSeePro) {
    res.status(403).json({ message: '该系统提示词为会员内容，请先激活授权' })
    return
  }
  const promptPath = path.join(SYSTEM_PROMPTS_DIR, prompt.promptFile)
  if (!fs.existsSync(promptPath)) {
    res.status(404).json({ message: `系统提示词文件不存在：${prompt.promptFile}` })
    return
  }
  const text = fs.readFileSync(promptPath, 'utf8')
  const hash = sha256Hex(text)
  const sig = hmacHex(`${prompt.id}:${hash}:${prompt.version}`)
  if (prompt.sha256 !== hash || prompt.sig !== sig) {
    res.status(409).json({ message: '系统提示词校验失败：检测到文件被篡改' })
    return
  }
  res.json({
    id: prompt.id,
    name: prompt.name,
    version: prompt.version,
    category: prompt.category || 'general',
    description: prompt.description || '',
    systemPromptText: text,
    tier,
  })
})

app.post('/tasks/submit', licenseMiddleware, (req, res) => {
  const templateId = String(req.body?.templateId || '').trim()
  const params = req.body?.params && typeof req.body.params === 'object' ? req.body.params : {}
  const provider = req.body?.provider && typeof req.body.provider === 'object' ? req.body.provider : {}
  if (!templateId) {
    res.status(400).json({ message: 'templateId 不能为空' })
    return
  }
  if (!provider.baseUrl || !String(provider.baseUrl).trim()) {
    res.status(400).json({ message: 'provider.baseUrl 不能为空' })
    return
  }
  const template = readTemplatesIndex().find((item) => item.id === templateId)
  if (!template) {
    res.status(404).json({ message: '模板不存在' })
    return
  }
  const taskId = crypto.randomUUID()
  tasks.set(taskId, {
    id: taskId,
    templateId,
    status: 'queued',
    createdAtMs: Date.now(),
    promptId: '',
    result: null,
    error: '',
  })
  void submitTemplateTask({ taskId, template, provider, params })
  res.json({ taskId, status: 'queued' })
})

app.get('/tasks/:taskId/status', licenseMiddleware, (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = tasks.get(taskId)
  if (!task) {
    res.status(404).json({ message: '任务不存在' })
    return
  }
  res.json({
    taskId: task.id,
    templateId: task.templateId,
    status: task.status,
    promptId: task.promptId,
    error: task.error || undefined,
    result: task.result || undefined,
    createdAtMs: task.createdAtMs,
    finishedAtMs: task.finishedAtMs || undefined,
  })
})

app.post('/license/activate', (req, res) => {
  const licenseCode = String(req.body?.licenseCode || '').trim()
  const machineId = String(req.body?.machineId || '').trim()
  if (!licenseCode || !machineId) {
    res.status(400).json({ message: 'licenseCode / machineId 不能为空' })
    return
  }
  const db = readDb()
  const codeHash = sha256(licenseCode)
  const lic = (db.licenses || []).find((l) => l.codeHash === codeHash)
  if (!lic) {
    res.status(404).json({ message: '授权码无效' })
    return
  }
  if (lic.frozen) {
    res.status(403).json({ message: '授权已冻结' })
    return
  }
  if (lic.boundMachineId && lic.boundMachineId !== machineId) {
    res.status(403).json({ message: '授权码已绑定其他设备' })
    return
  }
  if (!lic.boundMachineId) {
    lic.boundMachineId = machineId
    writeDb(db)
  }
  res.json({
    licenseCode,
    machineId,
    expiresAtMs: lic.expiresAtMs,
    entitlements: pickEntitlements(lic),
    serverTimeMs: Date.now(),
  })
})

app.post('/license/verify', (req, res) => {
  const licenseCode = String(req.body?.licenseCode || '').trim()
  const machineId = String(req.body?.machineId || '').trim()
  if (!licenseCode || !machineId) {
    res.status(400).json({ message: 'licenseCode / machineId 不能为空' })
    return
  }
  const db = readDb()
  const codeHash = sha256(licenseCode)
  const lic = (db.licenses || []).find((l) => l.codeHash === codeHash)
  if (!lic) {
    res.status(404).json({ message: '授权码无效' })
    return
  }
  if (lic.frozen) {
    res.status(403).json({ message: '授权已冻结' })
    return
  }
  if (lic.boundMachineId && lic.boundMachineId !== machineId) {
    res.status(403).json({ message: '授权码已绑定其他设备' })
    return
  }
  if (!lic.boundMachineId) {
    // 允许 verify 也完成首次绑定（对“先输入码再点刷新”的用户更友好）
    lic.boundMachineId = machineId
    writeDb(db)
  }
  res.json({
    licenseCode,
    machineId,
    expiresAtMs: lic.expiresAtMs,
    entitlements: pickEntitlements(lic),
    serverTimeMs: Date.now(),
  })
})

function licenseMiddleware(req, res, next) {
  const resolved = resolveLicenseFromHeaders(req)
  if (!resolved.ok) {
    res.status(401).json({ message: resolved.message })
    return
  }
  req.license = resolved.license
  req.licenseEntitlements = pickEntitlements(resolved.license) || {}
  next()
}

function adminMiddleware(req, res, next) {
  const adminToken = String(req.headers['x-admin-token'] || '').trim()
  /**
   * 开发模式放宽管理员口令校验：单机开发默认允许直接访问管理员模板接口。
   * 生产环境仍强制要求 x-admin-token。
   */
  if (process.env.NODE_ENV !== 'production' && !adminToken) {
    next()
    return
  }
  if (!adminToken || adminToken !== ADMIN_SECRET) {
    res.status(403).json({ message: '管理员权限不足或口令错误' })
    return
  }
  next()
}

app.get('/admin/cloud-models', adminMiddleware, (_req, res) => {
  const cfg = readCloudModels()
  res.json({
    providers: Array.isArray(cfg.providers) ? cfg.providers : [],
    serverTimeMs: Date.now(),
  })
})

app.post('/admin/cloud-models/save', adminMiddleware, (req, res) => {
  const providersRaw = Array.isArray(req.body?.providers) ? req.body.providers : []
  const providers = providersRaw
    .map((p) => ({
      id: String(p?.id || p?.provider || '').trim(),
      label: String(p?.label || p?.id || p?.provider || '').trim(),
      baseUrl: String(p?.baseUrl || '').trim(),
      models: Array.isArray(p?.models)
        ? p.models
            .map((m) => {
              if (typeof m === 'string') return { name: String(m), nodeKind: '' }
              if (m && typeof m === 'object')
                return {
                  name: String(m?.name || m?.model || '').trim(),
                  nodeKind: String(m?.nodeKind || '').trim(),
                }
              return null
            })
            .filter((x) => x && x.name)
        : [],
    }))
    .filter((p) => p.id && p.baseUrl)
  writeCloudModels({ token: String(readCloudModels()?.token || ''), providers })
  res.json({ ok: true, providers: providers.length, serverTimeMs: Date.now() })
})

app.post('/admin/licenses/issue', adminMiddleware, (req, res) => {
  const daysRaw = Number(req.body?.days)
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(3650, Math.floor(daysRaw))) : LICENSE_DAYS
  const entitlements =
    req.body?.entitlements && typeof req.body.entitlements === 'object' && !Array.isArray(req.body.entitlements)
      ? req.body.entitlements
      : { proTemplates: true, cloudModels: true }
  const now = Date.now()
  const licenseCode = `LIC-${crypto.randomUUID().replaceAll('-', '')}`
  const codeHash = sha256(licenseCode)
  const db = readDb()
  db.licenses = Array.isArray(db.licenses) ? db.licenses : []
  db.licenses.unshift({
    codeHash,
    expiresAtMs: now + days * DAY_MS,
    entitlements,
    frozen: false,
    boundMachineId: '',
    createdAtMs: now,
  })
  writeDb(db)
  res.json({
    ok: true,
    licenseCode,
    expiresAtMs: now + days * DAY_MS,
    entitlements,
  })
})

app.get('/admin/licenses', adminMiddleware, (_req, res) => {
  const db = readDb()
  const list = (db.licenses || []).map((l) => ({
    codeHash: String(l.codeHash || ''),
    id: String(l.codeHash || '').slice(0, 12),
    expiresAtMs: Number(l.expiresAtMs || 0),
    frozen: Boolean(l.frozen),
    boundMachineId: String(l.boundMachineId || ''),
    entitlements: pickEntitlements(l) || {},
    createdAtMs: Number(l.createdAtMs || 0),
  }))
  list.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
  res.json({ total: list.length, licenses: list, serverTimeMs: Date.now() })
})

app.post('/admin/licenses/freeze', adminMiddleware, (req, res) => {
  const codeHash = String(req.body?.codeHash || '').trim()
  const frozen = Boolean(req.body?.frozen)
  if (!codeHash) return res.status(400).json({ message: 'codeHash 不能为空' })
  const db = readDb()
  const lic = (db.licenses || []).find((l) => String(l.codeHash || '') === codeHash)
  if (!lic) return res.status(404).json({ message: '授权不存在' })
  lic.frozen = frozen
  writeDb(db)
  res.json({ ok: true, codeHash, frozen: Boolean(lic.frozen), expiresAtMs: lic.expiresAtMs, serverTimeMs: Date.now() })
})

app.post('/admin/licenses/renew', adminMiddleware, (req, res) => {
  const codeHash = String(req.body?.codeHash || '').trim()
  const daysRaw = Number(req.body?.days)
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(3650, Math.floor(daysRaw))) : 30
  if (!codeHash) return res.status(400).json({ message: 'codeHash 不能为空' })
  const db = readDb()
  const lic = (db.licenses || []).find((l) => String(l.codeHash || '') === codeHash)
  if (!lic) return res.status(404).json({ message: '授权不存在' })
  const base = Math.max(Date.now(), Number(lic.expiresAtMs || 0))
  lic.expiresAtMs = base + days * DAY_MS
  writeDb(db)
  res.json({ ok: true, codeHash, addedDays: days, expiresAtMs: lic.expiresAtMs, serverTimeMs: Date.now() })
})

app.post('/admin/licenses/unbind', adminMiddleware, (req, res) => {
  const codeHash = String(req.body?.codeHash || '').trim()
  if (!codeHash) return res.status(400).json({ message: 'codeHash 不能为空' })
  const db = readDb()
  const lic = (db.licenses || []).find((l) => String(l.codeHash || '') === codeHash)
  if (!lic) return res.status(404).json({ message: '授权不存在' })
  lic.boundMachineId = ''
  writeDb(db)
  res.json({ ok: true, codeHash, boundMachineId: '', serverTimeMs: Date.now() })
})

/**
 * 重新签发授权码（用于无法找回原始授权码时重新发放给用户）
 * - 会生成新的 licenseCode，并更新 codeHash
 * - 默认清空机器绑定并解除冻结（以便新码可激活）
 * - 保留原 expiresAtMs / entitlements
 */
app.post('/admin/licenses/reissue', adminMiddleware, (req, res) => {
  const codeHash = String(req.body?.codeHash || '').trim()
  if (!codeHash) return res.status(400).json({ message: 'codeHash 不能为空' })
  const db = readDb()
  const lic = (db.licenses || []).find((l) => String(l.codeHash || '') === codeHash)
  if (!lic) return res.status(404).json({ message: '授权不存在' })
  const now = Date.now()
  const licenseCode = `LIC-${crypto.randomUUID().replaceAll('-', '')}`
  const nextHash = sha256(licenseCode)
  lic.codeHash = nextHash
  lic.boundMachineId = ''
  lic.frozen = false
  lic.createdAtMs = now
  writeDb(db)
  res.json({
    ok: true,
    licenseCode,
    codeHash: nextHash,
    expiresAtMs: Number(lic.expiresAtMs || 0),
    entitlements: pickEntitlements(lic) || {},
    serverTimeMs: now,
  })
})

app.post('/admin/licenses/entitlements', adminMiddleware, (req, res) => {
  const codeHash = String(req.body?.codeHash || '').trim()
  const entitlements =
    req.body?.entitlements && typeof req.body.entitlements === 'object' && !Array.isArray(req.body.entitlements)
      ? req.body.entitlements
      : null
  if (!codeHash) return res.status(400).json({ message: 'codeHash 不能为空' })
  if (!entitlements) return res.status(400).json({ message: 'entitlements 不能为空' })
  const db = readDb()
  const lic = (db.licenses || []).find((l) => String(l.codeHash || '') === codeHash)
  if (!lic) return res.status(404).json({ message: '授权不存在' })
  lic.entitlements = entitlements
  writeDb(db)
  res.json({ ok: true, codeHash, entitlements: pickEntitlements(lic) || {}, serverTimeMs: Date.now() })
})

app.post('/admin/licenses/delete', adminMiddleware, (req, res) => {
  const codeHash = String(req.body?.codeHash || '').trim()
  if (!codeHash) return res.status(400).json({ message: 'codeHash 不能为空' })
  const db = readDb()
  const before = Array.isArray(db.licenses) ? db.licenses.length : 0
  db.licenses = (db.licenses || []).filter((l) => String(l.codeHash || '') !== codeHash)
  const after = db.licenses.length
  if (after === before) return res.status(404).json({ message: '授权不存在' })
  writeDb(db)
  res.json({ ok: true, deleted: codeHash, total: after, serverTimeMs: Date.now() })
})

app.post('/admin/user/freeze', adminMiddleware, (req, res) => {
  const account = String(req.body?.account || '').trim()
  const frozen = Boolean(req.body?.frozen)
  if (!account) {
    res.status(400).json({ message: '账号不能为空' })
    return
  }
  const db = readDb()
  const user = db.users.find((u) => u.account.toLowerCase() === account.toLowerCase())
  if (!user) {
    res.status(404).json({ message: '账号不存在' })
    return
  }
  user.frozen = frozen
  writeDb(db)
  res.json({
    ok: true,
    account: user.account,
    frozen: user.frozen,
    licenseStatus: resolveLicenseStatus(user),
    expiresAtMs: user.expiresAtMs,
  })
})

app.post('/admin/users/delete', adminMiddleware, (req, res) => {
  const account = String(req.body?.account || '').trim()
  if (!account) return res.status(400).json({ message: '账号不能为空' })
  const db = readDb()
  const before = Array.isArray(db.users) ? db.users.length : 0
  db.users = (db.users || []).filter((u) => String(u.account || '').toLowerCase() !== account.toLowerCase())
  const after = db.users.length
  if (after === before) return res.status(404).json({ message: '账号不存在' })
  writeDb(db)
  res.json({ ok: true, deleted: account, total: after, serverTimeMs: Date.now() })
})

app.post('/admin/user/renew', adminMiddleware, (req, res) => {
  const account = String(req.body?.account || '').trim()
  const daysRaw = Number(req.body?.days)
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(3650, Math.floor(daysRaw))) : 30
  if (!account) {
    res.status(400).json({ message: '账号不能为空' })
    return
  }
  const db = readDb()
  const user = db.users.find((u) => u.account.toLowerCase() === account.toLowerCase())
  if (!user) {
    res.status(404).json({ message: '账号不存在' })
    return
  }
  const base = Math.max(Date.now(), user.expiresAtMs || 0)
  user.expiresAtMs = base + days * DAY_MS
  writeDb(db)
  res.json({
    ok: true,
    account: user.account,
    addedDays: days,
    licenseStatus: resolveLicenseStatus(user),
    expiresAtMs: user.expiresAtMs,
  })
})

app.get('/admin/users', adminMiddleware, (_req, res) => {
  const db = readDb()
  const users = db.users
    .map((user) => ({
      userId: user.id,
      account: user.account,
      nickname: user.nickname,
      machineCode: user.machineCode || '',
      licenseStatus: resolveLicenseStatus(user),
      expiresAtMs: user.expiresAtMs,
      frozen: user.frozen,
      createdAtMs: user.createdAtMs,
    }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
  res.json({
    total: users.length,
    users,
  })
})

app.get('/admin/templates', adminMiddleware, (_req, res) => {
  const templates = readTemplatesIndex().map((item) => ({
    id: item.id,
    name: item.name,
    version: item.version,
    category: item.category || 'image',
    description: item.description || '',
    tier: normalizeTier(item.tier),
    workflowFile: item.workflowFile,
    paramsSchema: item.paramsSchema || {},
  }))
  res.json({
    total: templates.length,
    templates,
  })
})

app.get('/admin/templates/:id', adminMiddleware, (req, res) => {
  const id = String(req.params.id || '').trim()
  const template = readTemplatesIndex().find((item) => item.id === id)
  if (!template) {
    res.status(404).json({ message: '模板不存在' })
    return
  }
  const templatePath = path.join(TEMPLATES_DIR, template.workflowFile)
  if (!fs.existsSync(templatePath)) {
    res.status(404).json({ message: `模板文件不存在：${template.workflowFile}` })
    return
  }
  const workflowJsonText = fs.readFileSync(templatePath, 'utf8')
  res.json({
    id: template.id,
    name: template.name,
    version: template.version,
    category: template.category || 'image',
    description: template.description || '',
    tier: normalizeTier(template.tier),
    workflowFile: template.workflowFile,
    paramsSchema: template.paramsSchema || {},
    workflowJsonText,
  })
})

app.get('/admin/system-prompts', adminMiddleware, (_req, res) => {
  const prompts = readSystemPromptsIndex().map((item) => ({
    id: item.id,
    name: item.name,
    version: item.version,
    category: item.category || 'general',
    description: item.description || '',
    tier: normalizeTier(item.tier),
    sha256: item.sha256,
    promptFile: item.promptFile,
  }))
  res.json({ total: prompts.length, prompts })
})

app.get('/admin/system-prompts/:id', adminMiddleware, (req, res) => {
  const id = String(req.params.id || '').trim()
  const prompt = readSystemPromptsIndex().find((item) => item.id === id)
  if (!prompt) {
    res.status(404).json({ message: '系统提示词不存在' })
    return
  }
  const promptPath = path.join(SYSTEM_PROMPTS_DIR, prompt.promptFile)
  if (!fs.existsSync(promptPath)) {
    res.status(404).json({ message: `系统提示词文件不存在：${prompt.promptFile}` })
    return
  }
  const text = fs.readFileSync(promptPath, 'utf8')
  const hash = sha256Hex(text)
  const sig = hmacHex(`${prompt.id}:${hash}:${prompt.version}`)
  if (prompt.sha256 !== hash || prompt.sig !== sig) {
    res.status(409).json({ message: '系统提示词校验失败：检测到文件被篡改' })
    return
  }
  res.json({
    id: prompt.id,
    name: prompt.name,
    version: prompt.version,
    category: prompt.category || 'general',
    description: prompt.description || '',
    tier: normalizeTier(prompt.tier),
    sha256: hash,
    promptFile: prompt.promptFile,
    systemPromptText: text,
  })
})

app.post('/admin/system-prompts/upload', adminMiddleware, (req, res) => {
  try {
    const idRaw = String(req.body?.id || '').trim()
    const name = String(req.body?.name || '').trim()
    const version = String(req.body?.version || '').trim() || '1.0.0'
    const category = String(req.body?.category || 'general').trim() || 'general'
    const tier = normalizeTier(req.body?.tier)
    const description = String(req.body?.description || '').trim()
    const systemPromptText = String(req.body?.systemPromptText || '').trim()
    const id = idRaw || crypto.randomUUID()
    if (!name) {
      res.status(400).json({ message: 'name 不能为空' })
      return
    }
    if (!systemPromptText) {
      res.status(400).json({ message: 'systemPromptText 不能为空' })
      return
    }
    const prompts = readSystemPromptsIndex()
    if (prompts.some((item) => item.id === id)) {
      res.status(409).json({ message: '系统提示词 id 已存在，请使用其他 id' })
      return
    }
    ensureSystemPromptsIndex()
    const token = toSafeFileToken(id) || crypto.randomUUID()
    const promptFile = `${token}.system-prompt.txt`
    const promptPath = path.join(SYSTEM_PROMPTS_DIR, promptFile)
    fs.writeFileSync(promptPath, systemPromptText, 'utf8')
    const sha256 = sha256Hex(systemPromptText)
    const sig = hmacHex(`${id}:${sha256}:${version}`)
    const nextPrompt = {
      id,
      name,
      version,
      category,
      tier,
      description,
      promptFile,
      sha256,
      sig,
    }
    writeSystemPromptsIndex([nextPrompt, ...prompts])
    res.json({ ok: true, prompt: nextPrompt })
  } catch (error) {
    res.status(400).json({ message: String(error?.message || error || '上传系统提示词失败') })
  }
})

app.put('/admin/system-prompts/:id', adminMiddleware, (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).json({ message: '系统提示词 id 不能为空' })
      return
    }
    const prompts = readSystemPromptsIndex()
    const index = prompts.findIndex((item) => item.id === id)
    if (index < 0) {
      res.status(404).json({ message: '系统提示词不存在' })
      return
    }
    const current = prompts[index]
    const name = String(req.body?.name || current.name || '').trim()
    const version = String(req.body?.version || current.version || '').trim() || '1.0.0'
    const category = String(req.body?.category || current.category || 'general').trim() || 'general'
    const tier = normalizeTier(req.body?.tier ?? current.tier)
    const description = String(req.body?.description || current.description || '').trim()
    const systemPromptTextRaw = req.body?.systemPromptText
    const systemPromptText =
      typeof systemPromptTextRaw === 'string' ? systemPromptTextRaw.trim() : null
    if (!name) {
      res.status(400).json({ message: 'name 不能为空' })
      return
    }
    // If正文被提供，则落盘并重算校验。
    let sha256 = current.sha256
    let sig = current.sig
    if (systemPromptText != null) {
      if (!systemPromptText) {
        res.status(400).json({ message: 'systemPromptText 不能为空' })
        return
      }
      const promptPath = path.join(SYSTEM_PROMPTS_DIR, current.promptFile)
      fs.writeFileSync(promptPath, systemPromptText, 'utf8')
      sha256 = sha256Hex(systemPromptText)
      sig = hmacHex(`${id}:${sha256}:${version}`)
    } else {
      // Meta 更新也会影响签名（version 参与），保持可检测性。
      sig = hmacHex(`${id}:${sha256}:${version}`)
    }

    const next = {
      ...current,
      id,
      name,
      version,
      category,
      tier,
      description,
      sha256,
      sig,
    }
    const nextPrompts = prompts.slice()
    nextPrompts[index] = next
    writeSystemPromptsIndex(nextPrompts)
    res.json({ ok: true, prompt: next })
  } catch (error) {
    res.status(400).json({ message: String(error?.message || error || '更新系统提示词失败') })
  }
})

app.delete('/admin/system-prompts/:id', adminMiddleware, (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).json({ message: '系统提示词 id 不能为空' })
      return
    }
    const prompts = readSystemPromptsIndex()
    const index = prompts.findIndex((item) => item.id === id)
    if (index < 0) {
      res.status(404).json({ message: '系统提示词不存在' })
      return
    }
    const current = prompts[index]
    const promptPath = path.join(SYSTEM_PROMPTS_DIR, current.promptFile)
    try {
      if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath)
    } catch {
      // ignore
    }
    const nextPrompts = prompts.filter((item) => item.id !== id)
    writeSystemPromptsIndex(nextPrompts)
    res.json({ ok: true, removed: { id } })
  } catch (error) {
    res.status(400).json({ message: String(error?.message || error || '删除系统提示词失败') })
  }
})

app.post('/admin/templates/upload', adminMiddleware, (req, res) => {
  try {
    const idRaw = String(req.body?.id || '').trim()
    const name = String(req.body?.name || '').trim()
    const version = String(req.body?.version || '').trim() || '1.0.0'
    const category = String(req.body?.category || 'image').trim() || 'image'
    const tier = normalizeTier(req.body?.tier)
    const description = String(req.body?.description || '').trim()
    const paramsSchema =
      req.body?.paramsSchema && typeof req.body.paramsSchema === 'object'
        ? req.body.paramsSchema
        : {}
    const workflowJson = parseWorkflowJsonInput(req.body?.workflowJson)
    const id = idRaw || crypto.randomUUID()
    if (!name) {
      res.status(400).json({ message: 'name 不能为空' })
      return
    }
    const templates = readTemplatesIndex()
    if (templates.some((item) => item.id === id)) {
      res.status(409).json({ message: '模板 id 已存在，请使用其他 id' })
      return
    }
    const token = toSafeFileToken(id) || crypto.randomUUID()
    const workflowFile = `${token}.workflow.json`
    const workflowPath = path.join(TEMPLATES_DIR, workflowFile)
    fs.writeFileSync(workflowPath, JSON.stringify(workflowJson, null, 2), 'utf8')
    const nextTemplate = {
      id,
      name,
      version,
      category,
      tier,
      description,
      workflowFile,
      paramsSchema,
    }
    writeTemplatesIndex([nextTemplate, ...templates])
    res.json({ ok: true, template: nextTemplate })
  } catch (error) {
    res.status(400).json({ message: String(error?.message || error || '上传模板失败') })
  }
})

app.put('/admin/templates/:id', adminMiddleware, (req, res) => {
  const id = String(req.params.id || '').trim()
  if (!id) {
    res.status(400).json({ message: '模板 id 不能为空' })
    return
  }
  const templates = readTemplatesIndex()
  const index = templates.findIndex((item) => item.id === id)
  if (index < 0) {
    res.status(404).json({ message: '模板不存在' })
    return
  }
  const current = templates[index]
  const name = String(req.body?.name || current.name || '').trim()
  const version = String(req.body?.version || current.version || '').trim() || '1.0.0'
  const category = String(req.body?.category || current.category || 'image').trim() || 'image'
  const tier = normalizeTier(req.body?.tier ?? current.tier)
  const description =
    req.body?.description == null ? String(current.description || '') : String(req.body.description)
  const paramsSchema =
    req.body?.paramsSchema && typeof req.body.paramsSchema === 'object'
      ? req.body.paramsSchema
      : current.paramsSchema || {}
  if (!name) {
    res.status(400).json({ message: 'name 不能为空' })
    return
  }
  const next = {
    ...current,
    name,
    version,
    category,
    tier,
    description,
    paramsSchema,
  }
  const nextTemplates = templates.map((item) => (item.id === id ? next : item))
  writeTemplatesIndex(nextTemplates)
  res.json({ ok: true, template: next })
})

app.put('/admin/templates/:id/workflow', adminMiddleware, (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    const templates = readTemplatesIndex()
    const template = templates.find((item) => item.id === id)
    if (!template) {
      res.status(404).json({ message: '模板不存在' })
      return
    }
    const workflowJson = parseWorkflowJsonInput(req.body?.workflowJson)
    const workflowPath = path.join(TEMPLATES_DIR, template.workflowFile)
    fs.writeFileSync(workflowPath, JSON.stringify(workflowJson, null, 2), 'utf8')
    res.json({ ok: true, templateId: id, workflowFile: template.workflowFile })
  } catch (error) {
    res.status(400).json({ message: String(error?.message || error || '更新工作流失败') })
  }
})

app.delete('/admin/templates/:id', adminMiddleware, (req, res) => {
  const id = String(req.params.id || '').trim()
  const templates = readTemplatesIndex()
  const template = templates.find((item) => item.id === id)
  if (!template) {
    res.status(404).json({ message: '模板不存在' })
    return
  }
  const nextTemplates = templates.filter((item) => item.id !== id)
  writeTemplatesIndex(nextTemplates)
  const workflowPath = path.join(TEMPLATES_DIR, template.workflowFile)
  if (fs.existsSync(workflowPath)) {
    fs.unlinkSync(workflowPath)
  }
  res.json({ ok: true, deleted: id })
})

app.listen(PORT, () => {
  console.log(`[Flowid Auth] server running at http://127.0.0.1:${PORT}`)
  console.log(`[Flowid Auth] admin secret: ${ADMIN_SECRET}`)
})
