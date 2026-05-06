;(function () {
  const api = () => window.FlowidAdminApi
  const util = () => window.FlowidAdminUtil

  function esc(s) {
    return util().escapeHtml(String(s || ''))
  }

  function safeId() {
    try {
      return crypto.randomUUID()
    } catch {
      return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    }
  }

  const NODE_KIND_OPTIONS = [
    { id: '', label: '通用（不限定节点）' },
    { id: 'text', label: '文本' },
    { id: 'script', label: '脚本' },
    { id: 'image', label: '图片' },
    { id: 'video', label: '视频' },
    { id: 'audio', label: '配音' },
    { id: 'music', label: '音乐' },
    { id: 'panorama', label: 'VR360' },
  ]

  function flattenConfigToEntries(cfg) {
    const providers = Array.isArray(cfg?.providers) ? cfg.providers : []
    const out = []
    for (const p of providers) {
      const pid = String(p?.id || p?.provider || '').trim() || 'openai'
      const baseUrl = String(p?.baseUrl || '').trim()
      const models = Array.isArray(p?.models) ? p.models : []
      for (const m of models) {
        if (typeof m === 'string') {
          if (String(m).trim() === '[object Object]') continue
          out.push({
            id: safeId(),
            nodeKind: '',
            providerId: pid,
            model: m,
            baseUrl,
          })
        } else if (m && typeof m === 'object') {
          const name = String(m?.name || m?.model || '').trim()
          if (!name || name === '[object Object]') continue
          out.push({
            id: safeId(),
            nodeKind: String(m?.nodeKind || '').trim(),
            providerId: pid,
            model: name,
            baseUrl: String(m?.baseUrl || baseUrl || '').trim(),
          })
        }
      }
    }
    return out
  }

  function buildProvidersFromEntries(entries) {
    const map = new Map()
    for (const e of entries) {
      const pid = String(e.providerId || '').trim() || 'openai'
      const baseUrl = String(e.baseUrl || '').trim()
      if (!map.has(pid)) {
        map.set(pid, { id: pid, label: pid, baseUrl, models: [] })
      }
      const p = map.get(pid)
      if (baseUrl) p.baseUrl = baseUrl
      p.label = pid
      const modelName = String(e.model || '').trim()
      if (!modelName) continue
      p.models.push({ name: modelName, nodeKind: String(e.nodeKind || '').trim() })
    }
    return Array.from(map.values())
  }

  window.FlowidAdminPanelCloudModels = async function (mount) {
    const root = document.createElement('div')
    root.className = 'cm-page'
    root.innerHTML = `
      <p class="hint">服务地址、健康检查、环境变量与代理说明请在左侧「FlowID Auth 控制台」查看；管理员口令在侧栏底部填写。本页仅维护辅助模式的 Token、Provider 与 API 路由。</p>

      <article class="cm-card cm-card--wide cm-card--accent" id="cm-config-card">
          <span class="cm-card__k">辅助模式</span>
          <h3 class="cm-card__title">云端模型（辅助模式）</h3>
          <p class="cm-card__desc">维护全局 Token、代理 baseUrl 与模型列表，供用户端「辅助模式」拉取；公开接口 <code class="cm-code">GET /cloud-models</code> 不会返回 Token。</p>

          <div class="cm-field">
            <div class="cm-field__hd">
              <label for="cm-token">全局 Token</label>
              <button type="button" class="btn btn--icon cm-token-eye" id="cm-token-reveal" title="显示 / 隐藏">👁</button>
            </div>
            <input id="cm-token" class="cm-input cm-input--mono" type="password" autocomplete="off" placeholder="可选；部分代理在服务端使用" />
          </div>

          <div class="cm-field-grid">
            <label class="cm-field">
              <span>匹配节点</span>
              <select id="cm-nodeKind" class="cm-input"></select>
            </label>
            <label class="cm-field">
              <span>分类（Provider）</span>
              <input id="cm-providerId" class="cm-input cm-input--mono" placeholder="openai / gemini / doubao …" />
            </label>
            <label class="cm-field cm-field--full">
              <span>API 地址（baseUrl）</span>
              <div class="admin-sensitive-row">
                <input id="cm-baseUrl" class="cm-input cm-input--mono" type="password" autocomplete="off" placeholder="https://your-proxy.example.com/v1" />
                <button type="button" class="btn" id="cm-baseUrl-reveal">显示</button>
              </div>
            </label>
            <label class="cm-field cm-field--full">
              <span>当前模型名（单条）</span>
              <input id="cm-model" class="cm-input cm-input--mono" placeholder="gpt-5.1 / gpt-image-2 …" />
            </label>
          </div>

          <div class="cm-field cm-field--full">
            <span>同 Provider + baseUrl 下的模型（标签）</span>
            <div id="cm-chip-wrap" class="cm-chip-wrap" aria-live="polite"></div>
            <div class="cm-chip-add">
              <input id="cm-chip-input" class="cm-input cm-input--mono" type="text" placeholder="输入模型名后回车添加" />
            </div>
          </div>

          <p id="cm-entry-msg" class="cm-entry-msg"></p>
      </article>

      <button type="button" class="cm-card cm-card--link cm-card--wide" data-cm-go="cloud-comfyui">
        <span class="cm-card__k">Comfy</span>
        <span class="cm-card__title">云端 ComfyUI 工作流（官方）</span>
        <span class="cm-card__desc">
          官方工作流 JSON 与列表维护；公开 <code class="cm-code">GET /cloud-workflows</code>。已从本页拆出，请在侧栏进入独立页面。
        </span>
        <span class="cm-card__cta">打开 ComfyUI 管理 →</span>
      </button>

      <article class="cm-card cm-card--wide">
        <span class="cm-card__k">路由</span>
        <h3 class="cm-card__title">API 地址配置</h3>
        <p class="cm-card__desc">每条对应「Provider + baseUrl + 模型」；点击行载入上方表单，删除前会二次确认。</p>
        <div class="cm-table-wrap">
          <table class="cm-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>模型</th>
                <th>节点</th>
                <th>baseUrl</th>
                <th class="cm-th-actions"></th>
              </tr>
            </thead>
            <tbody id="cm-api-tbody"></tbody>
          </table>
        </div>
      </article>

      <p id="cm-msg" class="cm-msg"></p>

      <footer class="cm-footer">
        <div class="cm-footer__inner">
          <button type="button" class="btn cm-btn-primary" id="cm-f-save">保存全部</button>
          <button type="button" class="btn" id="cm-f-test">测试连接</button>
          <button type="button" class="btn" id="cm-f-new">新增条目</button>
          <button type="button" class="btn" id="cm-f-close">关闭编辑</button>
        </div>
      </footer>
    `
    mount.appendChild(root)

    const elMsg = root.querySelector('#cm-msg')
    const elEntryMsg = root.querySelector('#cm-entry-msg')
    const elTbody = root.querySelector('#cm-api-tbody')
    const elChipWrap = root.querySelector('#cm-chip-wrap')
    const elChipInput = root.querySelector('#cm-chip-input')
    const elNodeKind = root.querySelector('#cm-nodeKind')
    const elProviderId = root.querySelector('#cm-providerId')
    const elModel = root.querySelector('#cm-model')
    const elBaseUrl = root.querySelector('#cm-baseUrl')
    const elToken = root.querySelector('#cm-token')
    const btnTokenReveal = root.querySelector('#cm-token-reveal')
    const btnBaseUrlReveal = root.querySelector('#cm-baseUrl-reveal')
    const btnFooterSave = root.querySelector('#cm-f-save')
    const btnFooterTest = root.querySelector('#cm-f-test')
    const btnFooterNew = root.querySelector('#cm-f-new')
    const btnFooterClose = root.querySelector('#cm-f-close')

    let entries = []
    let editingId = ''

    function setMsg(t, isErr) {
      if (!elMsg) return
      elMsg.textContent = String(t || '')
      elMsg.classList.toggle('cm-msg--err', Boolean(isErr))
    }

    function setEntryMsg(text, isErr) {
      if (!elEntryMsg) return
      elEntryMsg.textContent = String(text || '')
      elEntryMsg.classList.toggle('cm-entry-msg--err', Boolean(isErr))
    }

    function fillNodeKindOptions() {
      if (!elNodeKind) return
      elNodeKind.innerHTML = ''
      for (const opt of NODE_KIND_OPTIONS) {
        const o = document.createElement('option')
        o.value = opt.id
        o.textContent = opt.label
        elNodeKind.appendChild(o)
      }
    }

    function syncBaseUrlRevealUi() {
      if (!elBaseUrl || !btnBaseUrlReveal) return
      btnBaseUrlReveal.textContent = elBaseUrl.type === 'password' ? '显示' : '隐藏'
    }

    function syncTokenRevealUi() {
      if (!elToken || !btnTokenReveal) return
      btnTokenReveal.setAttribute('aria-label', elToken.type === 'password' ? '显示 Token' : '隐藏 Token')
    }

    function clearEditor() {
      editingId = ''
      if (elNodeKind) elNodeKind.value = ''
      if (elProviderId) elProviderId.value = ''
      if (elModel) elModel.value = ''
      if (elBaseUrl) {
        elBaseUrl.value = ''
        elBaseUrl.type = 'password'
      }
      syncBaseUrlRevealUi()
      setEntryMsg('')
      renderChips()
      renderApiTable()
    }

    function openEditor(entry) {
      editingId = String(entry?.id || '')
      if (elNodeKind) elNodeKind.value = String(entry?.nodeKind || '')
      if (elProviderId) elProviderId.value = String(entry?.providerId || '')
      if (elModel) elModel.value = String(entry?.model || '')
      if (elBaseUrl) {
        elBaseUrl.value = String(entry?.baseUrl || '')
        elBaseUrl.type = 'password'
      }
      syncBaseUrlRevealUi()
      setEntryMsg('')
      renderChips()
      renderApiTable()
      root.querySelector('#cm-config-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }

    function groupKey() {
      const pid = String(elProviderId?.value || '').trim() || 'openai'
      const bu = String(elBaseUrl?.value || '').trim()
      return { pid, bu }
    }

    function renderChips() {
      if (!elChipWrap) return
      const { pid, bu } = groupKey()
      if (!bu) {
        elChipWrap.innerHTML = '<span class="cm-chip-hint">请先填写 baseUrl</span>'
        return
      }
      const group = entries.filter((e) => (String(e.providerId || '').trim() || 'openai') === pid && String(e.baseUrl || '').trim() === bu)
      if (!group.length) {
        elChipWrap.innerHTML = '<span class="cm-chip-hint">该组合下暂无模型，可在下方输入模型名添加</span>'
        return
      }
      elChipWrap.innerHTML = group
        .map((e) => {
          const active = e.id === editingId ? ' cm-chip--active' : ''
          return `<span class="cm-chip${active}">${esc(e.model)}<button type="button" class="cm-chip-x" data-chip-id="${esc(
            e.id,
          )}" title="删除">×</button></span>`
        })
        .join('')
    }

    function renderApiTable() {
      if (!elTbody) return
      elTbody.innerHTML = ''
      if (!entries.length) {
        elTbody.innerHTML = '<tr><td colspan="5" class="cm-table__empty">暂无配置，点击底部「新增条目」开始。</td></tr>'
        return
      }
      for (const e of entries) {
        const nk = String(e.nodeKind || '').trim()
        const nkLabel = NODE_KIND_OPTIONS.find((x) => x.id === nk)?.label || (nk || '通用')
        const tr = document.createElement('tr')
        tr.className = 'cm-tr' + (e.id === editingId ? ' is-active' : '')
        tr.innerHTML = `
          <td class="mono">${esc(e.providerId)}</td>
          <td class="mono">${esc(e.model)}</td>
          <td>${esc(nkLabel)}</td>
          <td class="mono cm-td-url" title="${esc(e.baseUrl)}">${esc(e.baseUrl)}</td>
          <td class="cm-td-actions">
            <button type="button" class="btn btn--sm btn-danger cm-row-del" data-id="${esc(e.id)}">删除</button>
          </td>`
        tr.addEventListener('click', (ev) => {
          const el = ev.target instanceof Element ? ev.target : null
          if (el && el.closest('.cm-row-del')) return
          openEditor(e)
        })
        tr.querySelector('.cm-row-del')?.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (!util().confirmDanger('确定删除该条 API / 模型配置？')) return
          entries = entries.filter((x) => x.id !== e.id)
          if (editingId === e.id) clearEditor()
          else {
            renderApiTable()
            renderChips()
          }
          void saveToServerQuiet()
        })
        elTbody.appendChild(tr)
      }
    }

    function mergeEditorIntoEntries() {
      const nodeKind = String(elNodeKind?.value || '').trim()
      const providerId = String(elProviderId?.value || '').trim() || 'openai'
      const model = String(elModel?.value || '').trim()
      const baseUrl = String(elBaseUrl?.value || '').trim()
      if (!editingId) return true
      if (!model || !baseUrl) {
        setEntryMsg('请填写模型名与 baseUrl，或点击「关闭编辑」。', true)
        return false
      }
      entries = entries.map((x) =>
        x.id === editingId ? { ...x, nodeKind, providerId, model, baseUrl } : x,
      )
      return true
    }

    function canSaveWithEditor() {
      if (!editingId) return true
      const model = String(elModel?.value || '').trim()
      const baseUrl = String(elBaseUrl?.value || '').trim()
      if (model && baseUrl) return mergeEditorIntoEntries()
      setEntryMsg('当前有未完成的编辑：请补全「模型名」与 baseUrl，或点「关闭编辑」后再保存。', true)
      return false
    }

    async function saveToServer() {
      if (!canSaveWithEditor()) return
      const payload = {
        token: String(elToken?.value ?? ''),
        providers: buildProvidersFromEntries(entries),
      }
      setMsg('保存中…', false)
      try {
        await api().post('/admin/cloud-models/save', payload)
        setMsg('已保存到服务器。')
        window.FlowidAdminToast('云端模型配置已保存')
        renderApiTable()
        renderChips()
      } catch (e) {
        setMsg(`保存失败：${String(e.message || e)}`, true)
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    async function saveToServerQuiet() {
      const payload = {
        token: String(elToken?.value ?? ''),
        providers: buildProvidersFromEntries(entries),
      }
      try {
        await api().post('/admin/cloud-models/save', payload)
        window.FlowidAdminToast('已保存')
        renderApiTable()
        renderChips()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    async function loadFromServer() {
      setMsg('加载中…', false)
      try {
        const json = await api().get('/admin/cloud-models')
        if (elToken) {
          elToken.value = String(json?.token || '')
          elToken.type = 'password'
        }
        syncTokenRevealUi()
        entries = flattenConfigToEntries({ providers: json?.providers || [] })
        setMsg(`已加载 · ${entries.length} 条模型路由`)
        renderApiTable()
        renderChips()
      } catch (e) {
        setMsg(`加载失败：${String(e.message || e)}`, true)
        entries = []
        renderApiTable()
        renderChips()
      }
    }

    root.querySelectorAll('[data-cm-go]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-cm-go')
        if (window.FlowidAdminNavigate) window.FlowidAdminNavigate(id)
      })
    })

    elChipWrap?.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-chip-id]')
      if (!btn) return
      const id = btn.getAttribute('data-chip-id')
      if (!id || !util().confirmDanger('从列表中移除该模型条目？')) return
      entries = entries.filter((x) => x.id !== id)
      if (editingId === id) clearEditor()
      renderApiTable()
      renderChips()
      void saveToServerQuiet()
    })

    elChipInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      const model = String(elChipInput.value || '').trim()
      const baseUrl = String(elBaseUrl?.value || '').trim()
      const providerId = String(elProviderId?.value || '').trim() || 'openai'
      const nodeKind = String(elNodeKind?.value || '').trim()
      if (!model || !baseUrl) {
        setEntryMsg('请先填写 baseUrl 与模型名（主输入框可填当前编辑模型）。', true)
        return
      }
      if (entries.some((x) => x.model === model && x.baseUrl === baseUrl && (x.providerId || 'openai') === providerId)) {
        setEntryMsg('该模型已存在于当前组合。', true)
        return
      }
      entries.push({ id: safeId(), nodeKind, providerId, model, baseUrl })
      elChipInput.value = ''
      setEntryMsg('已添加模型条目。')
      renderApiTable()
      renderChips()
    })

    ;['input', 'change'].forEach((ev) => {
      elProviderId?.addEventListener(ev, () => renderChips())
      elBaseUrl?.addEventListener(ev, () => renderChips())
    })

    btnTokenReveal?.addEventListener('click', () => {
      if (!elToken) return
      elToken.type = elToken.type === 'password' ? 'text' : 'password'
      syncTokenRevealUi()
    })

    btnBaseUrlReveal?.addEventListener('click', () => {
      if (!elBaseUrl) return
      elBaseUrl.type = elBaseUrl.type === 'password' ? 'text' : 'password'
      syncBaseUrlRevealUi()
    })

    btnFooterSave?.addEventListener('click', () => void saveToServer())

    btnFooterTest?.addEventListener('click', async () => {
      if (!canSaveWithEditor()) return
      const baseUrl = String(elBaseUrl?.value || '').trim().replace(/\/+$/, '')
      if (!baseUrl) return setEntryMsg('请先填写 baseUrl。', true)
      setEntryMsg('测试中…', false)
      try {
        const res = await fetch(`${baseUrl}/v1/models`, { method: 'GET' })
        if (!res.ok) {
          setEntryMsg(`测试失败：HTTP ${res.status}`, true)
          return
        }
        setEntryMsg('测试成功：可访问 /v1/models')
      } catch (e) {
        setEntryMsg(`测试失败：${String(e.message || e)}`, true)
      }
    })

    btnFooterNew?.addEventListener('click', () => {
      if (!canSaveWithEditor()) return
      const e = { id: safeId(), nodeKind: '', providerId: 'openai', model: '', baseUrl: '' }
      entries.unshift(e)
      openEditor(e)
    })

    btnFooterClose?.addEventListener('click', () => {
      clearEditor()
    })

    fillNodeKindOptions()
    syncBaseUrlRevealUi()
    syncTokenRevealUi()
    await loadFromServer()
  }
})()
