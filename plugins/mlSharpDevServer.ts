/**
 * 开发态 / vite preview：将当前全景图交给本机 Apple ml-sharp（`sharp predict`）生成 3DGS .ply 并回传下载。
 *
 * 路径优先级（与 Comfy 的 input/output 不是同一配置）：
 * 1. 请求 JSON 中的 `mlSharpRoot` / `mlSharpCli`（由前端从「工作流设置 → 本地路径」读取并附带）；
 * 2. 否则回退环境变量 `ML_SHARP_ROOT` / `ML_SHARP_CLI`（可选，CLI 默认 `sharp`）。
 *
 * 纯静态部署（无 Node 中间层）时该路径不可用，节点内会提示使用 `pnpm dev` 或自建后端。
 */
import type { ServerResponse } from 'node:http'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function findFirstPly(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        const hit = await findFirstPly(full)
        if (hit) return hit
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.ply')) {
        return full
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function readRequestBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function attachMlSharpMiddleware(middlewares: Connect.Server) {
  middlewares.use(async (req, res, next) => {
    const url = req.url || ''
    if (!url.startsWith('/api/ml-sharp/predict') || req.method !== 'POST') {
      next()
      return
    }

    let raw: Buffer
    try {
      raw = await readRequestBody(req)
    } catch {
      res.statusCode = 400
      res.end('bad body')
      return
    }

    let body: { imageBase64?: string; mlSharpRoot?: string; mlSharpCli?: string }
    try {
      body = JSON.parse(raw.toString('utf8')) as typeof body
    } catch {
      sendJson(res, 400, { error: 'JSON 解析失败' })
      return
    }

    const root =
      String(body.mlSharpRoot || '').trim() || String(process.env.ML_SHARP_ROOT || '').trim()
    if (!root) {
      sendJson(res, 503, {
        error:
          '未配置 ml-sharp 根目录：请在「工作流设置 → 本地路径」填写「ml-sharp 根目录」并保存，或设置环境变量 ML_SHARP_ROOT。',
      })
      return
    }

    try {
      const st = await fs.stat(root)
      if (!st.isDirectory()) {
        sendJson(res, 400, { error: `ml-sharp 根路径不是文件夹：${root}` })
        return
      }
    } catch {
      sendJson(res, 400, { error: `无法访问 ml-sharp 根目录：${root}` })
      return
    }

    const cli =
      String(body.mlSharpCli || '').trim() ||
      String(process.env.ML_SHARP_CLI || '').trim() ||
      'sharp'

    const b64 = body.imageBase64
    if (!b64 || typeof b64 !== 'string') {
      sendJson(res, 400, { error: '缺少 imageBase64' })
      return
    }

    const m = /^data:image\/(\w+);base64,(.+)$/s.exec(b64)
    if (!m) {
      sendJson(res, 400, { error: 'imageBase64 须为 data:image/...;base64,...' })
      return
    }

    let buf: Buffer
    try {
      buf = Buffer.from(m[2], 'base64')
    } catch {
      sendJson(res, 400, { error: 'Base64 无效' })
      return
    }

    if (buf.byteLength < 32 || buf.byteLength > 80 * 1024 * 1024) {
      sendJson(res, 413, { error: '图片过大或无效' })
      return
    }

    const tmp = path.join(os.tmpdir(), `flowid-ml-sharp-${randomUUID()}`)
    const inDir = path.join(tmp, 'in')
    const outDir = path.join(tmp, 'out')
    await fs.mkdir(inDir, { recursive: true })
    await fs.mkdir(outDir, { recursive: true })

    const extRaw = (m[1] || 'png').toLowerCase()
    const fname =
      extRaw === 'jpeg' || extRaw === 'jpg'
        ? 'input.jpg'
        : extRaw === 'webp'
          ? 'input.webp'
          : 'input.png'
    await fs.writeFile(path.join(inDir, fname), buf)

    const stderrChunks: string[] = []
    const code = await new Promise<number>((resolve) => {
      const child = spawn(cli, ['predict', '-i', inDir, '-o', outDir], {
        cwd: root,
        shell: process.platform === 'win32',
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (d: string) => {
        stderrChunks.push(d)
      })
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', () => {})
      child.on('error', () => resolve(-1))
      child.on('close', (c) => resolve(typeof c === 'number' ? c : -1))
    })

    const plyPath = await findFirstPly(outDir)
    let plyBuf: Buffer | null = null
    if (plyPath) {
      try {
        plyBuf = await fs.readFile(plyPath)
      } catch {
        plyBuf = null
      }
    }

    try {
      await fs.rm(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }

    if (code !== 0 || !plyBuf) {
      sendJson(res, 500, {
        error: `SHARP 未成功生成 .ply（退出码 ${code}）。请确认已在所选根目录安装 ml-sharp，且命令「${cli} predict」可用。`,
        stderr: stderrChunks.join('').slice(-12_000),
      })
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', 'attachment; filename="flowid-sharp.ply"')
    res.end(plyBuf)
  })
}

export function mlSharpDevServer(): Plugin {
  return {
    name: 'flowid-ml-sharp-dev-api',
    configureServer(server: ViteDevServer) {
      attachMlSharpMiddleware(server.middlewares)
    },
    configurePreviewServer(server: PreviewServer) {
      attachMlSharpMiddleware(server.middlewares)
    },
  }
}
