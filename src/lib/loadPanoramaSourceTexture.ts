import * as THREE from 'three'

/**
 * 加载全景图源为 Three 纹理。
 * - `blob:` / `data:`：走 `fetch` + `createImageBitmap`，避免部分环境下 `TextureLoader` + `<img>` 解码异常导致黑屏；
 * - `http(s)`：仍用 `TextureLoader`，并对跨域资源设置 `crossOrigin`。
 */
export async function loadPanoramaSourceTexture(url: string): Promise<THREE.Texture> {
  const trimmed = url.trim()
  if (/^(blob:|data:)/i.test(trimmed)) {
    const res = await fetch(trimmed)
    if (!res.ok) {
      throw new Error(`读取图片失败（HTTP ${res.status}）`)
    }
    const blob = await res.blob()
    /**
     * 与 `TextureLoader` + `<img>` 默认 `flipY` 行为对齐：Three 上传 `ImageBitmap` 时不走
     * `UNPACK_FLIP_Y_WEBGL`，若不在这里翻转，等距柱状贴图在球面上会上下颠倒（本地上传常见）。
     * 不支持 `imageOrientation` 时回退为 `TextureLoader` + 临时 `blob:` URL（与 HTTP 路径一致）。
     */
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' })
      const tex = new THREE.Texture(bmp)
      tex.needsUpdate = true
      return tex
    } catch {
      const objUrl = URL.createObjectURL(blob)
      return await new Promise<THREE.Texture>((resolve, reject) => {
        const loader = new THREE.TextureLoader()
        loader.load(
          objUrl,
          (tex) => {
            URL.revokeObjectURL(objUrl)
            resolve(tex)
          },
          undefined,
          (err) => {
            URL.revokeObjectURL(objUrl)
            reject(err instanceof Error ? err : new Error(String(err)))
          },
        )
      })
    }
  }

  return await new Promise<THREE.Texture>((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    if (/^https?:\/\//i.test(trimmed)) {
      loader.setCrossOrigin('anonymous')
    }
    loader.load(trimmed, resolve, undefined, reject)
  })
}
