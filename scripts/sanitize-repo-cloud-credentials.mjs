/**
 * 开源前清理：移除仓库内 nowcoding.ai、节点内嵌 cloudApiKey、flowid-assist 绑定等。
 * 用法：node scripts/sanitize-repo-cloud-credentials.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CLOUD_ASSIST_EMPTY = {
  kinds: { text: [], image: [], video: [], audio: [], music: [] },
}

const CLOUD_MODELS_EMPTY = { token: '', providers: [] }

const NODE_CLOUD_FIELDS = [
  'cloudModelUrl',
  'cloudApiKey',
  'cloudAssistModelPick',
  'cloudModelName',
  'cloudSelfPresetId',
]

function stripNodeCloudFields(obj) {
  if (!obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const item of obj) stripNodeCloudFields(item)
    return
  }
  if (obj.type && obj.data && typeof obj.data === 'object') {
    for (const key of NODE_CLOUD_FIELDS) {
      if (key in obj.data) {
        obj.data[key] = ''
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') stripNodeCloudFields(v)
  }
}

function sanitizeWorkflowFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  if (!raw.includes('nowcoding') && !raw.includes('cloudApiKey') && !raw.includes('flowid-assist')) {
    return false
  }
  const doc = JSON.parse(raw)
  stripNodeCloudFields(doc)
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  return true
}

function main() {
  fs.writeFileSync(
    path.join(root, 'server/cloud-assist-models.json'),
    `${JSON.stringify(CLOUD_ASSIST_EMPTY, null, 2)}\n`,
    'utf8',
  )
  fs.writeFileSync(
    path.join(root, 'server/cloud-models.json'),
    `${JSON.stringify(CLOUD_MODELS_EMPTY, null, 2)}\n`,
    'utf8',
  )

  function sanitizeDir(dirAbs, label) {
    if (!fs.existsSync(dirAbs)) return 0
    let n = 0
    for (const name of fs.readdirSync(dirAbs)) {
      if (!name.endsWith('.workflow.json') && !name.endsWith('.json')) continue
      if (!name.includes('workflow') && dirAbs.includes('templates') === false) {
        if (!name.endsWith('.workflow.json') && !dirAbs.includes('presets/workflows')) continue
      }
      const fp = path.join(dirAbs, name)
      if (!fs.statSync(fp).isFile()) continue
      if (dirAbs.includes('presets/workflows') || name.endsWith('.workflow.json')) {
        if (sanitizeWorkflowFile(fp)) {
          n += 1
          console.log(`[sanitize] ${label}`, name)
        }
      }
    }
    return n
  }

  function walkBundledWorkflows(dirAbs, labelPrefix) {
    let n = 0
    if (!fs.existsSync(dirAbs)) return 0
    for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      const fp = path.join(dirAbs, ent.name)
      if (ent.isDirectory()) n += walkBundledWorkflows(fp, `${labelPrefix}/${ent.name}`)
      else if (ent.isFile() && ent.name.endsWith('.json') && sanitizeWorkflowFile(fp)) {
        n += 1
        console.log(`[sanitize] ${labelPrefix}/${ent.name}`)
      }
    }
    return n
  }

  const templatesDir = path.join(root, 'server/templates')
  let changed = sanitizeDir(templatesDir, 'server/templates')
  changed += walkBundledWorkflows(path.join(root, 'public/flowid-bundled'), 'public/flowid-bundled')

  console.log(`[sanitize] cloud-assist-models.json / cloud-models.json cleared; ${changed} workflow/json file(s) updated.`)
}

main()
