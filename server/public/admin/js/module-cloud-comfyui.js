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

  window.FlowidAdminPanelCloudComfyui = async function (mount) {
    const root = document.createElement('div')
    root.className = 'cm-page'
    root.innerHTML = `
      <p class="hint" style="margin:0 0 16px">
        与 <strong>云端模型（辅助模式）</strong>分页维护；模型 API 请在左侧「云端模型」配置。
        <button type="button" class="btn" style="margin-left:10px" id="cc-go-models">← 返回云端模型</button>
      </p>

      <article class="cm-card cm-card--wide" id="cc-wf-card">
        <span class="cm-card__k">Comfy</span>
        <h3 class="cm-card__title">云端 ComfyUI 工作流（官方）</h3>
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
        <label class="cm-field cm-field--full">
          <span>工作流 JSON（ComfyUI API 格式）</span>
          <textarea id="cc-wf-json" class="cm-input" rows="10" style="font-family: ui-monospace, monospace; font-size: 12px" spellcheck="false" placeholder="{ &quot;...&quot;: ... }"></textarea>
        </label>
        <p id="cc-wf-msg" class="cm-entry-msg"></p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px">
          <button type="button" class="btn cm-btn-primary" id="cc-wf-add">加入列表</button>
          <button type="button" class="btn" id="cc-wf-clear">清空表单</button>
        </div>
        <div class="cm-table-wrap">
          <table class="cm-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>节点</th>
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
          <button type="button" class="btn" id="cc-go-models-footer">返回云端模型</button>
        </div>
      </footer>
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
    let wfRows = []

    function fillWfNodeKind() {
      if (!elWfNodeKind) return
      elWfNodeKind.innerHTML = NODE_KIND_OPTIONS.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')
    }

    function setWfMsg(t, isErr) {
      if (!elWfMsg) return
      elWfMsg.textContent = String(t || '')
      elWfMsg.classList.toggle('cm-entry-msg--err', Boolean(isErr))
    }

    function renderWfTable() {
      if (!elWfTbody) return
      elWfTbody.innerHTML = ''
      if (!wfRows.length) {
        elWfTbody.innerHTML =
          '<tr><td colspan="3" class="cm-table__empty">暂无官方工作流；填写上方表单后点「加入列表」。</td></tr>'
        return
      }
      for (const w of wfRows) {
        const nk = String(w.nodeKind || '').trim()
        const nkLabel = NODE_KIND_OPTIONS.find((x) => x.id === nk)?.label || nk || '通用'
        const tr = document.createElement('tr')
        tr.innerHTML = `<td>${esc(w.name)}</td><td>${esc(nkLabel)}</td><td class="cm-td-actions"><button type="button" class="btn btn--sm cc-wf-load" data-id="${esc(
          w.id,
        )}">载入</button> <button type="button" class="btn btn--sm btn-danger cc-wf-del" data-id="${esc(w.id)}">删除</button></td>`
        tr.querySelector('.cc-wf-load')?.addEventListener('click', () => {
          if (elWfName) elWfName.value = w.name
          if (elWfDesc) elWfDesc.value = w.description || ''
          if (elWfJson) elWfJson.value = w.workflowJson || ''
          if (elWfNodeKind) elWfNodeKind.value = w.nodeKind || ''
          setWfMsg('已载入表单（修改后请「加入列表」再保存）', false)
        })
        tr.querySelector('.cc-wf-del')?.addEventListener('click', () => {
          if (!util().confirmDanger('确定删除该官方工作流？')) return
          wfRows = wfRows.filter((x) => x.id !== w.id)
          renderWfTable()
        })
        elWfTbody.appendChild(tr)
      }
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
      wfRows = wfRows.filter((x) => x.id !== id)
      wfRows.push({ id, name, description, nodeKind, workflowJson })
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
      if (window.FlowidAdminNavigate) window.FlowidAdminNavigate('cloud-models')
    }
    root.querySelector('#cc-go-models')?.addEventListener('click', goModels)
    root.querySelector('#cc-go-models-footer')?.addEventListener('click', goModels)

    fillWfNodeKind()
    await loadWfFromServer()
  }
})()
