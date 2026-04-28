import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useCanvasActions } from '../../context/CanvasContext'
import type { PanoramaNodeData } from '../../types'
import { NodeChrome } from './NodeChrome'
import { capturePerspectiveToObjectUrl } from '../../lib/panoramaRectilinearCapture'
import { loadPanoramaSourceTexture } from '../../lib/loadPanoramaSourceTexture'
import {
  getLocalImageAssetObjectUrl,
  saveLocalImageAsset,
} from '../../lib/localImageAssetStore'
import { prepareEquirectTextureForGpu } from '../../lib/panoramaTextureClamp'

type PanoramaCore = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  sphere: THREE.Mesh
  texture: THREE.Texture | null
  raf: number
  resizeObserver: ResizeObserver
}

/** 导出图节点与全景节点在流坐标中的横向间距（与需求一致：20） */
const PANORAMA_EXPORT_GAP_FLOW = 20

/** 内联预览：轨道推拉最大距离（与首次创建 OrbitControls 时保持一致） */
const ORBIT_INLINE_MAX_DISTANCE = 8
/** 内联预览：滚轮缩放速度系数 */
const ORBIT_INLINE_ZOOM_SPEED = 1
/**
 * 沉浸全屏：略增大最大距离与滚轮速度，便于在大画面上用滚轮明显拉近/拉远。
 */
const ORBIT_IMMERSE_MAX_DISTANCE = 28
/**
 * 沉浸全屏略调高：触控板「平滑滚动」多为连续小 deltaY，与画布 d3 缩放手感不同，此处略增灵敏度便于推拉。
 * 双指捏合缩放会带 ctrlKey，Three OrbitControls 内已对 delta 额外放大，仍兼容。
 */
const ORBIT_IMMERSE_ZOOM_SPEED = 1.55

/** 读取已解码贴图的像素尺寸（Image / ImageBitmap / Canvas 底图） */
function getTextureImageSize(tex: THREE.Texture): { w: number; h: number } {
  const im = tex.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined
  if (!im) return { w: 0, h: 0 }
  if (im instanceof ImageBitmap) {
    return { w: im.width, h: im.height }
  }
  if ('naturalWidth' in im && (im.naturalWidth > 0 || im.naturalHeight > 0)) {
    return {
      w: im.naturalWidth || im.width,
      h: im.naturalHeight || im.height,
    }
  }
  return { w: im.width ?? 0, h: im.height ?? 0 }
}

/** 释放纹理；若为 `createImageBitmap` 来源需 `close()`，避免泄漏与偶发解码异常 */
function disposeTextureWithBitmap(tex: THREE.Texture | null | undefined) {
  if (!tex) return
  const im = tex.image
  tex.dispose()
  if (im instanceof ImageBitmap) {
    try {
      im.close()
    } catch {
      /* 已关闭或非 ImageBitmap 时忽略 */
    }
  }
}

/**
 * 宽高比是否接近 VR 常用等距柱状全景（约 2:1）。
 * @param tolerance 允许的相对偏差（默认约 ±17.5%）
 */
function isNearEquirectangularAspect(w: number, h: number, tolerance = 0.35): boolean {
  if (w <= 0 || h <= 0) return true
  const r = w / h
  return Math.abs(r - 2) <= tolerance
}

/**
 * VR360 全景节点：为 **VR 球面环视** 使用等距柱状（Equirectangular）全景图；沉浸全屏环视并支持导出当前视角到画布。
 */
export function PanoramaNode({
  id,
  data,
  selected,
}: NodeProps<Node<PanoramaNodeData, 'panorama'>>) {
  const { updateNodeData, addPanoramaViewToCanvas } = useCanvasActions()
  /** 预览区外框：量尺寸、叠放占位/报错（React 管理），勿在此上直接 append 非 React 节点 */
  const inlineMountRef = useRef<HTMLDivElement>(null)
  /** 仅挂载 WebGL canvas，避免与 React 子节点混用导致 removeChild 冲突 */
  const webglHostRef = useRef<HTMLDivElement>(null)
  const immersiveRootRef = useRef<HTMLDivElement>(null)
  const immersiveStageRef = useRef<HTMLDivElement>(null)
  const coreRef = useRef<PanoramaCore | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** 贴图比例与常用 VR 等距柱状（约 2:1）不符时的说明（不阻断预览） */
  const [vrFormatHint, setVrFormatHint] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [immersiveOpen, setImmersiveOpen] = useState(false)
  const [coreLayoutEpoch, bumpCoreLayout] = useReducer((n: number) => n + 1, 0)

  const exportW = data.exportWidth ?? 1024
  const exportH = data.exportHeight ?? 1024
  const srcTrim = String(data.src || '').trim()

  const disposeCore = useCallback(() => {
    const core = coreRef.current
    if (!core) return
    cancelAnimationFrame(core.raf)
    core.resizeObserver.disconnect()
    core.controls.dispose()
    core.sphere.geometry.dispose()
    const mat = core.sphere.material as THREE.MeshBasicMaterial
    mat.map = null
    mat.needsUpdate = true
    disposeTextureWithBitmap(core.texture)
    mat.dispose()
    core.renderer.dispose()
    coreRef.current = null
  }, [])

  /**
   * 切换全景源时退出沉浸，避免 WebGL 画布仍挂在已卸载的 Portal 容器上。
   */
  useEffect(() => {
    setImmersiveOpen(false)
  }, [data.src])

  /** 挂载 Three.js：内看球面 + 轨道控制（单实例，沉浸时迁移 canvas DOM） */
  useEffect(() => {
    const viewport = inlineMountRef.current
    const host = webglHostRef.current
    if (!srcTrim || !viewport || !host) {
      disposeCore()
      return
    }

    disposeCore()
    setLoadError(null)
    setVrFormatHint(null)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000)
    camera.position.set(0, 0, 0.01)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setClearColor(0x0a0e14, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.classList.add('studio-panorama__canvas')
    host.appendChild(renderer.domElement)

    const geometry = new THREE.SphereGeometry(500, 64, 48)
    geometry.scale(-1, 1, 1)
    /** DoubleSide：避免部分驱动下内看球面被整片剔除呈黑屏；toneMapped 关闭减少色彩管线误判 */
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
    })
    const sphere = new THREE.Mesh(geometry, material)
    scene.add(sphere)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableZoom = true
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = -0.35
    controls.minDistance = 0.05
    controls.maxDistance = ORBIT_INLINE_MAX_DISTANCE
    controls.zoomSpeed = ORBIT_INLINE_ZOOM_SPEED
    controls.target.set(0, 0, -1)
    controls.update()

    const abortMount = () => {
      controls.dispose()
      geometry.dispose()
      material.dispose()
      const canvas = renderer.domElement
      const p = canvas.parentNode
      if (p) {
        p.removeChild(canvas)
      }
      renderer.dispose()
    }

    let cancelled = false

    void (async () => {
      let uploaded: THREE.Texture | null = null
      try {
        uploaded = await loadPanoramaSourceTexture(srcTrim)
      } catch {
        if (!cancelled) {
          setVrFormatHint(null)
          setLoadError('全景图加载失败（可检查链接是否跨域、文件是否损坏或格式是否受支持）')
        }
        abortMount()
        return
      }

      if (cancelled) {
        disposeTextureWithBitmap(uploaded)
        abortMount()
        return
      }

      let finalTex: THREE.Texture
      try {
        finalTex = prepareEquirectTextureForGpu(uploaded, renderer)
      } catch (e) {
        disposeTextureWithBitmap(uploaded)
        if (!cancelled) {
          setLoadError((e as Error).message || '全景图预处理失败')
        }
        abortMount()
        return
      }

      if (cancelled) {
        disposeTextureWithBitmap(finalTex)
        abortMount()
        return
      }

      const { w: tw, h: th } = getTextureImageSize(finalTex)
      if (!isNearEquirectangularAspect(tw, th)) {
        setVrFormatHint(
          '当前图比例与 VR 用「等距柱状全景」（约 2:1）相差较大，球面环视会拉伸或变形；请尽量使用 VR/全景相机或拼接软件导出的标准全景。',
        )
      } else {
        setVrFormatHint(null)
      }
      material.map = finalTex
      material.needsUpdate = true
      const fit = () => {
        if (renderer.domElement.parentElement !== host) return
        /** 以外框 viewport 为准量尺寸，避免 0 尺寸 framebuffer */
        const w = Math.max(2, viewport.clientWidth || 320)
        const h = Math.max(2, viewport.clientHeight || 220)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(w, h, false)
      }
      fit()
      const resizeObserver = new ResizeObserver(fit)
      resizeObserver.observe(viewport)

      const loop = () => {
        if (cancelled || !coreRef.current) return
        controls.update()
        renderer.render(scene, camera)
        coreRef.current.raf = requestAnimationFrame(loop)
      }

      coreRef.current = {
        renderer,
        scene,
        camera,
        controls,
        sphere,
        texture: finalTex,
        raf: requestAnimationFrame(loop),
        resizeObserver,
      }
      bumpCoreLayout()
    })()

    return () => {
      cancelled = true
      disposeCore()
      /** 禁止对 React 管理的节点做 removeChild 清空：会破坏协调并触发 NotFoundError */
    }
  }, [srcTrim, disposeCore])

  /**
   * 在内联预览与沉浸舞台之间迁移同一 WebGL 画布，并切换 ResizeObserver 与尺寸。
   */
  useLayoutEffect(() => {
    const core = coreRef.current
    if (!core) return

    const canvas = core.renderer.domElement

    if (!immersiveOpen) {
      const hst = webglHostRef.current
      if (hst && canvas.parentNode !== hst) {
        hst.appendChild(canvas)
      }
      core.resizeObserver.disconnect()
      if (inlineMountRef.current) {
        core.resizeObserver.observe(inlineMountRef.current)
      }
      const inlineFit = () => {
        const vp = inlineMountRef.current
        const hst2 = webglHostRef.current
        const c = coreRef.current
        if (!vp || !hst2 || !c) return
        if (c.renderer.domElement.parentElement !== hst2) return
        const w = Math.max(2, vp.clientWidth || 320)
        const h = Math.max(2, vp.clientHeight || 220)
        c.camera.aspect = w / h
        c.camera.updateProjectionMatrix()
        c.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        c.renderer.setSize(w, h, false)
      }
      inlineFit()
      return
    }

    core.resizeObserver.disconnect()
    const stage = immersiveStageRef.current
    if (stage && canvas.parentNode !== stage) {
      stage.appendChild(canvas)
    }
    const stageFit = () => {
      const st = immersiveStageRef.current
      const c = coreRef.current
      if (!st || !c) return
      const w = Math.max(2, st.clientWidth || window.innerWidth)
      const h = Math.max(2, st.clientHeight || window.innerHeight)
      c.camera.aspect = w / h
      c.camera.updateProjectionMatrix()
      c.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      c.renderer.setSize(w, h, false)
    }
    stageFit()
    window.addEventListener('resize', stageFit)
    return () => {
      window.removeEventListener('resize', stageFit)
    }
  }, [immersiveOpen, coreLayoutEpoch])

  /**
   * 沉浸全屏时提高滚轮 dollying 的行程与灵敏度；回到内联预览时恢复，避免两种视图手感不一致。
   */
  useLayoutEffect(() => {
    const core = coreRef.current
    if (!core) return
    const { controls } = core
    if (immersiveOpen) {
      controls.maxDistance = ORBIT_IMMERSE_MAX_DISTANCE
      controls.zoomSpeed = ORBIT_IMMERSE_ZOOM_SPEED
    } else {
      controls.maxDistance = ORBIT_INLINE_MAX_DISTANCE
      controls.zoomSpeed = ORBIT_INLINE_ZOOM_SPEED
    }
  }, [immersiveOpen, coreLayoutEpoch])

  /**
   * 沉浸层打开时禁止页面滚动；关闭时恢复。
   */
  useEffect(() => {
    if (!immersiveOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [immersiveOpen])

  /**
   * 沉浸根节点挂载后尝试进入浏览器全屏（失败时仍保留 fixed 全视口层）。
   */
  useEffect(() => {
    if (!immersiveOpen) return
    const el = immersiveRootRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      void el.requestFullscreen?.().catch(() => {})
    })
    return () => {
      cancelAnimationFrame(raf)
      if (document.fullscreenElement === el) {
        void document.exitFullscreen().catch(() => {})
      }
    }
  }, [immersiveOpen])

  /**
   * 关闭沉浸层并尽量退出浏览器全屏。
   */
  const closeImmersive = useCallback(() => {
    setImmersiveOpen(false)
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    }
  }, [])

  /**
   * Esc 退出沉浸（不依赖全屏 API 是否成功）。
   */
  useEffect(() => {
    if (!immersiveOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeImmersive()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [immersiveOpen, closeImmersive])

  /**
   * 打开沉浸预览（需已配置全景源）。
   */
  const openImmersive = useCallback(() => {
    if (!srcTrim) {
      window.alert('请先上传全景图')
      return
    }
    setImmersiveOpen(true)
  }, [srcTrim])

  /**
   * 沉浸态：截取当前 WebGL 画面并写入画布图片节点（与全景节点间距 {@link PANORAMA_EXPORT_GAP_FLOW}）。
   */
  const handleExportImmersive = useCallback(async () => {
    const core = coreRef.current
    if (!core) {
      window.alert('请先等待全景预览加载完成')
      return
    }
    setExporting(true)
    try {
      const url = await capturePerspectiveToObjectUrl(
        core.renderer,
        core.scene,
        core.camera,
        exportW,
        exportH,
      )
      await addPanoramaViewToCanvas(id, url, PANORAMA_EXPORT_GAP_FLOW)
    } catch (e) {
      window.alert((e as Error).message || '导出失败')
    } finally {
      setExporting(false)
    }
  }, [addPanoramaViewToCanvas, exportH, exportW, id])

  const onPickFile = useCallback(
    async (list: FileList | null) => {
      const file = list?.[0]
      if (!file || !file.type.startsWith('image/')) return
      const prev = String(data.src || '').trim()
      if (prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev)
      }
      try {
        const srcAssetId = await saveLocalImageAsset(file)
        const restored = await getLocalImageAssetObjectUrl(srcAssetId)
        updateNodeData(id, {
          kind: 'panorama',
          src: restored || URL.createObjectURL(file),
          srcAssetId,
          srcFileName: file.name,
        })
      } catch {
        const url = URL.createObjectURL(file)
        updateNodeData(id, { kind: 'panorama', src: url, srcFileName: file.name })
      }
    },
    [data.src, id, updateNodeData],
  )

  return (
    <>
      <Handle type="target" position={Position.Left} className="studio-handle" />
      <NodeChrome
        icon={<span className="glyph">360</span>}
        title={data.title}
        accent="#22d3ee"
        selected={selected}
        showStatusBadge={false}
        editableTitle
        onTitleChange={(nextTitle) =>
          updateNodeData(id, { kind: 'panorama', title: nextTitle })
        }
      >
        <div className="studio-panorama">
          <div
            className="studio-panorama__viewportWrap nowheel nodrag"
            ref={inlineMountRef}
          >
            <div className="studio-panorama__webglHost" ref={webglHostRef} aria-hidden />
            {!srcTrim ? (
              <div className="studio-panorama__placeholder">
                请上传 VR 用等距柱状全景图
                <span className="studio-panorama__placeholderSub">（推荐宽高比约 2:1）</span>
              </div>
            ) : null}
            {loadError ? <div className="studio-panorama__error">{loadError}</div> : null}
          </div>

          {vrFormatHint && !loadError ? (
            <div className="studio-panorama__vrWarn">{vrFormatHint}</div>
          ) : null}

          <div className="studio-panorama__toolbar studio-panorama__toolbar--dual">
            <button
              type="button"
              className="studio-panorama__btn studio-panorama__btn--primary"
              disabled={!srcTrim || Boolean(loadError)}
              onClick={openImmersive}
            >
              360°沉浸预览
            </button>
            <button
              type="button"
              className="studio-panorama__btn studio-panorama__btn--accent"
              title="请选用 VR/全景工作流导出的等距柱状图（Equirectangular），宽高比约 2:1"
              onClick={() => fileInputRef.current?.click()}
            >
              上传全景图
            </button>
          </div>

          <p className="studio-panorama__hint">
            {`本节点用于 VR 球面环视，请使用等距柱状全景图（常用宽高比约 2:1）。先点「360°沉浸预览」进入全屏环视；在预览区或全屏画面内可用鼠标滚轮、触控板双指滑动或捏合进行拉近/拉远（与画布视口缩放手势互不抢占）。再点右上角「导出当前视角」可将当前视角截图保存到画布。`}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            title="VR 用等距柱状全景图，推荐约 2:1"
            className="studio-panorama__file"
            onChange={(e) => void onPickFile(e.target.files)}
          />
        </div>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="studio-handle" />

      {immersiveOpen
        ? createPortal(
            <div ref={immersiveRootRef} className="studio-panorama-immersive nowheel nodrag">
              <div className="studio-panorama-immersive__toolbar">
                <button
                  type="button"
                  className="studio-panorama-immersive__btn studio-panorama-immersive__btn--export"
                  disabled={exporting || Boolean(loadError)}
                  onClick={() => void handleExportImmersive()}
                >
                  {exporting ? '导出中…' : '导出当前视角'}
                </button>
                <button
                  type="button"
                  className="studio-panorama-immersive__btn"
                  onClick={closeImmersive}
                >
                  关闭
                </button>
              </div>
              <div
                ref={immersiveStageRef}
                className="studio-panorama-immersive__stage nowheel nodrag"
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
