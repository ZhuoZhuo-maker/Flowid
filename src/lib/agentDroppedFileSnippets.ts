/**
 * 助手输入框：将拖入/粘贴的本地文件转为可写入文本框的片段（供发送给模型）。
 */

const MAX_TEXT_FILE_BYTES = 512 * 1024
const MAX_IMAGE_INLINE_BYTES = 350 * 1024

const TEXT_EXT_RE =
  /\.(txt|md|markdown|json|csv|xml|html|htm|log|yaml|yml|ts|tsx|js|jsx|mjs|cjs|css|scss|less|vue|srt|vtt|toml|ini|env|sh|bat|ps1|py|rs|go|java|kt|swift|rb|php|sql)$/i

function isTextLikeFile(f: File): boolean {
  const t = (f.type || '').toLowerCase()
  if (t.startsWith('text/')) return true
  if (
    t === 'application/json' ||
    t === 'application/xml' ||
    t === 'application/javascript' ||
    t === 'application/x-yaml' ||
    t === 'application/sql'
  )
    return true
  return TEXT_EXT_RE.test(f.name)
}

function fenceLangFromFile(f: File): string {
  const n = f.name.toLowerCase()
  const t = (f.type || '').toLowerCase()
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'markdown'
  if (n.endsWith('.json')) return 'json'
  if (n.endsWith('.yaml') || n.endsWith('.yml')) return 'yaml'
  if (n.endsWith('.html') || n.endsWith('.htm') || t.includes('html')) return 'html'
  if (n.endsWith('.xml') || t.includes('xml')) return 'xml'
  if (n.endsWith('.css')) return 'css'
  if (n.endsWith('.sql')) return 'sql'
  if (t.includes('typescript')) return 'typescript'
  if (t.includes('javascript')) return 'javascript'
  return ''
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function readFileAsDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(f)
  })
}

/** 单个文件 → 插入输入框的文本（多模态链路未接时以文本/占位说明为主） */
export async function fileToInputSnippet(f: File): Promise<string> {
  const mime = f.type || 'application/octet-stream'
  if (isTextLikeFile(f)) {
    if (f.size > MAX_TEXT_FILE_BYTES) {
      return `\n[文件: ${f.name} — 超过 ${formatBytes(MAX_TEXT_FILE_BYTES)}，未插入正文]\n`
    }
    try {
      const text = await f.text()
      const lang = fenceLangFromFile(f)
      const fence = lang ? `\`\`\`${lang}\n${text}\n\`\`\`` : `\`\`\`\n${text}\n\`\`\``
      return `\n[文件: ${f.name}]\n${fence}\n`
    } catch {
      return `\n[文件: ${f.name} — 读取失败]\n`
    }
  }
  if (mime.startsWith('image/')) {
    if (f.size > MAX_IMAGE_INLINE_BYTES) {
      return `\n[图片: ${f.name}（${formatBytes(f.size)}）— 超过内嵌上限 ${formatBytes(MAX_IMAGE_INLINE_BYTES)}，未写入 base64；请压缩后重试]\n`
    }
    try {
      const dataUrl = await readFileAsDataURL(f)
      return `\n![${f.name}](${dataUrl})\n`
    } catch {
      return `\n[图片: ${f.name} — 读取失败]\n`
    }
  }
  if (mime.startsWith('audio/') || mime.startsWith('video/')) {
    return `\n[媒体: ${f.name} · ${mime} · ${formatBytes(f.size)}]\n（当前助手链路以文本为主；若需分析内容请用文字描述要点，或提供可访问的 URL。）\n`
  }
  return `\n[文件: ${f.name} · ${mime} · ${formatBytes(f.size)}]\n（未识别的二进制类型：可改为 .txt/.md/.json 等文本后缀再拖入以插入正文。）\n`
}

export async function filesToInputSnippetsConcat(files: Iterable<File>): Promise<string> {
  const parts: string[] = []
  for (const f of files) {
    if (!f || f.size === 0) continue
    parts.push(await fileToInputSnippet(f))
  }
  return parts.join('')
}
