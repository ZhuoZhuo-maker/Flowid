;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi
  const TIER = 'free'
  const ALL = '全部'

  window.FlowidAdminPanelTemplatesFree = async function (root) {
    let selectedId = ''
    let list = []

    root.innerHTML = `
      <p class="hint">此页对应前端「<strong>预设模板</strong>」中的<strong>基础免费</strong>条目（<code>tier=free</code>）。此处上传的是<strong>项目预设模板数据</strong>（JSON），用于客户端编排与任务提交，并非 ComfyUI 画布概念。与 Pro 预设分栏维护。<strong>大文件</strong>：上传 /「仅更新预设文件」时正文以<strong>原文提交</strong>，由服务端解析，避免浏览器卡死；从右侧<strong>加载已有条目</strong>仍可能因整包 JSON 较大而短暂卡顿。若在框内<strong>选择/复制</strong>仍卡，请<strong>刷新后重试</strong>，并在本页对浏览器扩展（如 Grammarly）关闭「在此网站启用」。</p>
      <div class="admin-resource-grid">
        <div class="admin-card admin-form-block">
          <h3>编辑区 · 上传 / 修改</h3>
          <label><span>模板 ID（新建可留空自动生成）</span><input id="wf-id" type="text" autocomplete="off" placeholder="UUID 或自定义" /></label>
          <label><span>名称</span><input id="wf-name" type="text" /></label>
          <label><span>版本</span><input id="wf-version" value="1.0.0" /></label>
          <label><span>分类 category（与前端筛选一致，如 image、建筑、角色）</span><input id="wf-category" value="image" placeholder="image 或自定义分类" /></label>
          <label><span>描述</span><textarea id="wf-desc"></textarea></label>
          <label><span>paramsSchema（JSON）</span><textarea id="wf-schema" class="tall admin-json-mass" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm="false">{}</textarea></label>
          <label><span>预设数据 JSON（新建必填；对应后端存储，可用「仅更新预设文件」覆盖）</span><textarea id="wf-json" class="tall admin-json-mass" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm="false" wrap="off" placeholder="{ ... 项目预设模板 JSON ... }"></textarea></label>
          <div class="admin-form-actions">
            <button type="button" class="btn" id="wf-clear">清空表单</button>
            <button type="button" class="btn btn-primary" id="wf-save-new">上传新预设</button>
            <button type="button" class="btn btn-primary" id="wf-save-meta">保存元数据</button>
            <button type="button" class="btn" id="wf-save-flow">仅更新预设文件</button>
            <button type="button" class="btn btn-danger" id="wf-del">删除</button>
          </div>
          <p class="mono" id="wf-msg"></p>
        </div>
        <div class="admin-card">
          <h3>免费预设模板列表</h3>
          <div class="admin-list-toolbar">
            <label class="mono" style="margin:0;display:flex;align-items:center;gap:8px;">
              <span style="font-size:11px;text-transform:uppercase;color:var(--text-soft);white-space:nowrap;">分类</span>
              <select id="wf-cat" aria-label="按分类筛选"></select>
            </label>
            <input id="wf-q" class="admin-filter-input" type="search" placeholder="搜索名称、ID、描述…" autocomplete="off" />
            <button type="button" class="btn btn-primary" id="wf-refresh">刷新列表</button>
          </div>
          <div class="admin-list" id="wf-list"></div>
        </div>
      </div>`

    const q = (id) => root.querySelector(id)
    const msg = () => q('#wf-msg')

    function wireJsonFileDrop(sel, label) {
      const el = q(sel)
      if (!el || el.dataset.flowidDropWired === '1') return
      el.dataset.flowidDropWired = '1'
      el.classList.add('flowid-drop-target')
      const prevTitle = el.getAttribute('title') || ''
      el.setAttribute('title', (prevTitle ? prevTitle + ' · ' : '') + '可将 .json 文件拖入此处')
      el.addEventListener('dragover', (e) => {
        e.preventDefault()
        el.classList.add('is-dragover')
      })
      el.addEventListener('dragleave', (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('is-dragover')
      })
      el.addEventListener('drop', (e) => {
        e.preventDefault()
        el.classList.remove('is-dragover')
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
        if (!file) return
        const name = String(file.name || '').toLowerCase()
        if (!name.endsWith('.json') && file.type !== 'application/json') {
          window.FlowidAdminToast('请拖入 .json 文件', true)
          return
        }
        const reader = new FileReader()
        reader.onload = function () {
          el.value = String(reader.result || '')
          window.FlowidAdminToast(label + '已填入：' + file.name)
        }
        reader.onerror = function () {
          window.FlowidAdminToast('读取文件失败', true)
        }
        reader.readAsText(file)
      })
    }

    wireJsonFileDrop('#wf-json', '预设')
    wireJsonFileDrop('#wf-schema', 'paramsSchema')

    function rebuildCategoryFilter() {
      const sel = q('#wf-cat')
      const prev = sel.value || ALL
      const cats = U.uniqueCategoriesForTier(list, TIER)
      sel.innerHTML = ''
      const opt0 = document.createElement('option')
      opt0.value = ALL
      opt0.textContent = ALL
      sel.appendChild(opt0)
      for (const c of cats) {
        const o = document.createElement('option')
        o.value = c
        o.textContent = c
        sel.appendChild(o)
      }
      if ([ALL, ...cats].includes(prev)) sel.value = prev
      else sel.value = ALL
    }

    function clearForm() {
      selectedId = ''
      q('#wf-id').value = ''
      q('#wf-name').value = ''
      q('#wf-version').value = '1.0.0'
      q('#wf-category').value = 'image'
      q('#wf-desc').value = ''
      q('#wf-schema').value = '{}'
      q('#wf-json').value = ''
      msg().textContent = '已清空，可新建上传。'
      renderList()
    }

    function visibleItems() {
      const cat = q('#wf-cat').value || ALL
      const search = q('#wf-q').value
      return list.filter((t) => {
        if (U.normalizeTier(t.tier) !== TIER) return false
        if (cat !== ALL && U.normalizeCategoryLabel(t.category) !== cat) return false
        if (!U.itemMatchesSearch(t, search, ['id', 'name', 'description'])) return false
        return true
      })
    }

    function renderList() {
      const host = q('#wf-list')
      host.innerHTML = ''
      const filtered = visibleItems()
      if (!filtered.length) {
        host.innerHTML =
          '<div class="empty-state">无匹配项（可调整分类 / 搜索词，或点击刷新）</div>'
        return
      }
      for (const t of filtered) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'admin-list-item' + (t.id === selectedId ? ' is-selected' : '')
        btn.innerHTML = `<div class="title">${U.escapeHtml(t.name || t.id)}</div><div class="meta">${U.escapeHtml(t.id)} · ${U.escapeHtml(U.normalizeCategoryLabel(t.category))} · v${U.escapeHtml(String(t.version || '-'))}</div>`
        btn.onclick = () => void selectOne(t.id)
        host.appendChild(btn)
      }
    }

    async function loadList() {
      const res = await api.get('/admin/templates')
      list = res.templates || []
      rebuildCategoryFilter()
      renderList()
    }

    async function selectOne(id) {
      selectedId = id
      msg().textContent = '加载详情…'
      try {
        const d = await api.get('/admin/templates/' + encodeURIComponent(id))
        q('#wf-id').value = d.id || ''
        q('#wf-name').value = d.name || ''
        q('#wf-version').value = d.version || '1.0.0'
        q('#wf-category').value = d.category || 'image'
        q('#wf-desc').value = d.description || ''
        q('#wf-schema').value = U.safeJsonStringify(d.paramsSchema || {}, 2)
        q('#wf-json').value = d.workflowJsonText || ''
        msg().textContent = '已加载：' + id
        renderList()
      } catch (e) {
        msg().textContent = String(e.message || e)
        window.FlowidAdminToast(msg().textContent, true)
      }
    }

    q('#wf-cat').addEventListener('change', () => renderList())
    q('#wf-q').addEventListener('input', () => renderList())

    q('#wf-clear').onclick = () => clearForm()

    q('#wf-refresh').onclick = async () => {
      try {
        await loadList()
        window.FlowidAdminToast('列表已刷新')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wf-save-new').onclick = async () => {
      try {
        const workflowJson = U.workflowJsonTextForSubmit(q('#wf-json').value)
        const paramsSchema = U.safeJsonParse(q('#wf-schema').value, {})
        if (!q('#wf-name').value.trim()) throw new Error('名称不能为空')
        const body = {
          id: q('#wf-id').value.trim() || undefined,
          name: q('#wf-name').value.trim(),
          version: q('#wf-version').value.trim() || '1.0.0',
          category: q('#wf-category').value.trim() || 'image',
          tier: TIER,
          description: q('#wf-desc').value.trim(),
          paramsSchema,
          workflowJson,
        }
        await api.post('/admin/templates/upload', body)
        window.FlowidAdminToast('已创建预设模板')
        clearForm()
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wf-save-meta').onclick = async () => {
      const id = q('#wf-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先在右侧列表选择条目', true)
        return
      }
      try {
        const paramsSchema = U.safeJsonParse(q('#wf-schema').value, {})
        await api.put('/admin/templates/' + encodeURIComponent(id), {
          name: q('#wf-name').value.trim(),
          version: q('#wf-version').value.trim() || '1.0.0',
          category: q('#wf-category').value.trim() || 'image',
          tier: TIER,
          description: q('#wf-desc').value,
          paramsSchema,
        })
        window.FlowidAdminToast('元数据已保存')
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wf-save-flow').onclick = async () => {
      const id = q('#wf-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先选择条目', true)
        return
      }
      let workflowJson
      try {
        workflowJson = U.workflowJsonTextForSubmit(q('#wf-json').value)
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
        return
      }
      try {
        await api.put('/admin/templates/' + encodeURIComponent(id) + '/workflow', { workflowJson })
        window.FlowidAdminToast('预设文件已更新')
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wf-del').onclick = async () => {
      const id = q('#wf-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('无选中模板', true)
        return
      }
      if (!U.confirmDanger('确定删除该预设模板及其存储文件？')) return
      try {
        await api.delete('/admin/templates/' + encodeURIComponent(id))
        window.FlowidAdminToast('已删除')
        clearForm()
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    try {
      await loadList()
    } catch (e) {
      window.FlowidAdminToast(String(e.message || e), true)
    }
  }
})()
