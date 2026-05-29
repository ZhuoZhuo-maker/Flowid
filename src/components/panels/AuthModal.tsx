import { useMemo, useState } from 'react'
import {
  authenticateRemote,
  clearAuthSession,
  loadAuthApiConfig,
  saveAuthApiConfig,
  type AuthSession,
} from '../../lib/auth'
import { saveLocalLicenseSnapshot } from '../../lib/license'
import { isLicenseServerOriginLockedByBuild } from '../../lib/licenseAccess'

type AuthModalProps = {
  open: boolean
  session: AuthSession | null
  onClose: () => void
  onSuccess: (session: AuthSession | null) => void
}

/**
 * 登录/注册弹窗（当前为本地占位认证，后续可无缝替换后端接口）。
 */
export function AuthModal({ open, session, onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const authLocked = useMemo(() => isLicenseServerOriginLockedByBuild(), [])
  const [apiBaseUrl, setApiBaseUrl] = useState(() => loadAuthApiConfig().baseUrl)
  const [submitting, setSubmitting] = useState(false)

  const machineCode = useMemo(() => session?.machineCode || '登录后自动生成', [session])

  if (!open) return null

  const submit = async () => {
    try {
      setSubmitting(true)
      const base = authLocked ? loadAuthApiConfig().baseUrl : apiBaseUrl
      const next = await authenticateRemote(base, account, password, mode)
      saveLocalLicenseSnapshot({
        status: next.licenseStatus,
        expiresAtMs: next.expiresAtMs,
        lastNoticeAtMs: undefined,
      })
      if (!authLocked) saveAuthApiConfig({ baseUrl: apiBaseUrl })
      onSuccess(next)
      onClose()
      window.alert(mode === 'login' ? '登录成功' : '注册成功')
    } catch (error) {
      window.alert((error as Error)?.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const logout = () => {
    clearAuthSession()
    onSuccess(null)
    onClose()
    window.alert('已退出登录')
  }

  return (
    <div className="workflow-settings-backdrop" onMouseDown={onClose}>
      <section
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label="登录注册"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="auth-modal__head">
          <h3>{session ? '账号信息' : mode === 'login' ? '登录' : '注册'}</h3>
          <button type="button" className="auth-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="auth-modal__body">
          {!session ? (
            <>
              <div className="auth-modal__tabs">
                <button
                  type="button"
                  className={`auth-modal__tab ${mode === 'login' ? 'is-active' : ''}`}
                  onClick={() => setMode('login')}
                >
                  登录
                </button>
                <button
                  type="button"
                  className={`auth-modal__tab ${mode === 'register' ? 'is-active' : ''}`}
                  onClick={() => setMode('register')}
                >
                  注册
                </button>
              </div>
              <label className="auth-modal__field">
                <span>认证服务地址</span>
                <input
                  value={authLocked ? loadAuthApiConfig().baseUrl : apiBaseUrl}
                  onChange={authLocked ? undefined : (e) => setApiBaseUrl(e.target.value)}
                  readOnly={authLocked}
                  placeholder={authLocked ? '' : '例如：https://api.example.com'}
                />
                {authLocked ? <span className="auth-modal__hint">当前版本已固定认证服务地址，不可修改。</span> : null}
              </label>
              <label className="auth-modal__field">
                <span>账号</span>
                <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="请输入账号" />
              </label>
              <label className="auth-modal__field">
                <span>密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                />
              </label>
              <button type="button" className="btn btn--chip btn--chip-primary" onClick={submit} disabled={submitting}>
                {submitting ? '提交中…' : mode === 'login' ? '登录' : '注册'}
              </button>
            </>
          ) : (
            <>
              <p className="auth-modal__row">账号：{session.account}</p>
              <p className="auth-modal__row">昵称：{session.nickname}</p>
              <p className="auth-modal__row">设备码：{machineCode}</p>
              <p className="auth-modal__row">授权状态：{session.licenseStatus}</p>
              <button type="button" className="btn btn--chip btn--chip-light" onClick={logout}>
                退出登录
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
