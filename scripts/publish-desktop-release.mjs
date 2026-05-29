/**
 * 发布 Windows 桌面安装包到 Gitee / GitHub Releases。
 * 用法：
 *   node scripts/publish-desktop-release.mjs
 * 环境变量（可选）：
 *   GITEE_ACCESS_TOKEN — 未设置时尝试从 git credential 读取 Gitee 口令
 *   GITHUB_TOKEN / GH_TOKEN — GitHub 私人令牌（上传 Release 资产必需）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = 'v0.0.1'
const TAG = VERSION
const RELEASE_TITLE = 'Flowid v0.0.1 — Windows 桌面版'

const RELEASE_BODY = `## Flowid v0.0.1（Windows 桌面安装包）

无限画布 AI 内容工作流工具的首个 Windows 安装包。

### 下载

请下载附件 **Flowid（内测版）_v0.0.1.exe**（约 287 MB）。

### 系统要求

- **Windows 10 / 11（64 位）**

### 首次使用

1. 运行安装程序并完成安装
2. 打开 Flowid → **设置** → 配置 **ComfyUI 地址**（本机或云端）
3. 导入 / 选择工作流后即可在画布中运行

### 安装说明

- 本安装包已内置**预设模板、云端工作流目录、灵感小镇**（本地画廊），**无需**安装 Node.js 或启动 3721 后端
- 实际 **AI 生成**仍须本机或云端 **ComfyUI**，或在设置中配置 **API Key**
- Windows **SmartScreen** 可能提示「未知发布者」→ 请选择 **仍要运行**

### 开源仓库

- GitHub: https://github.com/ZhuoZhuo-maker/Flowid
- Gitee: https://gitee.com/zhuozhuo1786449/flowid
`

/**
 * @param {string} dir
 * @returns {string}
 */
function findInstallerExe(dir) {
  if (!fs.existsSync(dir)) throw new Error(`未找到目录: ${dir}`)
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) {
      try {
        return findInstallerExe(full)
      } catch {
        // continue siblings
      }
    } else if (name.endsWith('.exe') && !name.includes('uninstall')) {
      return full
    }
  }
  throw new Error(`在 ${dir} 下未找到 .exe 安装包`)
}

/**
 * @returns {string}
 */
function readGiteeTokenFromGitCredential() {
  // Gitee API 仅接受「私人令牌」，Git 凭据里的登录密码不能用于 Release API
  return ''
}

/**
 * @param {string} url
 * @param {RequestInit} init
 */
async function fetchJson(url, init = {}) {
  const res = await fetch(url, init)
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

/**
 * @param {string} token
 */
async function publishGiteeRelease(token, exePath, exeName) {
  const owner = 'zhuozhuo1786449'
  const repo = 'flowid'
  const base = `https://gitee.com/api/v5/repos/${owner}/${repo}`

  let releaseId = null
  const byTag = await fetchJson(
    `${base}/releases/tags/${encodeURIComponent(TAG)}?access_token=${encodeURIComponent(token)}`,
  ).catch(() => null)
  if (byTag?.id) releaseId = Number(byTag.id)

  if (!releaseId) {
    const list = await fetchJson(
      `${base}/releases?access_token=${encodeURIComponent(token)}&page=1&per_page=20`,
    ).catch(() => [])
    const hit = Array.isArray(list) ? list.find((r) => r.tag_name === TAG) : null
    releaseId = hit?.id ? Number(hit.id) : null
  }

  if (!releaseId) {
    const created = await fetchJson(`${base}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        tag_name: TAG,
        name: RELEASE_TITLE,
        body: RELEASE_BODY,
        target_commitish: 'main',
        prerelease: false,
      }),
    })
    releaseId = created.id
    console.log('[gitee] 已创建 Release:', releaseId)
  } else {
    console.log('[gitee] Release 已存在:', releaseId)
  }

  const form = new FormData()
  form.append('access_token', token)
  form.append('file', new Blob([fs.readFileSync(exePath)]), exeName)

  const uploadUrl = `${base}/releases/${releaseId}/attach_files`
  const res = await fetch(uploadUrl, { method: 'POST', body: form })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`[gitee] 上传失败 ${res.status}: ${text}`)
  }
  console.log('[gitee] 已上传安装包:', exeName)
  console.log(`[gitee] 发布页: https://gitee.com/${owner}/${repo}/releases/tag/${TAG}`)
}

/**
 * @param {string} token
 */
async function publishGithubRelease(token, exePath, exeName) {
  const owner = 'ZhuoZhuo-maker'
  const repo = 'Flowid'
  const base = `https://api.github.com/repos/${owner}/${repo}`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  let release = await fetchJson(`${base}/releases/tags/${TAG}`, { headers }).catch(() => null)

  if (!release?.id) {
    release = await fetchJson(`${base}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: TAG,
        name: RELEASE_TITLE,
        body: RELEASE_BODY,
        draft: false,
        prerelease: false,
      }),
    })
    console.log('[github] 已创建 Release:', release.id)
  } else {
    console.log('[github] Release 已存在:', release.id)
  }

  const uploadUrl = String(release.upload_url).replace(/\{.*\}$/, `?name=${encodeURIComponent(exeName)}`)
  const buf = fs.readFileSync(exePath)
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
    },
    body: buf,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`[github] 上传失败 ${res.status}: ${text}`)
  }
  console.log('[github] 已上传安装包:', exeName)
  console.log(`[github] 发布页: https://github.com/${owner}/${repo}/releases/tag/${TAG}`)
}

async function main() {
  const deliverablesRoot = path.join(root, 'deliverables')
  const exePath = findInstallerExe(deliverablesRoot)
  const exeName = path.basename(exePath)
  const sizeMb = (fs.statSync(exePath).size / (1024 * 1024)).toFixed(1)
  console.log('安装包:', exePath)
  console.log('大小:', `${sizeMb} MB`)
  console.log()

  const giteeToken = String(process.env.GITEE_ACCESS_TOKEN || readGiteeTokenFromGitCredential()).trim()
  if (!giteeToken) {
    console.error('[ERR] 未找到 Gitee access_token，请设置 GITEE_ACCESS_TOKEN')
    process.exit(1)
  }

  await publishGiteeRelease(giteeToken, exePath, exeName)

  const githubToken = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  if (githubToken) {
    await publishGithubRelease(githubToken, exePath, exeName)
  } else {
    console.log()
    console.log('[skip] 未设置 GITHUB_TOKEN / GH_TOKEN，跳过 GitHub Release 上传')
    console.log('       可在 GitHub → Settings → Developer settings → Personal access tokens 创建后重跑本脚本')
  }
}

main().catch((err) => {
  console.error('[ERR]', err instanceof Error ? err.message : err)
  process.exit(1)
})
