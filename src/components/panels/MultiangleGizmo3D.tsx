import * as THREE from 'three'
import { useEffect, useRef } from 'react'
import {
  clampMultiangleHV,
  clampMultiangleZoom,
  FLOWID_MULTIANGLE_DEFAULT_H,
  FLOWID_MULTIANGLE_DEFAULT_V,
  FLOWID_MULTIANGLE_DEFAULT_ZOOM,
  FLOWID_MULTIANGLE_ZOOM_MAX,
  FLOWID_MULTIANGLE_ZOOM_MIN,
} from '../../lib/comfyMultianglePlaceholders'

export type MultiangleGizmo3DProps = {
  h: number
  v: number
  z: number
  canvasDayMode: boolean
  onH: (n: number) => void
  onV: (n: number) => void
  onZ: (n: number) => void
}

const R_RING = 1
const SUBJECT_Y = 0.28
const V_PLANE_X = -0.92
const V_CY = 0.22
const V_R = 0.42
const V_SWING = Math.PI / 2.1

type DragMode = 'h' | 'v' | 'z' | null

function ringRadFromH(h: number): number {
  const hh = clampMultiangleHV(h, FLOWID_MULTIANGLE_DEFAULT_H)
  return Math.PI / 2 - (hh / 60) * (Math.PI / 2)
}

function hFromRingPlane(px: number, pz: number): number {
  const rad = Math.atan2(pz, px)
  let hh = ((Math.PI / 2 - rad) / (Math.PI / 2)) * 60
  return clampMultiangleHV(hh, FLOWID_MULTIANGLE_DEFAULT_H)
}

function vSphereLocal(v: number): THREE.Vector3 {
  const vv = clampMultiangleHV(v, FLOWID_MULTIANGLE_DEFAULT_V)
  const vr = (vv / 60) * V_SWING
  return new THREE.Vector3(V_PLANE_X, V_CY + V_R * Math.sin(vr), V_R * Math.cos(vr))
}

function vFromPlaneHit(py: number, pz: number): number {
  const dy = py - V_CY
  let rad = Math.atan2(dy, pz)
  if (rad < -V_SWING) rad = -V_SWING
  if (rad > V_SWING) rad = V_SWING
  return clampMultiangleHV((rad / V_SWING) * 60, FLOWID_MULTIANGLE_DEFAULT_V)
}

function cameraWorld(h: number, v: number, z: number): THREE.Vector3 {
  const rad = ringRadFromH(h)
  const phi = (clampMultiangleHV(v, FLOWID_MULTIANGLE_DEFAULT_V) / 60) * (Math.PI / 4)
  const zz = clampMultiangleZoom(z, FLOWID_MULTIANGLE_DEFAULT_ZOOM)
  const dist = 0.52 + ((zz - FLOWID_MULTIANGLE_ZOOM_MIN) / (FLOWID_MULTIANGLE_ZOOM_MAX - FLOWID_MULTIANGLE_ZOOM_MIN)) * 1.72
  const dx = Math.cos(rad)
  const dz = Math.sin(rad)
  const hScale = Math.cos(phi) * dist
  return new THREE.Vector3(dx * hScale, SUBJECT_Y + Math.sin(phi) * dist, dz * hScale)
}

function zFromSegmentHit(ray: THREE.Ray, segStart: THREE.Vector3, segEnd: THREE.Vector3): number | null {
  const onSeg = new THREE.Vector3()
  ray.distanceSqToSegment(segStart, segEnd, undefined, onSeg)
  const full = segStart.distanceTo(segEnd)
  if (full < 1e-6) return null
  const tLin = Math.max(0, Math.min(1, onSeg.distanceTo(segStart) / full))
  return FLOWID_MULTIANGLE_ZOOM_MIN + tLin * (FLOWID_MULTIANGLE_ZOOM_MAX - FLOWID_MULTIANGLE_ZOOM_MIN)
}

export function MultiangleGizmo3D({ h, v, z, canvasDayMode, onH, onV, onZ }: MultiangleGizmo3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const dragModeRef = useRef<DragMode>(null)
  const syncRef = useRef({ h, v, z, onH, onV, onZ })
  syncRef.current = { h, v, z, onH, onV, onZ }
  const ctxRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    hSphere: THREE.Mesh
    vSphere: THREE.Mesh
    zSphere: THREE.Mesh
    camCube: THREE.Mesh
    rod: THREE.Line
    ring: THREE.Mesh
    arcLine: THREE.Line
    subject: THREE.Mesh
    raycaster: THREE.Raycaster
    pointerNdc: THREE.Vector2
    planeY: THREE.Plane
    planeV: THREE.Plane
  } | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const w = mount.clientWidth || 340
    const hPx = 248

    const scene = new THREE.Scene()
    if (canvasDayMode) {
      scene.background = new THREE.Color(0xeceef2)
    } else {
      scene.background = new THREE.Color(0x0a0c10)
    }

    const camera = new THREE.PerspectiveCamera(42, w / hPx, 0.08, 80)
    camera.position.set(2.35, 1.72, 2.35)
    camera.lookAt(0, 0.22, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, hPx)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0x8a9aba, canvasDayMode ? 0.55 : 0.35))
    const key = new THREE.DirectionalLight(0xffffff, canvasDayMode ? 0.85 : 0.55)
    key.position.set(3.2, 5.5, 2.8)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x7c3aed, canvasDayMode ? 0.2 : 0.35)
    rim.position.set(-2, 2, -3)
    scene.add(rim)

    const grid = new THREE.GridHelper(3.6, 18, 0x7c3aed, canvasDayMode ? 0xc4b5fd : 0x3d2a5c)
    grid.position.y = 0
    scene.add(grid)

    const subGeo = new THREE.BoxGeometry(0.38, 0.58, 0.045)
    const subMat = new THREE.MeshStandardMaterial({
      color: canvasDayMode ? 0x9ca3af : 0x6b7280,
      metalness: 0.2,
      roughness: 0.75,
    })
    const subject = new THREE.Mesh(subGeo, subMat)
    subject.position.set(0, SUBJECT_Y, 0)
    scene.add(subject)

    const ringGeo = new THREE.TorusGeometry(R_RING, 0.028, 14, 64)
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xdb2777,
      emissive: 0x9d174d,
      emissiveIntensity: canvasDayMode ? 0.35 : 0.65,
      metalness: 0.35,
      roughness: 0.35,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.02
    scene.add(ring)

    const arcPts: THREE.Vector3[] = []
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * V_SWING
      arcPts.push(new THREE.Vector3(V_PLANE_X, V_CY + V_R * Math.sin(t), V_R * Math.cos(t)))
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts)
    const arcMat = new THREE.LineBasicMaterial({
      color: 0x2dd4bf,
      linewidth: 1,
      transparent: true,
      opacity: 0.95,
    })
    const arcLine = new THREE.Line(arcGeo, arcMat)
    scene.add(arcLine)

    const mkSphere = (color: number, emissive: number, scale = 1) => {
      const g = new THREE.SphereGeometry(0.09 * scale, 28, 28)
      const m = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: canvasDayMode ? 0.45 : 0.9,
        metalness: 0.15,
        roughness: 0.25,
      })
      return new THREE.Mesh(g, m)
    }

    const hSphere = mkSphere(0xec4899, 0x831843, 1.05)
    const vSphere = mkSphere(0x14b8a6, 0x0f766e, 1.05)
    const zSphere = mkSphere(0xf59e0b, 0xb45309, 0.95)
    scene.add(hSphere, vSphere, zSphere)

    const camGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14)
    const camMat = new THREE.MeshStandardMaterial({
      color: 0xf472b6,
      emissive: 0x9d174d,
      emissiveIntensity: canvasDayMode ? 0.5 : 0.95,
      metalness: 0.4,
      roughness: 0.3,
    })
    const camCube = new THREE.Mesh(camGeo, camMat)
    scene.add(camCube)

    const rodGeo = new THREE.BufferGeometry()
    const rodMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.14,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.95,
    })
    const rod = new THREE.Line(rodGeo, rodMat)
    scene.add(rod)

    const raycaster = new THREE.Raycaster()
    const pointerNdc = new THREE.Vector2()
    const planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const planeV = new THREE.Plane(new THREE.Vector3(1, 0, 0), V_PLANE_X)

    ctxRef.current = {
      renderer,
      scene,
      camera,
      hSphere,
      vSphere,
      zSphere,
      camCube,
      rod,
      ring,
      arcLine,
      subject,
      raycaster,
      pointerNdc,
      planeY,
      planeV,
    }

    const updateMeshes = (hh: number, vv: number, zz: number) => {
      const rad = ringRadFromH(hh)
      hSphere.position.set(R_RING * Math.cos(rad), 0.07, R_RING * Math.sin(rad))
      const vp = vSphereLocal(vv)
      vSphere.position.copy(vp)

      const origin = new THREE.Vector3(0, SUBJECT_Y, 0)
      const cam = cameraWorld(hh, vv, zz)
      camCube.position.copy(cam)

      const rodPos = [origin, cam] as THREE.Vector3[]
      rodGeo.setFromPoints(rodPos)
      rod.computeLineDistances()

      const mid = new THREE.Vector3().lerpVectors(origin, cam, 0.78)
      zSphere.position.copy(mid)
    }

    updateMeshes(h, v, z)
    renderer.render(scene, camera)

    const ro = new ResizeObserver(() => {
      const ctx = ctxRef.current
      if (!ctx || !mountRef.current) return
      const nw = mountRef.current.clientWidth || 340
      ctx.camera.aspect = nw / hPx
      ctx.camera.updateProjectionMatrix()
      ctx.renderer.setSize(nw, hPx)
      ctx.renderer.render(ctx.scene, ctx.camera)
    })
    ro.observe(mount)

    return () => {
      ro.disconnect()
      ctxRef.current = null
      mount.removeChild(renderer.domElement)
      renderer.dispose()
      ringGeo.dispose()
      ringMat.dispose()
      subGeo.dispose()
      subMat.dispose()
      arcGeo.dispose()
      arcMat.dispose()
      rodGeo.dispose()
      rodMat.dispose()
      camGeo.dispose()
      camMat.dispose()
      ;[hSphere, vSphere, zSphere].forEach((m) => {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      })
      scene.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; props synced in separate effect
  }, [canvasDayMode])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const rad = ringRadFromH(h)
    ctx.hSphere.position.set(R_RING * Math.cos(rad), 0.07, R_RING * Math.sin(rad))
    ctx.vSphere.position.copy(vSphereLocal(v))

    const origin = new THREE.Vector3(0, SUBJECT_Y, 0)
    const cam = cameraWorld(h, v, z)
    ctx.camCube.position.copy(cam)
    const rodGeo = ctx.rod.geometry as THREE.BufferGeometry
    rodGeo.setFromPoints([origin, cam])
    ctx.rod.computeLineDistances()

    const mid = new THREE.Vector3().lerpVectors(origin, cam, 0.78)
    ctx.zSphere.position.copy(mid)

    ctx.renderer.render(ctx.scene, ctx.camera)
  }, [h, v, z])

  useEffect(() => {
    let cancelled = false
    let attached: HTMLCanvasElement | null = null
    let onDown: ((e: MouseEvent) => void) | undefined
    let onMove: ((e: MouseEvent) => void) | undefined
    let onUp: (() => void) | undefined

    const rid = requestAnimationFrame(() => {
      if (cancelled) return
      const el = mountRef.current?.querySelector('canvas')
      if (!el) return
      attached = el

      const setNdc = (e: MouseEvent) => {
        const rect = el.getBoundingClientRect()
        const ctx = ctxRef.current
        if (!ctx) return
        ctx.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        ctx.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      }

      const pick = (e: MouseEvent): DragMode => {
        const ctx = ctxRef.current
        if (!ctx) return null
        setNdc(e)
        ctx.raycaster.setFromCamera(ctx.pointerNdc, ctx.camera)
        const targets = [ctx.hSphere, ctx.vSphere, ctx.zSphere, ctx.camCube]
        const hits = ctx.raycaster.intersectObjects(targets, false)
        if (!hits.length) return null
        const o = hits[0].object
        if (o === ctx.hSphere) return 'h'
        if (o === ctx.vSphere) return 'v'
        if (o === ctx.zSphere || o === ctx.camCube) return 'z'
        return null
      }

      onDown = (e: MouseEvent) => {
        const mode = pick(e)
        if (!mode) return
        e.preventDefault()
        dragModeRef.current = mode
        el.style.cursor = 'grabbing'
      }

      onMove = (e: MouseEvent) => {
        const ctx = ctxRef.current
        if (!ctx) return
        setNdc(e)
        ctx.raycaster.setFromCamera(ctx.pointerNdc, ctx.camera)

        const mode = dragModeRef.current
        if (!mode) {
          const hov = pick(e)
          el.style.cursor = hov ? 'grab' : 'default'
          return
        }

        if (mode === 'h') {
          const { onH: oh } = syncRef.current
          const hit = new THREE.Vector3()
          if (ctx.raycaster.ray.intersectPlane(ctx.planeY, hit)) {
            hit.y = 0
            const len = Math.hypot(hit.x, hit.z)
            if (len > 1e-4) {
              const px = (hit.x / len) * R_RING
              const pz = (hit.z / len) * R_RING
              oh(hFromRingPlane(px, pz))
            }
          }
        } else if (mode === 'v') {
          const { onV: ov } = syncRef.current
          const hit = new THREE.Vector3()
          if (ctx.raycaster.ray.intersectPlane(ctx.planeV, hit)) {
            ov(vFromPlaneHit(hit.y, hit.z))
          }
        } else if (mode === 'z') {
          const { h: hh, v: vv, z: zz, onZ: oz } = syncRef.current
          const origin = new THREE.Vector3(0, SUBJECT_Y, 0)
          const cam = cameraWorld(hh, vv, zz)
          const nz = zFromSegmentHit(ctx.raycaster.ray, origin, cam)
          if (nz != null) oz(clampMultiangleZoom(nz, FLOWID_MULTIANGLE_DEFAULT_ZOOM))
        }
      }

      onUp = () => {
        dragModeRef.current = null
        el.style.cursor = 'default'
      }

      el.addEventListener('mousedown', onDown)
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(rid)
      if (attached && onDown && onMove && onUp) {
        attached.removeEventListener('mousedown', onDown)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 使用 syncRef 读最新 h/v/z 与回调，仅绑定一次
  }, [])

  return (
    <div
      ref={mountRef}
      className="studio-multiangle-popover__gizmo3d"
      role="img"
      aria-label="三维镜头摇杆：粉球水平、青球垂直、黄球或粉方块调距离"
    />
  )
}
