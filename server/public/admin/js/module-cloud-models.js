;(function () {
  const api = () => window.FlowidAdminApi
  const util = () => window.FlowidAdminUtil

  function esc(s) {
    return util().escapeHtml(String(s || ''))
  }

  function normalizeTier(v) {
    return String(v || '').trim()
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
      // 兼容：models 既可以是 string[]，也可以是 {name,nodeKind}[]
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
      // baseUrl 以最后一次为准
      if (baseUrl) p.baseUrl = baseUrl
      p.label = pid
      const modelName = String(e.model || '').trim()
      if (!modelName) continue
      // 保存结构：{name,nodeKind}，方便以后扩展；旧接口仍兼容（前端只读 string 也行）
      p.models.push({ name: modelName, nodeKind: String(e.nodeKind || '').trim() })
    }
    return Array.from(map.values())
  }

  window.FlowidAdminPanelCloudModels = async function (mount) {
    const root = document.createElement('div')
    root.className = 'admin-card'
    root.innerHTML = `
      <div class="admin-card__bd">
        <h3>辅助模式配置</h3>
        <p id="cm-msg" class="hint"></p>
        <h3 style="margin-top:18px;">配置列表</h3>
        <div class="admin-resource-grid">
          <div class="admin-form-block">
            <label><span>编辑区（图二风格）</span></label>
            <div class="admin-card" style="padding:14px;">
              <div class="admin-resource-grid">
                <label>
                  <span>匹配节点</span>
                  <select id="cm-nodeKind"></select>
                </label>
                <label>
                  <span>分类（Provider）</span>
                  <input id="cm-providerId" placeholder="openai / gemini / doubao ..." />
                </label>
              </div>
              <div class="admin-resource-grid" style="margin-top:10px;">
                <label>
                  <span>模型名称</span>
                  <input id="cm-model" class="mono" placeholder="gpt-5.1 / gpt-image-2 ..." />
                </label>
                <label>
                  <span>API 地址（baseUrl）</span>
                  <input id="cm-baseUrl" class="mono" placeholder="https://your-proxy.example.com" />
                </label>
              </div>
              <div class="admin-form-actions" style="justify-content:flex-start; margin-top:12px;">
                <button id="cm-entry-save" class="btn btn-primary" type="button">保存</button>
                <button id="cm-entry-test" class="btn" type="button">测试</button>
                <button id="cm-new-entry" class="btn" type="button">新增</button>
                <button id="cm-entry-close" class="btn" type="button">关闭</button>
                <span id="cm-entry-msg" class="hint" style="margin-left:8px;"></span>
              </div>
            </div>
          </div>
          <div class="admin-form-block">
            <label><span>列表（点一条进入编辑）</span></label>
            <div id="cm-entries" class="admin-list" style="margin-top:10px;"></div>
          </div>
        </div>
      </div>
    `
    mount.appendChild(root)

    const elMsg = root.querySelector('#cm-msg')
    const elEntries = root.querySelector('#cm-entries')
    const btnNewEntry = root.querySelector('#cm-new-entry')

    const elNodeKind = root.querySelector('#cm-nodeKind')
    const elProviderId = root.querySelector('#cm-providerId')
    const elModel = root.querySelector('#cm-model')
    const elBaseUrl = root.querySelector('#cm-baseUrl')
    const btnEntrySave = root.querySelector('#cm-entry-save')
    const btnEntryTest = root.querySelector('#cm-entry-test')
    const btnEntryClose = root.querySelector('#cm-entry-close')
    const elEntryMsg = root.querySelector('#cm-entry-msg')

    let entries = []
    let editingId = ''

    function setMsg(t, isErr) {
      if (!elMsg) return
      elMsg.textContent = String(t || '')
      elMsg.style.color = isErr ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.35)'
    }

    function setEntryMsg(text, isErr) {
      if (!elEntryMsg) return
      elEntryMsg.textContent = String(text || '')
      elEntryMsg.style.color = isErr ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.35)'
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

    function clearEditor() {
      editingId = ''
      if (elNodeKind) elNodeKind.value = ''
      if (elProviderId) elProviderId.value = ''
      if (elModel) elModel.value = ''
      if (elBaseUrl) elBaseUrl.value = ''
      setEntryMsg('')
    }

    function openEditor(entry) {
      editingId = String(entry?.id || '')
      if (elNodeKind) elNodeKind.value = String(entry?.nodeKind || '')
      if (elProviderId) elProviderId.value = String(entry?.providerId || '')
      if (elModel) elModel.value = String(entry?.model || '')
      if (elBaseUrl) elBaseUrl.value = String(entry?.baseUrl || '')
      setEntryMsg('')
    }

    function renderEntries() {
      if (!elEntries) return
      elEntries.innerHTML = ''
      if (!entries.length) {
        elEntries.innerHTML = `<div class="admin-card"><p class="hint">暂无配置。点击「新增」添加一条。</p></div>`
        return
      }
      for (const e of entries) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'admin-list-item'
        const nk = String(e.nodeKind || '').trim()
        const nkLabel =
          NODE_KIND_OPTIONS.find((x) => x.id === nk)?.label || (nk ? nk : '通用')
        item.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div style="min-width:0;">
              <div class="mono" style="font-size:12px; color: var(--text-soft);">${esc(e.baseUrl)}</div>
              <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                <span class="pill">${esc(e.providerId)}</span>
                <span class="pill">${esc(nkLabel)}</span>
                <span class="mono" style="color: var(--text-strong); font-size:12px;">${esc(e.model)}</span>
              </div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0;">
              <span class="pill" style="border-color: rgba(239,68,68,0.25); color:#fecaca;" data-act="del">删除</span>
            </div>
          </div>
        `
        item.addEventListener('click', (ev) => {
          const t = ev.target
          const act = t && t.getAttribute ? t.getAttribute('data-act') : ''
          if (act === 'del') {
            ev.preventDefault()
            ev.stopPropagation()
            if (!util().confirmDanger('确定删除该条配置？')) return
            entries = entries.filter((x) => x.id !== e.id)
            if (editingId === e.id) clearEditor()
            renderEntries()
            void saveToServer()
            return
          }
          openEditor(e)
        })
        elEntries.appendChild(item)
      }
    }

    async function loadFromServer() {
      setMsg('加载中…')
      try {
        const json = await api().get('/admin/cloud-models')
        entries = flattenConfigToEntries(json || {})
        setMsg('已加载。')
      } catch (e) {
        setMsg(`加载失败：${String(e.message || e)}`, true)
        entries = []
      } finally {
        renderEntries()
      }
    }

    async function saveToServer() {
      const payload = {
        providers: buildProvidersFromEntries(entries),
      }
      setMsg('保存中…')
      try {
        await api().post('/admin/cloud-models/save', payload)
        setMsg('已保存到服务器。')
        window.FlowidAdminToast('云端模型（辅助模式）配置已保存')
      } catch (e) {
        setMsg(`保存失败：${String(e.message || e)}`, true)
        throw e
      } finally {
      }
    }

    if (btnNewEntry)
      btnNewEntry.addEventListener('click', () => {
        const e = { id: safeId(), nodeKind: '', providerId: 'openai', model: '', baseUrl: '' }
        entries.unshift(e)
        renderEntries()
        openEditor(e)
      })

    if (btnEntryClose)
      btnEntryClose.addEventListener('click', () => {
        clearEditor()
      })
    if (btnEntrySave)
      btnEntrySave.addEventListener('click', () => {
        const nodeKind = String(elNodeKind?.value || '').trim()
        const providerId = String(elProviderId?.value || '').trim() || 'openai'
        const model = String(elModel?.value || '').trim()
        const baseUrl = String(elBaseUrl?.value || '').trim()
        if (!model || !baseUrl) {
          setEntryMsg('请填写 baseUrl 与模型名。', true)
          return
        }
        if (!editingId) {
          // 如果未打开编辑，保存成新条
          const e = { id: safeId(), nodeKind, providerId, model, baseUrl }
          entries.unshift(e)
          renderEntries()
          openEditor(e)
          setEntryMsg('已保存到列表，正在写入服务器…')
          void saveToServer().then(
            () => setEntryMsg('已保存到服务器。'),
            (err) => setEntryMsg(`保存失败：${String(err?.message || err)}`, true),
          )
          return
        }
        entries = entries.map((x) =>
          x.id === editingId ? { ...x, nodeKind, providerId, model, baseUrl } : x,
        )
        renderEntries()
        setEntryMsg('已保存到列表，正在写入服务器…')
        void saveToServer().then(
          () => setEntryMsg('已保存到服务器。'),
          (err) => setEntryMsg(`保存失败：${String(err?.message || err)}`, true),
        )
      })

    if (btnEntryTest)
      btnEntryTest.addEventListener('click', async () => {
        const baseUrl = String(elBaseUrl?.value || '').trim().replace(/\/+$/, '')
        // 这里无法用用户 token 测试；管理员侧只校验 baseUrl 是否能访问 /v1/models（若无需鉴权）
        if (!baseUrl) return setEntryMsg('请先填写 baseUrl。', true)
        setEntryMsg('测试中…')
        try {
          const res = await fetch(`${baseUrl}/v1/models`, {
            method: 'GET',
          })
          if (!res.ok) {
            setEntryMsg(`测试失败：HTTP ${res.status}`, true)
            return
          }
          setEntryMsg('测试成功：可访问 /v1/models')
        } catch (e) {
          setEntryMsg(`测试失败：${String(e.message || e)}`, true)
        }
      })

    fillNodeKindOptions()
    await loadFromServer()
  }
})()

