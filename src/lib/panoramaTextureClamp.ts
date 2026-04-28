import * as THREE from 'three'

/**
 * 按 WebGL1/2 常见限制设置贴图采样：非 2 的幂（NPOT）尺寸**不能**可靠使用 mipmap，
 * 若仍用 `LinearMipmapLinearFilter`，在部分显卡/浏览器上贴图不完整 → **整球全黑**。
 */
export function applyWebglSafePanoramaTextureSampling(texture: THREE.Texture): void {
  const img = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined
  let w = 0
  let h = 0
  if (img instanceof ImageBitmap) {
    w = img.width
    h = img.height
  } else if (img && 'naturalWidth' in img && (img.naturalWidth > 0 || img.naturalHeight > 0)) {
    w = img.naturalWidth || img.width
    h = img.naturalHeight || img.height
  } else if (img && 'width' in img) {
    w = img.width ?? 0
    h = img.height ?? 0
  }
  const pot =
    w > 0 && h > 0 && (w & (w - 1)) === 0 && (h & (h - 1)) === 0
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = pot
  texture.minFilter = pot ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
}

/**
 * 将等距柱状全景贴图限制在当前 WebGL 上下文的 `MAX_TEXTURE_SIZE` 以内。
 * 超高分辨率时先缩到安全尺寸再交给 Three.js。
 *
 * @param texture 已解码的纹理（可能被本函数 dispose 并替换）
 * @param renderer 已创建的 WebGLRenderer，用于读取 `capabilities.maxTextureSize`
 * @returns 可直接赋给 `material.map` 的纹理（可能与入参为同一对象）
 */
export function prepareEquirectTextureForGpu(
  texture: THREE.Texture,
  renderer: THREE.WebGLRenderer,
): THREE.Texture {
  const raw = texture.image as HTMLImageElement | ImageBitmap | undefined

  if (raw instanceof ImageBitmap) {
    const iw = raw.width
    const ih = raw.height
    const maxDim = Math.max(512, renderer.capabilities.maxTextureSize || 8192)
    if (iw <= maxDim && ih <= maxDim) {
      applyWebglSafePanoramaTextureSampling(texture)
      return texture
    }
    const scale = maxDim / Math.max(iw, ih)
    const nw = Math.max(1, Math.floor(iw * scale))
    const nh = Math.max(1, Math.floor(ih * scale))
    const canvas = document.createElement('canvas')
    canvas.width = nw
    canvas.height = nh
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      raw.close()
      texture.dispose()
      throw new Error('无法为超大全景图创建缩放画布（2D 上下文不可用）')
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(raw, 0, 0, nw, nh)
    raw.close()
    texture.dispose()
    const next = new THREE.CanvasTexture(canvas)
    /**
     * 上游 `loadPanoramaSourceTexture` 对 blob 解码的 `ImageBitmap` 已按 WebGL 方向做过 `imageOrientation: 'flipY'`，
     * 像素与「直接上传 ImageBitmap」一致；`CanvasTexture` 默认 `flipY=true` 会再翻一次 → 超大图缩放分支上下颠倒。
     */
    next.flipY = false
    applyWebglSafePanoramaTextureSampling(next)
    return next
  }

  const img = texture.image as HTMLImageElement | undefined
  if (!img || !('naturalWidth' in img)) {
    applyWebglSafePanoramaTextureSampling(texture)
    return texture
  }

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const maxDim = Math.max(512, renderer.capabilities.maxTextureSize || 8192)

  if (iw <= maxDim && ih <= maxDim) {
    applyWebglSafePanoramaTextureSampling(texture)
    return texture
  }

  const scale = maxDim / Math.max(iw, ih)
  const nw = Math.max(1, Math.floor(iw * scale))
  const nh = Math.max(1, Math.floor(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = nw
  canvas.height = nh
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) {
    texture.dispose()
    throw new Error('无法为超大全景图创建缩放画布（2D 上下文不可用）')
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img as CanvasImageSource, 0, 0, nw, nh)
  texture.dispose()

  const next = new THREE.CanvasTexture(canvas)
  applyWebglSafePanoramaTextureSampling(next)
  return next
}
