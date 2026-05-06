;(function () {
  const api = () => window.FlowidAdminApi
  const state = () => window.FlowidAdminState

  /**
   * 后端仅持久化 { version, text, updatedAtMs }（POST /admin/user-agreement/save）。
   * 正文为 Markdown，固定两节：## 服务条款、## 版权声明（与 GET /user-agreement 对齐）。
   * 无分节标记的旧数据整段载入「服务条款」。
   */
  const T = {
    service: '服务条款',
    copyright: '版权声明',
  }

  const DEFAULTS = {
    serviceTerms:
      '健康检查、隐私政策、数据使用等相关条款。\n\n请在此编辑服务条款正文；保存后将同步至客户端拉取的协议全文。',
    copyright: '版权所有 © 本公司。保留所有权利。',
  }

  function defaultModel() {
    return { serviceTerms: DEFAULTS.serviceTerms, copyright: DEFAULTS.copyright }
  }

  function parseH2Sections(text) {
    const t = String(text || '')
    const re = /^## (.+)$/gm
    const hits = []
    let m
    while ((m = re.exec(t)) !== null) {
      hits.push({ title: m[1].trim(), headEnd: m.index + m[0].length, headStart: m.index })
    }
    const map = {}
    for (let i = 0; i < hits.length; i++) {
      const bodyStart = hits[i].headEnd
      const bodyEnd = i + 1 < hits.length ? hits[i + 1].headStart : t.length
      map[hits[i].title] = t.slice(bodyStart, bodyEnd).trim()
    }
    return map
  }

  function modelFromText(fullText) {
    const raw = String(fullText || '').trim()
    if (!raw) return { ...defaultModel(), _legacy: false }
    const sec = parseH2Sections(raw)
    const hasService = Object.prototype.hasOwnProperty.call(sec, T.service)
    const hasCopy = Object.prototype.hasOwnProperty.call(sec, T.copyright)
    if (hasService && hasCopy) {
      return {
        serviceTerms: sec[T.service] || DEFAULTS.serviceTerms,
        copyright: sec[T.copyright] || DEFAULTS.copyright,
        _legacy: false,
      }
    }
    if (hasService) {
      return {
        serviceTerms: sec[T.service] || DEFAULTS.serviceTerms,
        copyright: DEFAULTS.copyright,
        _legacy: true,
      }
    }
    return { serviceTerms: raw, copyright: DEFAULTS.copyright, _legacy: true }
  }

  function serializeModel(m) {
    return (
      `## ${T.service}\n\n${String(m.serviceTerms || '').trim()}\n\n` +
      `## ${T.copyright}\n\n${String(m.copyright || '').trim()}\n`
    )
  }

  window.FlowidAdminPanelUserAgreement = async function (mount) {
    const root = document.createElement('div')
    root.className = 'uagr-page'
    root.innerHTML = `
<header class="uagr-crumb">
  <span class="uagr-crumb__main">用户协议</span>
  <span class="uagr-crumb__sep">/</span>
  <span class="uagr-crumb__sub">编辑正文与版本号；客户端从 <code class="uagr-code">/user-agreement</code> 同步</span>
</header>
<p class="uagr-banner hint">
  保存写入 <span class="mono">server/user-agreement.json</span>；公开接口 <span class="mono">GET /admin/user-agreement</span>（管理）与 <span class="mono">GET /user-agreement</span>（客户端）。
  仅保留「服务条款」「版权声明」两节（Markdown <span class="mono">##</span> 标题固定）。旧版多节或单一正文：无 <span class="mono">##</span> 时全文进入「服务条款」；仅有「服务条款」节时「版权声明」用默认占位直至您填写并保存。
</p>

<div class="uagr-top-meta">
  <label class="uagr-field uagr-field--version">
    <span class="uagr-field__lab">版本号（version）</span>
    <input id="uagr-version" class="uagr-input uagr-input--mono" type="text" placeholder="例如 2026-04 或 rev-时间戳" autocomplete="off" />
  </label>
  <label class="uagr-bump">
    <input id="uagr-bump" type="checkbox" />
    <span>强制刷新版本号（即使正文未改）</span>
  </label>
</div>
<p id="uagr-msg" class="uagr-msg"></p>

<div class="uagr-cards" id="uagr-cards">
  <article class="uagr-card" data-card="service">
    <h3 class="uagr-card__title">${T.service}</h3>
    <textarea id="uagr-service" class="uagr-textarea" rows="14" spellcheck="false"></textarea>
  </article>
  <article class="uagr-card" data-card="copyright">
    <h3 class="uagr-card__title">${T.copyright}</h3>
    <textarea id="uagr-copy" class="uagr-textarea" rows="8" spellcheck="false"></textarea>
  </article>
</div>

<div id="uagr-loading" class="uagr-loading" hidden aria-live="polite">加载中…</div>

<footer class="uagr-footer">
  <div class="uagr-footer__actions">
    <button type="button" class="btn btn-primary" id="uagr-save">保存协议</button>
    <button type="button" class="btn" id="uagr-reload">重新加载</button>
  </div>
  <div class="uagr-footer__token">
    <label class="uagr-field uagr-field--token">
      <span class="uagr-field__lab">管理员口令（<code class="uagr-code">x-admin-token</code>）</span>
      <span class="uagr-field__sub">开发环境可留空；生产请务必填写。与侧栏输入联动。</span>
      <input id="uagr-ft-token" class="uagr-input uagr-input--mono" type="password" autocomplete="off" placeholder="粘贴管理员口令" />
    </label>
    <button type="button" class="btn btn-primary" id="uagr-ft-save">保存口令</button>
  </div>
</footer>`
    mount.appendChild(root)

    const q = (sel) => root.querySelector(sel)
    const elMsg = q('#uagr-msg')
    const elLoad = q('#uagr-loading')
    const elVersion = q('#uagr-version')
    const elBump = q('#uagr-bump')
    const sideTok = document.querySelector('#admin-token-input')

    let model = defaultModel()

    function setMsg(t, isErr) {
      if (!elMsg) return
      elMsg.textContent = String(t || '')
      elMsg.classList.toggle('uagr-msg--err', Boolean(isErr))
    }

    function setLoading(on) {
      if (elLoad) elLoad.hidden = !on
      root.classList.toggle('is-loading', Boolean(on))
      const dis = Boolean(on)
      root.querySelectorAll('button, input, textarea').forEach((n) => {
        n.disabled = dis
      })
    }

    function readDomToModel() {
      return {
        serviceTerms: q('#uagr-service').value,
        copyright: q('#uagr-copy').value,
      }
    }

    function applyModelToDom(m) {
      q('#uagr-service').value = m.serviceTerms || ''
      q('#uagr-copy').value = m.copyright || ''
    }

    function syncTokenInputs() {
      const v = state().getAdminToken()
      const ft = q('#uagr-ft-token')
      if (ft) ft.value = v
      if (sideTok) sideTok.value = v
    }

    q('#uagr-ft-save').addEventListener('click', () => {
      const v = String(q('#uagr-ft-token').value || '').trim()
      state().setAdminToken(v)
      if (sideTok) sideTok.value = v
      window.FlowidAdminToast('管理员口令已写入本机 localStorage')
    })

    async function load() {
      setLoading(true)
      setMsg('加载中…')
      try {
        const json = await api().get('/admin/user-agreement')
        elVersion.value = String(json?.version || '')
        model = modelFromText(json?.text || '')
        applyModelToDom(model)
        let msg = `已加载（updatedAtMs=${json?.updatedAtMs || 0}）。`
        if (model._legacy) msg += ' 已从旧版格式解析；保存后将重写为「服务条款 + 版权声明」两节。'
        setMsg(msg, Boolean(model._legacy))
        syncTokenInputs()
      } catch (e) {
        const err = String(e.message || e)
        try {
          const res = await fetch(`${window.location.origin}/user-agreement`, { method: 'GET' })
          if (res.ok) {
            const json = await res.json()
            elVersion.value = String(json?.version || '')
            model = modelFromText(json?.text || '')
            applyModelToDom(model)
            let pubMsg = `管理员接口不可用（${err}），已改用公开 GET /user-agreement。保存需配置 x-admin-token 后重试。`
            if (model._legacy) pubMsg += ' 旧版正文已解析；保存后将统一为两节。'
            setMsg(pubMsg, true)
            syncTokenInputs()
            return
          }
        } catch {
          // ignore
        }
        setMsg(`加载失败：${err}`, true)
      } finally {
        setLoading(false)
      }
    }

    q('#uagr-reload').addEventListener('click', () => void load())

    q('#uagr-save').addEventListener('click', async () => {
      model = readDomToModel()
      const text = serializeModel(model)
      if (!String(text).trim()) {
        setMsg('合并后的协议正文不能为空。', true)
        return
      }
      const version = String(elVersion.value || '').trim()
      const bumpVersion = Boolean(elBump.checked)
      setLoading(true)
      setMsg('保存中…')
      try {
        const json = await api().post('/admin/user-agreement/save', { text, version, bumpVersion })
        elVersion.value = String(json?.version || '')
        model = modelFromText(json?.text || '')
        applyModelToDom(model)
        setMsg(`已保存（version=${json?.version}, updatedAtMs=${json?.updatedAtMs}）。`)
        window.FlowidAdminToast('用户协议已保存，客户端下次拉取将看到新版本')
        elBump.checked = false
      } catch (e) {
        setMsg(`保存失败：${String(e.message || e)}`, true)
      } finally {
        setLoading(false)
      }
    })

    syncTokenInputs()
    await load()
  }
})()
