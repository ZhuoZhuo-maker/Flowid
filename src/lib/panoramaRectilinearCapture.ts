import * as THREE from 'three'

/**
 * 将当前透视相机所见渲染到离屏 `WebGLRenderTarget`，再转为 PNG 的 Object URL。
 * WebGL 像素原点在左下，此处已做 Y 翻转以匹配常见位图自上而下顺序。
 *
 * @param renderer 主画布使用的 WebGLRenderer（与场景一致）
 * @param scene 全景球所在场景
 * @param camera 透视相机（仅临时调整 aspect，结束后恢复）
 * @param width 导出宽度（像素），限制在 64–4096
 * @param height 导出高度（像素），限制在 64–4096
 */
export async function capturePerspectiveToObjectUrl(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): Promise<string> {
  const w = Math.max(64, Math.min(4096, Math.round(width)))
  const h = Math.max(64, Math.min(4096, Math.round(height)))
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false })
  const prevTarget = renderer.getRenderTarget()
  const prevAspect = camera.aspect
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setRenderTarget(rt)
  renderer.render(scene, camera)
  const buf = new Uint8Array(w * h * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf)
  renderer.setRenderTarget(prevTarget)
  camera.aspect = prevAspect
  camera.updateProjectionMatrix()
  rt.dispose()

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建 2D 画布上下文')
  }
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = (y * w + x) * 4
      const di = ((h - 1 - y) * w + x) * 4
      img.data[di] = buf[si]!
      img.data[di + 1] = buf[si + 1]!
      img.data[di + 2] = buf[si + 2]!
      img.data[di + 3] = buf[si + 3]!
    }
  }
  ctx.putImageData(img, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('导出 PNG 失败'))
          return
        }
        resolve(URL.createObjectURL(blob))
      },
      'image/png',
      1,
    )
  })
}
