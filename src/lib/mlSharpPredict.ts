/**
 * 调用 Vite 开发/预览服务器上的 `/api/ml-sharp/predict`（见 `plugins/mlSharpDevServer.ts`），
 * 将全景/图片交给本机 Apple ml-sharp 生成 3DGS .ply。
 *
 * `mlSharpRoot` / `mlSharpCli` 来自「工作流设置 → 本地路径」（localStorage），与 Comfy 的 input/output 路径无关。
 */

import { loadLocalDiskPathsSettings } from './localDiskPathsSettings'

export const ML_SHARP_PREDICT_PATH = '/api/ml-sharp/predict'

export async function imageUrlToDataUrl(src: string): Promise<string> {
  const r = await fetch(src)
  if (!r.ok) throw new Error(`无法读取图片（HTTP ${r.status}）`)
  const blob = await r.blob()
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('读取图片失败'))
    fr.readAsDataURL(blob)
  })
}

export async function runMlSharpPredict(imageDataUrl: string): Promise<Blob> {
  const paths = loadLocalDiskPathsSettings()
  const res = await fetch(ML_SHARP_PREDICT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: imageDataUrl,
      mlSharpRoot: String(paths.mlSharpRootPath || '').trim(),
      mlSharpCli: String(paths.mlSharpCliPath || '').trim(),
    }),
  })
  const ct = res.headers.get('Content-Type') || ''
  if (!res.ok) {
    const t = await res.text()
    let msg = `HTTP ${res.status}`
    try {
      const j = JSON.parse(t) as { error?: string; stderr?: string }
      if (j.error) msg = j.error
      if (j.stderr) msg = `${msg}\n${j.stderr}`
    } catch {
      if (t) msg = t
    }
    throw new Error(msg)
  }
  if (ct.includes('application/json')) {
    const j = (await res.json()) as { error?: string }
    throw new Error(j.error || '未知错误')
  }
  return res.blob()
}

export function downloadBlobAsFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
