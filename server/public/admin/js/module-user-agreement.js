;(function () {
  const api = () => window.FlowidAdminApi
  const util = () => window.FlowidAdminUtil

  window.FlowidAdminPanelUserAgreement = async function (mount) {
    const root = document.createElement('div')
    root.className = 'admin-card'
    root.innerHTML = `
      <div class="admin-card__bd">
        <h3>用户协议</h3>
        <p id="ua-msg" class="hint"></p>
        <p class="hint">保存后写入服务端 <span class="mono">server/user-agreement.json</span>；客户端会从 <span class="mono">GET /user-agreement</span> 拉取并与本地「同意记录」比对，协议更新后会要求用户重新同意。</p>
        <p class="hint">请从 <span class="mono">http://127.0.0.1:3721/admin.html</span>（或你的 auth 服务同源地址）打开本页；更新代码后需<strong>重启 auth-server</strong>，否则会出现 <span class="mono">HTTP 404</span>。</p>
        <div class="admin-form-block" style="margin-top:14px;">
          <label>
            <span>展示版本号（version）</span>
            <input id="ua-version" class="mono" placeholder="例如 2026-04 或 rev-时间戳" />
          </label>
        </div>
        <div class="admin-form-block" style="margin-top:12px;">
          <label>
            <span>协议正文</span>
            <textarea id="ua-text" class="mono tall" style="min-height:420px;"></textarea>
          </label>
        </div>
        <div class="admin-form-actions" style="margin-top:12px;">
          <button id="ua-save" class="btn btn-primary" type="button">保存</button>
          <button id="ua-reload" class="btn" type="button">重新加载</button>
          <label style="display:flex; align-items:center; gap:8px; margin-left:8px;">
            <input id="ua-bump" type="checkbox" />
            <span class="hint" style="margin:0;">强制刷新版本号（即使正文未改）</span>
          </label>
        </div>
      </div>
    `
    mount.appendChild(root)

    const elMsg = root.querySelector('#ua-msg')
    const elVersion = root.querySelector('#ua-version')
    const elText = root.querySelector('#ua-text')
    const elBump = root.querySelector('#ua-bump')
    const btnSave = root.querySelector('#ua-save')
    const btnReload = root.querySelector('#ua-reload')

    function setMsg(t, isErr) {
      if (!elMsg) return
      elMsg.textContent = String(t || '')
      elMsg.style.color = isErr ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.35)'
    }

    async function load() {
      setMsg('加载中…')
      try {
        const json = await api().get('/admin/user-agreement')
        if (elVersion) elVersion.value = String(json?.version || '')
        if (elText) elText.value = String(json?.text || '')
        setMsg(`已加载（updatedAtMs=${json?.updatedAtMs || 0}）。`)
      } catch (e) {
        const err = String(e.message || e)
        try {
          const res = await fetch(`${window.location.origin}/user-agreement`, { method: 'GET' })
          if (res.ok) {
            const json = await res.json()
            if (elVersion) elVersion.value = String(json?.version || '')
            if (elText) elText.value = String(json?.text || '')
            setMsg(
              `管理员接口不可用（${err}），已改用公开接口拉取正文。若需保存，请确认同源为 auth 服务且已重启后再试「重新加载」。`,
              true,
            )
            return
          }
        } catch {
          // ignore
        }
        setMsg(`加载失败：${err}（当前页面来源：${window.location.origin}）`, true)
      }
    }

    if (btnReload) btnReload.addEventListener('click', () => void load())

    if (btnSave)
      btnSave.addEventListener('click', async () => {
        const text = String(elText?.value || '')
        const version = String(elVersion?.value || '').trim()
        const bumpVersion = Boolean(elBump?.checked)
        if (!String(text).trim()) {
          setMsg('协议正文不能为空。', true)
          return
        }
        setMsg('保存中…')
        try {
          const json = await api().post('/admin/user-agreement/save', { text, version, bumpVersion })
          if (elVersion) elVersion.value = String(json?.version || '')
          setMsg(`已保存（version=${json?.version}, updatedAtMs=${json?.updatedAtMs}）。`)
          window.FlowidAdminToast('用户协议已保存，客户端下次启动将拉取新版本')
          if (elBump) elBump.checked = false
        } catch (e) {
          setMsg(`保存失败：${String(e.message || e)}`, true)
        }
      })

    await load()
  }
})()
