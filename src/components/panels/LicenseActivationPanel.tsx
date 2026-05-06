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
import {
  apiPointsBalance,
  apiPointsBalanceAlert,
  apiPointsFailures,
  apiPointsLogs,
  type PointsFailureRow,
  type PointsLogRow as HttpPointsLogRow,
} from '../../lib/licensePointsApi'
import { syncPointsLicenseBinding } from '../../lib/pointsService'

export type LicenseActivationLayout = 'modal' | 'embedded'

export type LicenseActivationPanelProps = {
  /** 为 false 时不拉取网络、不渲染（嵌入设置页切走侧栏时） */
  active: boolean
  layout: LicenseActivationLayout
  onClose?: () => void
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

function parseLedgerMeta(metaJson: string | null | undefined): {
  cloud?: string
  workflow?: string
  error?: string
} {
  if (!metaJson) return {}
  try {
    const o = JSON.parse(metaJson) as { cloudModelName?: string; workflowName?: string; error?: string }
    return {
      cloud: String(o?.cloudModelName || '').trim() || undefined,
      workflow: String(o?.workflowName || '').trim() || undefined,
      error: String(o?.error || '').trim() || undefined,
    }
  } catch {
    return {}
  }
}

function ledgerTypeLabel(t: string): string {
  if (t === 'consume') return '消耗'
  if (t === 'recharge') return '充值'
  if (t === 'cancelled') return '已取消'
  if (t === 'refund') return '退款'
  if (t === 'reserve') return '预扣'
  return t
}

function ledgerExplain(row: HttpPointsLogRow): string {
  if (row.type === 'refund') return '任务失败，积分已退回'
  if (row.type === 'cancelled') return '已主动取消预扣，积分已退回'
  if (row.type === 'recharge') return row.description || '充值'
  if (row.type === 'reserve') return '任务执行中预扣；成功后会记为「消耗」。若长期停留此处可点「校验 / 刷新」或重试任务。'
  if (row.type === 'consume') return row.description || '消耗'
  return row.description || '—'
}

type LedgerFilter = 'all' | 'consume' | 'recharge' | 'refund' | 'reserve'

const FAILURE_REASON_UI_MAX = 120

/** 与 WorkflowSettingsPanel 云端 / 本地存储块一致 */
const LA_CARD = 'bg-[#111114] border border-white/5 rounded-2xl'
const LA_SECTION = 'text-[14px] font-black text-white/50 uppercase tracking-widest'
const LA_INPUT =
  'w-full rounded-xl border border-white/5 bg-black/40 p-3 text-[15px] font-mono text-white/70 outline-none focus:border-white/20'
const LA_BTN_PRIMARY =
  'shrink-0 rounded-full border border-white/10 bg-white px-5 py-2.5 text-[12px] font-black uppercase tracking-widest text-black transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-35'
const LA_BTN_DARK =
  'shrink-0 rounded-full border border-white/10 bg-[#1e1e22] px-5 py-2.5 text-[12px] font-black uppercase tracking-widest text-white/55 transition-colors hover:bg-white/10 hover:text-white/80 disabled:pointer-events-none disabled:opacity-35'
const LA_BTN_COMPACT =
  'shrink-0 rounded-full border border-white/10 bg-[#1e1e22] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-white/45 transition-colors hover:bg-white/10 hover:text-white/80 disabled:pointer-events-none disabled:opacity-35'

function TruncatedFailureReason({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const raw = String(text || '').trim()
  if (!raw) return null
  if (raw.length <= FAILURE_REASON_UI_MAX) {
    return <span>{raw}</span>
  }
  return (
    <span>
      {expanded ? raw : `${raw.slice(0, FAILURE_REASON_UI_MAX)}…`}
      {' '}
      <button type="button" className={LA_BTN_COMPACT} onClick={() => setExpanded((v) => !v)}>
        {expanded ? '收起' : '展开'}
      </button>
    </span>
  )
}

export function LicenseActivationPanel({ active, layout, onClose }: LicenseActivationPanelProps) {
  const cfg = useMemo(() => loadLicenseServerConfig(), [active])
  const [licenseCode, setLicenseCode] = useState(() => loadLicenseSnapshotV2()?.licenseCode || '')
  const [machineId, setMachineIdState] = useState<string>('')
  const [snapshot, setSnapshot] = useState<LicenseSnapshotV2 | null>(() => loadLicenseSnapshotV2())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [panelTab, setPanelTab] = useState<'auth' | 'ledger' | 'failures'>('auth')
  const [ledgerRows, setLedgerRows] = useState<HttpPointsLogRow[]>([])
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all')
  const [ledgerBusy, setLedgerBusy] = useState(false)
  const [ledgerErr, setLedgerErr] = useState('')
  const [failureRows, setFailureRows] = useState<PointsFailureRow[]>([])
  const [failureBusy, setFailureBusy] = useState(false)
  const [failureErr, setFailureErr] = useState('')
  const [lowBalanceWarn, setLowBalanceWarn] = useState(false)
  const [balanceAlertDismissed, setBalanceAlertDismissed] = useState(false)
  /** 授权服务上的当前积分（唯一账本，与流水一致） */
  const [serverBalance, setServerBalance] = useState<{
    points: number
    expireTime: string | null
    loading: boolean
    err: string
  }>({ points: 0, expireTime: null, loading: false, err: '' })

  useEffect(() => {
    if (!active) setBalanceAlertDismissed(false)
  }, [active])

  useEffect(() => {
    if (!active) return
    const code = String(snapshot?.licenseCode || '').trim()
    const mid = String(machineId || '').trim()
    if (!code || !mid) {
      setServerBalance({ points: 0, expireTime: null, loading: false, err: '' })
      return
    }
    let cancelled = false
    void (async () => {
      setServerBalance((s) => ({ ...s, loading: true, err: '' }))
      try {
        const r = await apiPointsBalance(code, mid)
        if (cancelled) return
        if (r.success) {
          setServerBalance({
            points: Number(r.points) || 0,
            expireTime: r.expireTime ?? null,
            loading: false,
            err: '',
          })
        } else {
          setServerBalance({
            points: 0,
            expireTime: null,
            loading: false,
            err: String(r.message || '无法读取积分余额'),
          })
        }
      } catch (e) {
        if (!cancelled) {
          setServerBalance({
            points: 0,
            expireTime: null,
            loading: false,
            err: String((e as Error)?.message || e || '余额查询失败'),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, panelTab, snapshot?.licenseCode, machineId, snapshot?.lastVerifiedAtMs])

  useEffect(() => {
    if (!active || balanceAlertDismissed) return
    const code = String(snapshot?.licenseCode || '').trim()
    const mid = String(machineId || '').trim()
    if (!code || !mid) {
      setLowBalanceWarn(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const r = await apiPointsBalanceAlert(code, mid, 100)
        if (cancelled) return
        setLowBalanceWarn(Boolean(r.belowThreshold))
      } catch {
        if (!cancelled) setLowBalanceWarn(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, balanceAlertDismissed, snapshot?.licenseCode, machineId, snapshot?.lastVerifiedAtMs])

  useEffect(() => {
    if (!active) return
    const snap = loadLicenseSnapshotV2()
    setSnapshot(snap)
    setLicenseCode(snap?.licenseCode || '')
    if (layout === 'modal') setPanelTab('auth')
    void getMachineId().then((id) => setMachineIdState(id)).catch(() => setMachineIdState(''))
  }, [active, layout])

  useEffect(() => {
    if (!active || panelTab !== 'ledger') return
    const code = String(snapshot?.licenseCode || '').trim()
    const mid = String(machineId || '').trim()
    if (!code || !mid) {
      setLedgerErr('请先激活授权并等待机器码读取完成。')
      setLedgerRows([])
      return
    }
    let cancelled = false
    const load = async () => {
      setLedgerBusy(true)
      setLedgerErr('')
      try {
        const { logs } = await apiPointsLogs(code, 1, 100)
        if (cancelled) return
        const visible = (logs || []).filter((r) =>
          ['consume', 'recharge', 'cancelled', 'refund', 'reserve'].includes(String(r.type)),
        )
        setLedgerRows(visible)
      } catch (e) {
        if (cancelled) return
        setLedgerErr(
          String((e as Error)?.message || e || '加载失败：请确认已启动 npm run auth:dev 或 npm run dev（积分 API：/pts）'),
        )
        setLedgerRows([])
      } finally {
        if (!cancelled) setLedgerBusy(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [active, panelTab, snapshot?.licenseCode, machineId, snapshot?.lastVerifiedAtMs])

  useEffect(() => {
    if (!active || panelTab !== 'failures') return
    const code = String(snapshot?.licenseCode || '').trim()
    const mid = String(machineId || '').trim()
    if (!code || !mid) {
      setFailureErr('请先激活授权并等待机器码读取完成。')
      setFailureRows([])
      return
    }
    let cancelled = false
    const load = async () => {
      setFailureBusy(true)
      setFailureErr('')
      try {
        const r = await apiPointsFailures(code, mid)
        if (cancelled) return
        if (!r.success) {
          setFailureErr(r.message || '加载失败')
          setFailureRows([])
          return
        }
        setFailureRows(r.failures || [])
      } catch (e) {
        if (cancelled) return
        setFailureErr(String((e as Error)?.message || e || '加载失败'))
        setFailureRows([])
      } finally {
        if (!cancelled) setFailureBusy(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [active, panelTab, snapshot?.licenseCode, machineId, snapshot?.lastVerifiedAtMs])

  const ledgerFiltered = useMemo(() => {
    if (ledgerFilter === 'all') return ledgerRows
    return ledgerRows.filter((r) => String(r.type) === ledgerFilter)
  }, [ledgerRows, ledgerFilter])

  const accessState = useMemo(() => computeAccessState(snapshot), [snapshot])

  if (!active) return null

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
      await syncPointsLicenseBinding({
        licenseCode: next.licenseCode,
        machineId: next.machineId,
        expiresAtMs: next.expiresAtMs,
      })
      setMsg(`激活成功：有效期至 ${formatDateTime(next.expiresAtMs)}`)
    } catch (e) {
      setMsg(String((e as { message?: string })?.message || e || '激活失败'))
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
      await syncPointsLicenseBinding({
        licenseCode: next.licenseCode,
        machineId: next.machineId,
        expiresAtMs: next.expiresAtMs,
      })
      setMsg(`校验成功：${accessLabel(computeAccessState(next))}（至 ${formatDateTime(next.expiresAtMs)}）`)
    } catch (e) {
      setMsg(String((e as { message?: string })?.message || e || '校验失败'))
    } finally {
      setBusy(false)
    }
  }

  const subTabBtn = (tab: 'auth' | 'ledger' | 'failures') =>
    `flex-1 rounded-full py-3 text-[13px] font-black uppercase tracking-widest transition-all ${
      panelTab === tab
        ? 'border border-white/5 bg-white/5 text-white/90 shadow-xl'
        : 'border border-transparent text-white/20 hover:text-white/40'
    }`

  const ledgerGridCols =
    'grid grid-cols-[148px_64px_52px_52px_minmax(200px,2fr)_minmax(88px,1fr)_minmax(88px,1fr)]'

  const flowidBody = (
    <>
      {lowBalanceWarn && !balanceAlertDismissed ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100/95"
        >
          <span>积分余额不足 100，即将用尽，请购买新授权码</span>
          <button type="button" className={LA_BTN_COMPACT} onClick={() => setBalanceAlertDismissed(true)} aria-label="关闭提示">
            关闭
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-full border border-white/5 bg-black/30 p-1" role="tablist" aria-label="授权与账单">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'auth'}
          className={subTabBtn('auth')}
          onClick={() => setPanelTab('auth')}
        >
          授权
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'ledger'}
          className={subTabBtn('ledger')}
          onClick={() => {
            setLedgerFilter('all')
            setPanelTab('ledger')
          }}
        >
          积分流水
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'failures'}
          className={subTabBtn('failures')}
          onClick={() => setPanelTab('failures')}
        >
          失败记录
        </button>
      </div>

      {panelTab === 'auth' ? (
        <div className="space-y-5">
          <div className={`${LA_CARD} overflow-hidden p-2`}>
            <div className="border-b border-white/5 p-6">
              <div className="text-[15px] font-black uppercase tracking-[0.2em] text-white/70">购买与激活</div>
            </div>
            <div className="space-y-5 p-6">
              <p className="m-0 text-[13px] leading-relaxed text-white/25">
                填写授权码后点「激活」；可随时「校验 / 刷新」与服务器同步。画布扣减与退款只记一套积分；预扣中间态不在「积分流水」展示。
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="w-24 shrink-0 px-1">
                  <div className="text-[14px] font-black uppercase text-white/80">购买</div>
                  <div className="font-mono text-[11px] uppercase text-white/25">link</div>
                </div>
                <div className="min-w-0 flex-1 sm:text-left">
                  {String(cfg.purchaseUrl || '').trim() ? (
                    <a
                      href={String(cfg.purchaseUrl || '').trim()}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-[14px] font-bold text-orange-400/95 underline-offset-4 hover:text-orange-300 hover:underline"
                    >
                      {String(cfg.purchaseUrl || '').trim()}
                    </a>
                  ) : (
                    <span className="text-[14px] text-white/25">-</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="w-24 shrink-0 px-1">
                  <div className="text-[14px] font-black uppercase text-white/80">机器码</div>
                  <div className="font-mono text-[11px] uppercase text-white/25">machine</div>
                </div>
                <div className="min-w-0 flex-1 break-all font-mono text-[13px] leading-relaxed text-white/55">
                  {machineId || '读取中…'}
                </div>
              </div>

              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                  <div className="w-24 shrink-0 px-1 pb-0.5 sm:pb-2">
                    <div className="text-[14px] font-black uppercase text-white/80">授权码</div>
                    <div className="font-mono text-[11px] uppercase text-white/25">code</div>
                  </div>
                  <input
                    className={`${LA_INPUT} min-w-0 flex-1`}
                    value={licenseCode}
                    onChange={(e) => setLicenseCode(e.target.value)}
                    placeholder="请输入授权码"
                    aria-label="授权码"
                  />
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" className={LA_BTN_PRIMARY} onClick={activate} disabled={busy}>
                    {busy ? '处理中…' : '激活'}
                  </button>
                  <button type="button" className={LA_BTN_DARK} onClick={verify} disabled={busy}>
                    校验 / 刷新
                  </button>
                </div>
              </div>

              <div className="space-y-2 border-t border-white/5 pt-5 text-[13px] text-white/50">
                <div>
                  <span className="text-white/30">当前状态：</span>
                  {accessLabel(accessState)}
                </div>
                <div>
                  <span className="text-white/30">有效期至：</span>
                  {formatDateTime(snapshot?.expiresAtMs)}
                </div>
                <div>
                  <span className="text-white/30">最近校验：</span>
                  {formatDateTime(snapshot?.lastVerifiedAtMs)}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                  <div className="text-[11px] font-black uppercase tracking-[0.15em] text-white/35">当前积分</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[22px] font-black tabular-nums text-white/90">
                      {serverBalance.loading ? '…' : serverBalance.err ? '—' : serverBalance.points}
                    </span>
                    {!serverBalance.loading && !serverBalance.err ? (
                      <span className="text-[12px] text-white/30">点</span>
                    ) : null}
                  </div>
                  {serverBalance.err ? (
                    <div className="mt-1 text-[12px] text-red-300/90">{serverBalance.err}</div>
                  ) : (
                    <div className="mt-1 text-[11px] leading-relaxed text-white/30">
                      「积分流水」为明细。执行或退款后会自动更新，也可点「校验 / 刷新」。
                    </div>
                  )}
                </div>
              </div>
              {msg ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[13px] leading-relaxed text-white/65">
                  {msg}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {panelTab === 'ledger' ? (
        <div className="space-y-4">
          <div
            className={`${LA_CARD} flex flex-wrap items-end justify-between gap-3 border border-orange-500/15 bg-orange-500/[0.06] px-4 py-3`}
            role="status"
          >
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/35">当前余额</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                {serverBalance.loading ? (
                  <span className="text-[15px] text-white/40">同步中…</span>
                ) : serverBalance.err ? (
                  <span className="text-[13px] text-red-300/90">{serverBalance.err}</span>
                ) : (
                  <span className="font-mono text-[26px] font-black tabular-nums leading-none text-white">
                    {serverBalance.points}
                  </span>
                )}
                {!serverBalance.loading && !serverBalance.err ? (
                  <span className="text-[12px] text-white/30">点</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className={LA_SECTION}>积分流水</div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="积分流水类型筛选">
            {(
              [
                { v: 'all' as const, label: '全部' },
                { v: 'consume' as const, label: '消费' },
                { v: 'reserve' as const, label: '预扣' },
                { v: 'recharge' as const, label: '充值' },
                { v: 'refund' as const, label: '退款' },
              ] as const
            ).map(({ v, label }) => (
              <button
                key={v}
                type="button"
                className={`rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-all ${
                  ledgerFilter === v
                    ? 'border border-white/5 bg-white/5 text-white/90'
                    : 'border border-transparent text-white/25 hover:text-white/45'
                }`}
                onClick={() => setLedgerFilter(v)}
              >
                {label}
              </button>
            ))}
          </div>
          {ledgerBusy ? <p className="m-0 text-[13px] text-white/35">加载中…</p> : null}
          {ledgerErr ? <p className="m-0 text-[13px] text-red-300/90">{ledgerErr}</p> : null}
          {!ledgerBusy && !ledgerErr && ledgerFiltered.length === 0 ? (
            <p className="m-0 text-[13px] text-white/35">暂无账单记录。</p>
          ) : null}
          {ledgerFiltered.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="min-w-[860px] overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                <div
                  className={`${ledgerGridCols} gap-2 border-b border-white/5 bg-black/40 px-4 py-3 text-[12px] font-black uppercase tracking-[0.2em] text-white/20`}
                >
                  <span>时间</span>
                  <span>类型</span>
                  <span>变动</span>
                  <span className="text-right">余额</span>
                  <span>描述</span>
                  <span>模型</span>
                  <span>工作流</span>
                </div>
                <div className="max-h-[min(52vh,520px)] overflow-auto custom-scrollbar">
                  {ledgerFiltered.map((row) => {
                    const m = parseLedgerMeta(row.meta_json)
                    return (
                      <div
                        key={row.id}
                        className={`${ledgerGridCols} items-start gap-2 border-t border-white/5 px-4 py-3 text-[13px] text-white/55`}
                      >
                        <span className="font-mono text-[12px] text-white/35">{row.created_at || '-'}</span>
                        <span className="text-[12px] text-white/50">{ledgerTypeLabel(row.type)}</span>
                        <span className="font-mono text-[12px] text-white/45">
                          {row.type === 'refund' ? `+${Math.abs(Number(row.amount || 0))}` : row.amount}
                        </span>
                        <span className="text-right font-mono text-[12px] text-white/45">{row.after_points}</span>
                        <div className="min-w-0 text-[12px] leading-snug text-white/45">
                          {row.type === 'refund' ? (
                            <div>任务失败，积分已退回</div>
                          ) : (
                            ledgerExplain(row)
                          )}
                        </div>
                        <span className="min-w-0 truncate font-mono text-[12px] text-white/40">{m.cloud || '—'}</span>
                        <span className="min-w-0 truncate font-mono text-[12px] text-white/40">{m.workflow || '—'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {panelTab === 'failures' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className={LA_SECTION}>失败记录</div>
            <div className="text-[12px] text-white/30">任务失败后自动退回积分；可复制幂等键排查</div>
          </div>
          {failureBusy ? <p className="m-0 text-[13px] text-white/35">加载中…</p> : null}
          {failureErr ? <p className="m-0 text-[13px] text-red-300/90">{failureErr}</p> : null}
          {!failureBusy && !failureErr && failureRows.length === 0 ? (
            <p className="m-0 text-[13px] text-white/35">暂无失败退款记录。</p>
          ) : null}
          {failureRows.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="min-w-[800px] overflow-hidden rounded-2xl border border-white/5 bg-black/20">
                <div className="grid grid-cols-[140px_100px_100px_minmax(200px,1.5fr)_52px_minmax(160px,1.2fr)] gap-2 border-b border-white/5 bg-black/40 px-4 py-3 text-[12px] font-black uppercase tracking-[0.2em] text-white/20">
                  <span>时间</span>
                  <span>工作流</span>
                  <span>模型</span>
                  <span>失败原因</span>
                  <span className="text-right">退回</span>
                  <span>幂等键</span>
                </div>
                <div className="max-h-[min(48vh,480px)] overflow-auto custom-scrollbar">
                  {failureRows.map((row) => {
                    const m = parseLedgerMeta(row.meta_json)
                    return (
                      <div
                        key={row.id}
                        className="grid grid-cols-[140px_100px_100px_minmax(200px,1.5fr)_52px_minmax(160px,1.2fr)] items-start gap-2 border-t border-white/5 px-4 py-3 text-[13px] text-white/55"
                      >
                        <span className="font-mono text-[12px] text-white/35">{row.created_at || '-'}</span>
                        <span className="min-w-0 truncate text-[12px] text-white/45">{m.workflow || '—'}</span>
                        <span className="min-w-0 truncate font-mono text-[12px] text-white/40">{m.cloud || '—'}</span>
                        <div className="min-w-0 text-[12px] leading-snug text-white/45">
                          {m.error ? <TruncatedFailureReason text={m.error} /> : '—'}
                        </div>
                        <span className="text-right font-mono text-[12px] text-white/45">
                          +{Math.abs(Number(row.amount || 0))}
                        </span>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="break-all font-mono text-[11px] text-white/40">{row.dedupe_key || '—'}</span>
                          {row.dedupe_key ? (
                            <button
                              type="button"
                              className={LA_BTN_COMPACT}
                              onClick={() => void navigator.clipboard?.writeText(row.dedupe_key || '')}
                            >
                              复制
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )

  if (layout === 'embedded') {
    return (
      <div className="workflow-settings-panel--flowid min-w-0 space-y-5" aria-label="授权码">
        <div className={`${LA_CARD} min-w-0 space-y-6 p-6`}>{flowidBody}</div>
      </div>
    )
  }

  return (
    <section
      className={`auth-modal${panelTab === 'ledger' || panelTab === 'failures' ? ' auth-modal--ledger' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="授权码"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="auth-modal__head">
        <h3>{panelTab === 'ledger' ? '积分流水' : panelTab === 'failures' ? '失败记录' : '授权码'}</h3>
        <button type="button" className="auth-modal__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>
      <div className="auth-modal__body">
        <div className="workflow-settings-panel--flowid">{flowidBody}</div>
      </div>
    </section>
  )
}
