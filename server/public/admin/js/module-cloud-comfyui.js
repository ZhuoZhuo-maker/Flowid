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

  const ASSIST_KINDS = ['text', 'image', 'video', 'audio', 'music']
  const ASSIST_LABEL = { text: '文本', image: '图片', video: '视频', audio: '音频', music: '音乐' }

  window.FlowidAdminPanelCloudComfyui = async function (mount) {
    const root = document.createElement('div')
    root.className = 'cm-page'
    root.innerHTML = `
      <p class="hint" style="margin:0 0 12px">
        官方云端 Comfy 工作流：<code class="cm-code">GET /cloud-workflows</code>；
        云端模型辅助目录：<code class="cm-code">GET /cloud-assist-model-catalog</code>（用户端仅本地存各类型 API Key）。
        <button type="button" class="btn" style="margin-left:10px" id="cc-go-models">← 返回总览</button>
      </p>

      <div class="cc-main-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px">
        <button type="button" class="btn cm-btn-primary cc-tab-main" data-main="comfy">ComfyUI 工作流</button>
        <button type="button" class="btn cc-tab-main" data-main="assist">云端模型配置</button>
      </div>

      <div id="cc-wrap-comfy">
      <article class="cm-card cm-card--wide" id="cc-wf-card">
        <span class="cm-card__k">Comfy</span>
        <h3 class="cm-card__title">ComfyUI 工作流（官方）</h3>
        <p class="cm-card__desc">
          后台维护的官方工作流（用户端仅可选择、不可改参）；公开列表
          <code class="cm-code">GET /cloud-workflows</code>。积分扣费按工作流<strong>显示名</strong>匹配
          <code class="cm-code">workflow:名称_slug</code>（与「积分单价规则」一致）。
        </p>
        <div class="cm-field-grid">
          <label class="cm-field">
            <span>工作流显示名</span>
            <input id="cc-wf-name" class="cm-input" placeholder="例如 官方 WAN 视频" autocomplete="off" />
          </label>
          <label class="cm-field">
            <span>节点类型</span>
            <select id="cc-wf-nodeKind" class="cm-input"></select>
          </label>
        </div>
        <label class="cm-field cm-field--full">
          <span>说明（可选）</span>
          <input id="cc-wf-desc" class="cm-input" placeholder="简介" autocomplete="off" />
        </label>
        <label class="cm-field cm-field--full cm-field--json-drop">
          <span>工作流 JSON（ComfyUI API 格式）<small class="cm-field__hint-sub">可拖拽 .json / 文本文件到框内，或 Ctrl+V 粘贴文件与 JSON 文本</small></span>
          <textarea id="cc-wf-json" class="cm-input" rows="10" style="font-family: ui-monospace, monospace; font-size: 12px" spellcheck="false" placeholder="{ &quot;...&quot;: ... } — 支持拖入文件或粘贴"></textarea>
        </label>
        <p id="cc-wf-msg" class="cm-entry-msg"></p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px">
          <button type="button" class="btn cm-btn-primary" id="cc-wf-add">加入列表</button>
          <button type="button" class="btn" id="cc-wf-clear">清空表单</button>
        </div>
        <div class="cc-wf-toolbar" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:8px">
          <label class="cm-field" style="flex:0 1 200px;min-width:140px;margin:0">
            <span>列表分类</span>
            <select id="cc-wf-filter-kind" class="cm-input" title="按节点类型筛选列表"></select>
          </label>
          <label class="cm-field" style="flex:1 1 220px;min-width:180px;margin:0">
            <span>搜索</span>
            <input id="cc-wf-filter-q" class="cm-input" type="search" placeholder="名称或说明…" autocomplete="off" />
          </label>
        </div>
        <p id="cc-wf-filter-hint" class="cm-entry-msg" style="margin:0 0 10px;font-size:12px;opacity:0.85"></p>
        <div class="cm-table-wrap cm-table-wrap--scroll-y">
          <table class="cm-table">
            <thead>
              <tr>
                <th class="cm-th-num">#</th>
                <th>名称</th>
                <th>节点</th>
                <th class="cm-th-ts">创建</th>
                <th class="cm-th-ts">更新</th>
                <th class="cm-th-actions"></th>
              </tr>
            </thead>
            <tbody id="cc-wf-tbody"></tbody>
          </table>
        </div>
      </article>

      <footer class="cm-footer">
        <div class="cm-footer__inner">
          <button type="button" class="btn cm-btn-primary" id="cc-wf-save">保存官方工作流配置</button>
          <button type="button" class="btn" id="cc-go-models-footer">返回总览</button>
        </div>
      </footer>
      </div>

      <div id="cc-wrap-assist" style="display:none">
        <article class="cm-card cm-card--wide">
          <span class="cm-card__k">API</span>
          <h3 class="cm-card__title">云端模型配置（辅助线路）</h3>
          <p class="cm-card__desc">
            按类型维护「OpenAI 兼容根地址 + 模型 id 列表」；客户端合并进画布「云端模型」下拉，用户仅在设置里填写各类型 API Key（不展示此处 URL）。
            管理接口：<code class="cm-code">GET/POST /admin/cloud-assist-models*</code>
          </p>
          <div class="cc-assist-subtabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px"></div>
          <div id="cc-assist-panels"></div>
          <p id="cc-assist-global-msg" class="cm-entry-msg" style="margin-top:12px"></p>
        </article>
        <footer class="cm-footer">
          <div class="cm-footer__inner">
            <button type="button" class="btn cm-btn-primary" id="cc-assist-save">保存云端模型配置</button>
            <button type="button" class="btn" id="cc-go-models-assist">返回总览</button>
          </div>
        </footer>
      </div>
    `
    mount.appendChild(root)

    const elWfTbody = root.querySelector('#cc-wf-tbody')
    const elWfName = root.querySelector('#cc-wf-name')
    const elWfDesc = root.querySelector('#cc-wf-desc')
    const elWfJson = root.querySelector('#cc-wf-json')
    const elWfNodeKind = root.querySelector('#cc-wf-nodeKind')
    const elWfMsg = root.querySelector('#cc-wf-msg')
    const btnWfAdd = root.querySelector('#cc-wf-add')
    const btnWfClear = root.querySelector('#cc-wf-clear')
    const btnWfSave = root.querySelector('#cc-wf-save')
    const elWfFilterKind = root.querySelector('#cc-wf-filter-kind')
    const elWfFilterQ = root.querySelector('#cc-wf-filter-q')
    const elWfFilterHint = root.querySelector('#cc-wf-filter-hint')
    let wfRows = []

    const wrapComfy = root.querySelector('#cc-wrap-comfy')
    const wrapAssist = root.querySelector('#cc-wrap-assist')
    const tabMainBtns = root.querySelectorAll('.cc-tab-main')
    const elAssistGlobalMsg = root.querySelector('#cc-assist-global-msg')
    const elAssistSubtabs = root.querySelector('.cc-assist-subtabs')
    const elAssistPanels = root.querySelector('#cc-assist-panels')
    let assistMain = 'comfy'
    let assistKind = 'text'
    /** @type {{ kinds: Record<string, Array<{ id: string; baseUrl: string; models: string[] }>> }} */
    let assistData = { kinds: {} }
    for (const k of ASSIST_KINDS) assistData.kinds[k] = []

    function setAssistGlobalMsg(t, isErr) {
      if (!elAssistGlobalMsg) return
      elAssistGlobalMsg.textContent = String(t || '')
      elAssistGlobalMsg.classList.toggle('cm-entry-msg--err', Boolean(isErr))
    }

    function switchMainTab(which) {
      assistMain = which
      for (const b of tabMainBtns) {
        const w = b.getAttribute('data-main')
        const on = w === which
        b.classList.toggle('cm-btn-primary', on)
      }
      if (wrapComfy) wrapComfy.style.display = which === 'comfy' ? '' : 'none'
      if (wrapAssist) wrapAssist.style.display = which === 'assist' ? '' : 'none'
    }
    for (const b of tabMainBtns) {
      b.addEventListener('click', () => switchMainTab(b.getAttribute('data-main') || 'comfy'))
    }
    switchMainTab('comfy')

    function splitModelsText(s) {
      return String(s || '')
        .split(/[\n,，]+/)
        .map((x) => x.trim())
        .filter(Boolean)
    }

    function renderAssistPanels() {
      if (!elAssistPanels || !elAssistSubtabs) return
      elAssistSubtabs.innerHTML = ASSIST_KINDS.map((k) => {
        const on = k === assistKind
        return `<button type="button" class="btn btn--sm ${on ? 'cm-btn-primary' : ''} cc-assist-sub" data-kind="${esc(k)}">${esc(
          ASSIST_LABEL[k] || k,
        )}</button>`
      }).join('')
      elAssistSubtabs.querySelectorAll('.cc-assist-sub').forEach((btn) => {
        btn.addEventListener('click', () => {
          assistKind = btn.getAttribute('data-kind') || 'text'
          renderAssistPanels()
        })
      })

      const rows = assistData.kinds[assistKind] || []
      const tbodyRows =
        rows.length === 0
          ? '<tr><td colspan="3" class="cm-table__empty">暂无线路；填写下方表单后点「加入列表」。</td></tr>'
          : rows
              .map((row) => {
                const ms = (row.models || []).join('、')
                return `<tr><td class="cm-mono" style="max-width:220px;word-break:break-all">${esc(row.baseUrl)}</td><td>${esc(
                  ms,
                )}</td><td class="cm-td-actions"><button type="button" class="btn btn--sm cc-assist-del" data-id="${esc(
                  row.id,
                )}">删除</button></td></tr>`
              })
              .join('')

      elAssistPanels.innerHTML = `
        <div class="cm-field-grid">
          <label class="cm-field cm-field--full">
            <span>OpenAI 兼容 API 根地址（https://…）</span>
            <input id="cc-assist-url" class="cm-input" placeholder="https://api.example.com/v1" autocomplete="off" />
          </label>
        </div>
        <label class="cm-field cm-field--full">
          <span>模型 id（每行一个，或多个用逗号分隔）</span>
          <textarea id="cc-assist-models" class="cm-input" rows="5" spellcheck="false" placeholder="gpt-4o-mini&#10;wan2.1-t2v"></textarea>
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button type="button" class="btn cm-btn-primary" id="cc-assist-add">加入列表</button>
          <button type="button" class="btn" id="cc-assist-clear">清空表单</button>
        </div>
        <div class="cm-table-wrap">
          <table class="cm-table">
            <thead><tr><th>地址</th><th>模型</th><th class="cm-th-actions"></th></tr></thead>
            <tbody id="cc-assist-tbody">${tbodyRows}</tbody>
          </table>
        </div>
      `

      elAssistPanels.querySelector('#cc-assist-add')?.addEventListener('click', () => {
        const urlEl = elAssistPanels.querySelector('#cc-assist-url')
        const modEl = elAssistPanels.querySelector('#cc-assist-models')
        const baseUrl = String(urlEl?.value || '').trim()
        const models = splitModelsText(modEl?.value || '')
        if (!/^https?:\/\//i.test(baseUrl)) {
          setAssistGlobalMsg('请输入以 http(s):// 开头的根地址', true)
          return
        }
        if (!models.length) {
          setAssistGlobalMsg('请至少填写一个模型 id', true)
          return
        }
        assistData.kinds[assistKind].push({ id: safeId(), baseUrl, models })
        setAssistGlobalMsg('已加入当前分类列表（请点击底部「保存云端模型配置」）', false)
        renderAssistPanels()
      })
      elAssistPanels.querySelector('#cc-assist-clear')?.addEventListener('click', () => {
        const urlEl = elAssistPanels.querySelector('#cc-assist-url')
        const modEl = elAssistPanels.querySelector('#cc-assist-models')
        if (urlEl) urlEl.value = ''
        if (modEl) modEl.value = ''
        setAssistGlobalMsg('', false)
      })
      elAssistPanels.querySelectorAll('.cc-assist-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id')
          if (!id || !util().confirmDanger('确定删除该线路？')) return
          assistData.kinds[assistKind] = (assistData.kinds[assistKind] || []).filter((x) => x.id !== id)
          renderAssistPanels()
        })
      })
    }

    async function loadAssistFromServer() {
      setAssistGlobalMsg('加载中…', false)
      try {
        const json = await api().get('/admin/cloud-assist-models')
        const next = { kinds: {} }
        for (const k of ASSIST_KINDS) {
          next.kinds[k] = Array.isArray(json?.kinds?.[k])
            ? json.kinds[k].map((x) => ({
                id: String(x.id || safeId()),
                baseUrl: String(x.baseUrl || ''),
                models: Array.isArray(x.models) ? x.models.map((m) => String(m || '').trim()).filter(Boolean) : [],
              }))
            : []
        }
        assistData = next
        setAssistGlobalMsg('已加载', false)
        renderAssistPanels()
      } catch (e) {
        setAssistGlobalMsg(`加载失败：${String(e.message || e)}`, true)
        renderAssistPanels()
      }
    }

    root.querySelector('#cc-assist-save')?.addEventListener('click', async () => {
      setAssistGlobalMsg('保存中…', false)
      try {
        await api().post('/admin/cloud-assist-models/save', assistData)
        setAssistGlobalMsg('已保存', false)
        window.FlowidAdminToast('云端模型配置已保存')
        await loadAssistFromServer()
      } catch (e) {
        setAssistGlobalMsg(`保存失败：${String(e.message || e)}`, true)
      }
    })

    function fillWfNodeKind() {
      if (!elWfNodeKind) return
      elWfNodeKind.innerHTML = NODE_KIND_OPTIONS.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')
    }

    function fillWfFilterKind() {
      if (!elWfFilterKind) return
      const prev = String(elWfFilterKind.value || '')
      elWfFilterKind.innerHTML =
        `<option value="">${esc('全部分类')}</option>` +
        NODE_KIND_OPTIONS.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')
      if (prev && [...elWfFilterKind.options].some((opt) => opt.value === prev)) elWfFilterKind.value = prev
    }

    function formatWorkflowTs(ms) {
      const n = Number(ms)
      if (!Number.isFinite(n) || n <= 0) return '—'
      try {
        return new Date(n).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
      } catch {
        return '—'
      }
    }

    function getWfFilteredRows() {
      const kind = String(elWfFilterKind?.value || '').trim()
      const q = String(elWfFilterQ?.value || '')
        .trim()
        .toLowerCase()
      let list = wfRows.slice()
      if (kind) list = list.filter((w) => String(w.nodeKind || '').trim() === kind)
      if (q) {
        list = list.filter((w) => {
          const name = String(w.name || '').toLowerCase()
          const desc = String(w.description || '').toLowerCase()
          return name.includes(q) || desc.includes(q)
        })
      }
      list.sort((a, b) => {
        const ua = Number(a.updatedAtMs) || 0
        const ub = Number(b.updatedAtMs) || 0
        if (ub !== ua) return ub - ua
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
      })
      return list
    }

    function setWfMsg(t, isErr) {
      if (!elWfMsg) return
      elWfMsg.textContent = String(t || '')
      elWfMsg.classList.toggle('cm-entry-msg--err', Boolean(isErr))
    }

    function readFileAsUtf8(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => reject(r.error || new Error('读取文件失败'))
        r.readAsText(file, 'UTF-8')
      })
    }

    function applyWorkflowJsonText(text, okHint) {
      const trimmed = String(text || '').trim()
      if (!trimmed) {
        setWfMsg('内容为空', true)
        return
      }
      if (elWfJson) elWfJson.value = trimmed
      setWfMsg(
        typeof okHint === 'string' && okHint.trim() ? okHint.trim() : '已填入编辑区（可继续编辑后「加入列表」）',
        false,
      )
    }

    async function ingestWorkflowFiles(fileList) {
      const arr = Array.from(fileList || []).filter((f) => f && f.size !== undefined)
      if (!arr.length) return
      const byJsonName = arr.find((f) => /\.json$/i.test(String(f.name || '')))
      const file = byJsonName || arr[0]
      try {
        const text = await readFileAsUtf8(file)
        applyWorkflowJsonText(text, `已从「${String(file.name || '文件')}」读入（可「加入列表」后保存）`)
      } catch (e) {
        setWfMsg(`读取文件失败：${String(e.message || e)}`, true)
      }
    }

    function bindWorkflowJsonDropAndPaste() {
      if (!elWfJson) return
      const zone = elWfJson.closest('.cm-field--json-drop') || elWfJson
      const setDropActive = (on) => {
        zone.classList.toggle('cm-field--json-drop--active', Boolean(on))
      }

      ;['dragenter', 'dragover'].forEach((type) => {
        zone.addEventListener(type, (e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
          setDropActive(true)
        })
      })
      zone.addEventListener('dragleave', (e) => {
        const rel = e.relatedTarget
        if (rel && zone.contains(rel)) return
        setDropActive(false)
      })
      zone.addEventListener('drop', (e) => {
        e.preventDefault()
        e.stopPropagation()
        setDropActive(false)
        const dt = e.dataTransfer
        const files = dt && dt.files
        if (files && files.length) {
          void ingestWorkflowFiles(files)
          return
        }
        const plain = dt && String(dt.getData('text/plain') || '').trim()
        if (plain) applyWorkflowJsonText(plain, '已从拖放文本填入（可「加入列表」后保存）')
      })

      elWfJson.addEventListener('paste', (e) => {
        const files = e.clipboardData && e.clipboardData.files
        if (files && files.length) {
          e.preventDefault()
          void ingestWorkflowFiles(files)
        }
      })
    }

    function renderWfTable() {
      if (!elWfTbody) return
      const filtered = getWfFilteredRows()
      if (elWfFilterHint) {
        const n = wfRows.length
        const m = filtered.length
        elWfFilterHint.textContent = !n
          ? ''
          : `显示 ${m} / 共 ${n} 条（按「更新时间」新→旧排序；未记录显示为 —，保存过即有日期）`
      }
      elWfTbody.innerHTML = ''
      if (!wfRows.length) {
        elWfTbody.innerHTML =
          '<tr><td colspan="6" class="cm-table__empty">暂无官方工作流；填写上方表单后点「加入列表」。</td></tr>'
        return
      }
      if (!filtered.length) {
        elWfTbody.innerHTML =
          '<tr><td colspan="6" class="cm-table__empty">无匹配项；请调整「列表分类」或清空搜索关键字。</td></tr>'
        return
      }
      filtered.forEach((w, idx) => {
        const nk = String(w.nodeKind || '').trim()
        const nkLabel = NODE_KIND_OPTIONS.find((x) => x.id === nk)?.label || nk || '通用'
        const tr = document.createElement('tr')
        tr.innerHTML = `<td class="cm-td-num">${idx + 1}</td><td>${esc(w.name)}</td><td>${esc(nkLabel)}</td><td class="cm-td-ts">${esc(
          formatWorkflowTs(w.createdAtMs),
        )}</td><td class="cm-td-ts">${esc(formatWorkflowTs(w.updatedAtMs))}</td><td class="cm-td-actions"><button type="button" class="btn btn--sm cc-wf-load" data-id="${esc(
          w.id,
        )}">载入</button> <button type="button" class="btn btn--sm btn-danger cc-wf-del" data-id="${esc(w.id)}">删除</button></td>`
        tr.querySelector('.cc-wf-load')?.addEventListener('click', () => {
          if (elWfName) elWfName.value = w.name
          if (elWfDesc) elWfDesc.value = w.description || ''
          if (elWfJson) elWfJson.value = w.workflowJson || ''
          if (elWfNodeKind) elWfNodeKind.value = w.nodeKind || ''
          setWfMsg(
            '已载入表单。若未改内容，数据本来就在服务器，无需再保存。若已修改：先点「加入列表」更新下方表格，再滚到页底点「保存官方工作流配置」。',
            false,
          )
        })
        tr.querySelector('.cc-wf-del')?.addEventListener('click', () => {
          if (!util().confirmDanger('确定删除该官方工作流？')) return
          wfRows = wfRows.filter((x) => x.id !== w.id)
          renderWfTable()
        })
        elWfTbody.appendChild(tr)
      })
    }

    async function loadWfFromServer() {
      setWfMsg('加载中…', false)
      try {
        const json = await api().get('/admin/cloud-workflows')
        wfRows = Array.isArray(json?.workflows) ? json.workflows.map((x) => ({ ...x })) : []
        setWfMsg(`已加载 ${wfRows.length} 条`, false)
        renderWfTable()
      } catch (e) {
        setWfMsg(`加载失败：${String(e.message || e)}`, true)
        wfRows = []
        renderWfTable()
      }
    }

    btnWfClear?.addEventListener('click', () => {
      if (elWfName) elWfName.value = ''
      if (elWfDesc) elWfDesc.value = ''
      if (elWfJson) elWfJson.value = ''
      setWfMsg('', false)
    })

    btnWfAdd?.addEventListener('click', () => {
      const name = String(elWfName?.value || '').trim()
      const description = String(elWfDesc?.value || '').trim()
      const workflowJson = String(elWfJson?.value || '').trim()
      const nodeKind = String(elWfNodeKind?.value || '').trim()
      if (!name) return setWfMsg('请填写工作流显示名', true)
      const sameName = wfRows.find((x) => x.name === name)
      const id = sameName?.id || safeId()
      const prevRow = wfRows.find((x) => x.id === id)
      wfRows = wfRows.filter((x) => x.id !== id)
      const row = { id, name, description, nodeKind, workflowJson }
      const c0 = Number(prevRow?.createdAtMs)
      const u0 = Number(prevRow?.updatedAtMs)
      if (Number.isFinite(c0) && c0 > 0) row.createdAtMs = c0
      if (Number.isFinite(u0) && u0 > 0) row.updatedAtMs = u0
      wfRows.push(row)
      setWfMsg('已加入列表，请点击下方「保存官方工作流配置」写入服务器。', false)
      renderWfTable()
    })

    btnWfSave?.addEventListener('click', async () => {
      setWfMsg('保存中…', false)
      try {
        await api().post('/admin/cloud-workflows/save', { workflows: wfRows })
        setWfMsg('已保存', false)
        window.FlowidAdminToast('官方云端工作流已保存')
        await loadWfFromServer()
      } catch (e) {
        setWfMsg(`保存失败：${String(e.message || e)}`, true)
      }
    })

    function goModels() {
      if (window.FlowidAdminNavigate) window.FlowidAdminNavigate('overview')
    }
    root.querySelector('#cc-go-models')?.addEventListener('click', goModels)
    root.querySelector('#cc-go-models-footer')?.addEventListener('click', goModels)
    root.querySelector('#cc-go-models-assist')?.addEventListener('click', goModels)

    fillWfNodeKind()
    fillWfFilterKind()
    elWfFilterKind?.addEventListener('change', () => renderWfTable())
    elWfFilterQ?.addEventListener('input', () => renderWfTable())
    bindWorkflowJsonDropAndPaste()
    renderAssistPanels()
    await loadWfFromServer()
    await loadAssistFromServer()
  }
})()
