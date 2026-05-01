import { useEffect, useMemo, useState } from 'react'
import {
  computeAccessState,
  loadLicenseServerConfig,
  loadLicenseSnapshotV2,
  saveLicenseSnapshotV2,
  touchLicenseLocalTime,
  type AccessState,
  type LicenseSnapshotV2,
} from '../../lib/licenseAccess'
import { activateLicenseRemote, verifyLicenseRemote } from '../../lib/licenseClient'
import { getMachineId } from '../../lib/machineId'

type LicenseModalProps = {
  open: boolean
  onClose: () => void
}

function formatDateTime(ts: number | undefined): string {
  if (!ts || !Number.isFinite(ts)) return '-'
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return '-'
  }
}

function accessLabel(state: AccessState): string {
  if (state === 'valid') return '已授权'
  if (state === 'expired') return '已过期'
  if (state === 'tampered_need_verify') return '需校验'
  return '未授权'
}

export function LicenseModal({ open, onClose }: LicenseModalProps) {
  const cfg = useMemo(() => loadLicenseServerConfig(), [open])
  const [licenseCode, setLicenseCode] = useState(() => loadLicenseSnapshotV2()?.licenseCode || '')
  const [machineId, setMachineIdState] = useState<string>('')
  const [snapshot, setSnapshot] = useState<LicenseSnapshotV2 | null>(() => loadLicenseSnapshotV2())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    const snap = loadLicenseSnapshotV2()
    setSnapshot(snap)
    setLicenseCode(snap?.licenseCode || '')
    void getMachineId().then((id) => setMachineIdState(id)).catch(() => setMachineIdState(''))
  }, [open])

  const accessState = useMemo(() => computeAccessState(snapshot), [snapshot])

  if (!open) return null

  const activate = async () => {
    try {
      setBusy(true)
      setMsg('激活中…')
      const res = await activateLicenseRemote(licenseCode)
      if (!res.ok) {
        const st = res.httpStatus ?? 0
        if (st >= 400 && st < 500) {
          saveLicenseSnapshotV2(null)
          setSnapshot(null)
          setMsg(`${res.message || '激活失败'}（已清除本机授权缓存）`)
        } else {
          setMsg(res.message || '激活失败')
        }
        return
      }
      const next: LicenseSnapshotV2 = {
        licenseCode: res.licenseCode,
        machineId: res.machineId,
        expiresAtMs: res.expiresAtMs,
        entitlements: res.entitlements,
        lastSeenLocalTimeMs: Date.now(),
        lastVerifiedAtMs: Date.now(),
        serverAnchor: {
          serverTimeMs: res.serverTimeMs,
          localTimeMs: Date.now(),
          updatedAtMs: Date.now(),
        },
      }
      saveLicenseSnapshotV2(next)
      setSnapshot(next)
      setMsg(`激活成功：有效期至 ${formatDateTime(next.expiresAtMs)}`)
    } catch (e) {
      setMsg(String((e as any)?.message || e || '激活失败'))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    const curr = loadLicenseSnapshotV2()
    if (!curr) {
      setMsg('请先输入授权码并激活。')
      return
    }
    try {
      setBusy(true)
      setMsg('校验中…')
      const tamper = touchLicenseLocalTime(curr)
      if (!tamper.ok) {
        setMsg('检测到系统时间回拨：请联网校验授权以恢复正常。')
      }
      const res = await verifyLicenseRemote(loadLicenseSnapshotV2()!)
      if (!res.ok) {
        const st = res.httpStatus ?? 0
        // 4xx：服务端明确拒绝（码已删、冻结、设备不匹配等）；5xx/网络异常不清本地，避免误伤离线用户。
        if (st >= 400 && st < 500) {
          saveLicenseSnapshotV2(null)
          setSnapshot(null)
          setMsg(`${res.message || '校验失败'}（已清除本机授权缓存，请重新激活）`)
        } else {
          setMsg(res.message || '校验失败')
        }
        return
      }
      const now = Date.now()
      const next: LicenseSnapshotV2 = {
        ...curr,
        licenseCode: res.licenseCode,
        machineId: res.machineId,
        expiresAtMs: res.expiresAtMs,
        entitlements: res.entitlements,
        lastVerifiedAtMs: now,
        serverAnchor: {
          serverTimeMs: res.serverTimeMs,
          localTimeMs: now,
          updatedAtMs: now,
        },
      }
      saveLicenseSnapshotV2(next)
      setSnapshot(next)
      setMsg(`校验成功：${accessLabel(computeAccessState(next))}（至 ${formatDateTime(next.expiresAtMs)}）`)
    } catch (e) {
      setMsg(String((e as any)?.message || e || '校验失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="workflow-settings-backdrop" onMouseDown={onClose}>
      <section
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label="机器码授权"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="auth-modal__head">
          <h3>机器码授权</h3>
          <button type="button" className="auth-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="auth-modal__body">
          <div className="auth-modal__links">
            <div className="auth-modal__link-row">
              <span className="k">访问地址</span>
              {String(cfg.purchaseUrl || '').trim() ? (
                <a className="v" href={String(cfg.purchaseUrl || '').trim()} target="_blank" rel="noreferrer">
                  {String(cfg.purchaseUrl || '').trim()}
                </a>
              ) : (
                <span className="v v-empty">-</span>
              )}
            </div>
          </div>

          <div className="auth-modal__row">本机机器码：{machineId || '读取中…'}</div>

          <label className="auth-modal__field">
            <span>机器激活码（授权码）</span>
            <input
              value={licenseCode}
              onChange={(e) => setLicenseCode(e.target.value)}
              placeholder="请输入授权码"
            />
          </label>

          <div className="auth-modal__actions">
            <button type="button" className="btn btn--chip btn--chip-primary" onClick={activate} disabled={busy}>
              {busy ? '处理中…' : '激活'}
            </button>
            <button type="button" className="btn btn--chip btn--chip-dark" onClick={verify} disabled={busy}>
              校验 / 刷新
            </button>
          </div>

          <div className="auth-modal__status">
            <div className="auth-modal__row">当前状态：{accessLabel(accessState)}</div>
            <div className="auth-modal__row">有效期至：{formatDateTime(snapshot?.expiresAtMs)}</div>
            <div className="auth-modal__row">最近校验：{formatDateTime(snapshot?.lastVerifiedAtMs)}</div>
            {msg ? <p className="auth-modal__row auth-modal__msg">{msg}</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}

