/**
 * 将 F 盘「后端工作流api本地备份」下的 *.api.json 按云端工作流与截图清单重命名：
 * 「序号 + 截图中的显示名」.api.json（共 19 条；括号全角/空格用 normLoose 对齐）。
 *
 * 用法: node tools/rename-cloud-workflow-backup.mjs
 */
import fs from 'fs'
import path from 'path'

const dir = 'F:/flowid-zy/云端comfyui工作流管理/后端工作流api本地备份'
const manifestPath = path.join(dir, '_manifest.json')

function norm(s) {
  return String(s || '')
    .replace(/\uFF08/g, '(')
    .replace(/\uFF09/g, ')')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** 与截图/云端括号、空格差异容错 */
function normLoose(s) {
  return norm(s).replace(/\s+/g, '')
}

/** 与当前管理列表顺序一致的 19 条（来自截图） */
const FIGURE_19 = [
  '(文_语音转语音)-单_多人语音 (无参)',
  '(文转语音)-多人语音 (无参)',
  '(文_语音转语音)-单_多语音自定义(有参)',
  '(图生视频_音)-首尾视频',
  '(图生视频)-数字人',
  '(图生图)-无限扩图',
  '(图生图)-角度控制',
  '(图生图)-单图去杂',
  '(图生图)-多图编辑',
  '(图生图)-单图编辑',
  '(文生图)-电商',
  '(视频生视频)-视频合并',
  '(图生视频)-LTX2.3',
  '(语音转音乐)-音乐创作',
  '(图生图)-语义抠图 (英文)',
  '(图生图)-图像修复',
  '(文生文)-对话模型',
  '(文生文)-模特提示词',
  '(文生图)-全类型生图',
]

function safeWinFileBase(s) {
  return String(s)
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const workflows = manifest.workflows || []

const idToNewBase = new Map()
for (const w of workflows) {
  const id = w.id
  const n = normLoose(w.name)
  let idx = -1
  for (let i = 0; i < FIGURE_19.length; i++) {
    if (normLoose(FIGURE_19[i]) === n) {
      idx = i
      break
    }
  }
  if (idx >= 0) {
    idToNewBase.set(id, `${idx + 1} ${FIGURE_19[idx]}`)
  } else {
    console.warn('未匹配截图清单，退回 id 后缀:', w.name, id)
    idToNewBase.set(id, `${safeWinFileBase(w.name)}__${id.slice(0, 8)}`)
  }
}

const idToFinal = new Map()
const seenBases = new Set()
for (const w of workflows) {
  const base = idToNewBase.get(w.id)
  let finalName = safeWinFileBase(base) + '.api.json'
  let n = 0
  while (seenBases.has(finalName)) {
    n++
    finalName = safeWinFileBase(base) + '_' + n + '.api.json'
  }
  seenBases.add(finalName)
  idToFinal.set(w.id, finalName)
}

const steps = []
for (const w of workflows) {
  const oldFile = path.join(dir, w.file)
  if (!fs.existsSync(oldFile)) {
    console.warn('missing', w.file)
    continue
  }
  const finalName = idToFinal.get(w.id)
  const finalPath = path.join(dir, finalName)
  const tmp = path.join(dir, `.tmp-rename-${w.id}.api.json`)
  steps.push({ oldFile, tmp, finalPath, finalName, id: w.id })
}

for (const s of steps) {
  fs.renameSync(s.oldFile, s.tmp)
}
for (const s of steps) {
  if (fs.existsSync(s.finalPath)) fs.unlinkSync(s.finalPath)
  fs.renameSync(s.tmp, s.finalPath)
}

for (const w of workflows) {
  w.file = idToFinal.get(w.id)
}
manifest.renamedAt = new Date().toISOString()
manifest.renameNote = '19 条均按截图序号 + 显示名命名（括号/空格 normLoose 对齐云端 name）'
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

console.log('OK', steps.length, 'files in', dir)
for (const w of workflows) console.log(' ', w.file)
