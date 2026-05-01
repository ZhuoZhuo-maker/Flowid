;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi
  const TIER = 'pro'
  const ALL = '全部'

  window.FlowidAdminPanelTemplatesPro = async function (root) {
    let selectedId = ''
    let list = []

    root.innerHTML = `
      <p class="hint">此页对应前端「<strong>预设模板</strong>」中的<strong>会员 Pro</strong>条目（<code>tier=pro</code>）。上传的是<strong>项目预设模板 JSON</strong>；仅当 License 有效且 <code>entitlements.proTemplates === true</code> 时前端可见。下架请删除（后端暂无单条冻结字段）。<strong>大文件</strong>：上传与「仅更新预设文件」以<strong>原文提交</strong>由服务端解析，减轻浏览器卡死；从列表<strong>加载详情</strong>超大 JSON 时仍可能略卡。框内<strong>选区/复制</strong>仍卡时请刷新，并关闭 Grammarly 等扩展在本页的作用。</p>
      <div class="admin-resource-grid">
        <div class="admin-card admin-form-block">
          <h3>编辑区 · 上传 / 修改</h3>
          <label><span>模板 ID（新建可留空）</span><input id="wfp-id" type="text" autocomplete="off" /></label>
          <label><span>名称</span><input id="wfp-name" type="text" /></label>
          <label><span>版本</span><input id="wfp-version" value="1.0.0" /></label>
          <label><span>分类 category</span><input id="wfp-category" value="image" placeholder="与前端筛选一致" /></label>
          <label><span>描述</span><textarea id="wfp-desc"></textarea></label>
          <label><span>paramsSchema（JSON）</span><textarea id="wfp-schema" class="tall admin-json-mass" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm="false">{}</textarea></label>
          <label><span>预设数据 JSON</span><textarea id="wfp-json" class="tall admin-json-mass" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm="false" wrap="off" placeholder="{ ... 项目预设模板 JSON ... }"></textarea></label>
          <div class="admin-form-actions">
            <button type="button" class="btn" id="wfp-clear">清空表单</button>
            <button type="button" class="btn btn-primary" id="wfp-save-new">上传新 Pro 预设</button>
            <button type="button" class="btn btn-primary" id="wfp-save-meta">保存元数据</button>
            <button type="button" class="btn" id="wfp-save-flow">仅更新预设文件</button>
            <button type="button" class="btn btn-danger" id="wfp-del">删除 / 下架</button>
          </div>
          <p class="mono" id="wfp-msg"></p>
        </div>
        <div class="admin-card">
          <h3>Pro 预设模板列表</h3>
          <div class="admin-list-toolbar">
            <label class="mono" style="margin:0;display:flex;align-items:center;gap:8px;">
              <span style="font-size:11px;text-transform:uppercase;color:var(--text-soft);white-space:nowrap;">分类</span>
              <select id="wfp-cat" aria-label="按分类筛选"></select>
            </label>
            <input id="wfp-q" class="admin-filter-input" type="search" placeholder="搜索名称、ID、描述…" autocomplete="off" />
            <button type="button" class="btn btn-primary" id="wfp-refresh">刷新列表</button>
          </div>
          <div class="admin-list" id="wfp-list"></div>
        </div>
      </div>`

    const q = (id) => root.querySelector(id)

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

    wireJsonFileDrop('#wfp-json', '预设')
    wireJsonFileDrop('#wfp-schema', 'paramsSchema')

    function rebuildCategoryFilter() {
      const sel = q('#wfp-cat')
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
      q('#wfp-id').value = ''
      q('#wfp-name').value = ''
      q('#wfp-version').value = '1.0.0'
      q('#wfp-category').value = 'image'
      q('#wfp-desc').value = ''
      q('#wfp-schema').value = '{}'
      q('#wfp-json').value = ''
      q('#wfp-msg').textContent = '已清空。'
      renderList()
    }

    function visibleItems() {
      const cat = q('#wfp-cat').value || ALL
      const search = q('#wfp-q').value
      return list.filter((t) => {
        if (U.normalizeTier(t.tier) !== TIER) return false
        if (cat !== ALL && U.normalizeCategoryLabel(t.category) !== cat) return false
        if (!U.itemMatchesSearch(t, search, ['id', 'name', 'description'])) return false
        return true
      })
    }

    function renderList() {
      const host = q('#wfp-list')
      host.innerHTML = ''
      const filtered = visibleItems()
      if (!filtered.length) {
        host.innerHTML = '<div class="empty-state">无匹配项（可调整分类 / 搜索词）</div>'
        return
      }
      for (const t of filtered) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'admin-list-item' + (t.id === selectedId ? ' is-selected' : '')
        btn.innerHTML = `<div class="title">${U.escapeHtml(t.name || t.id)} <span class="tag tag-bad">PRO</span></div><div class="meta">${U.escapeHtml(t.id)} · ${U.escapeHtml(U.normalizeCategoryLabel(t.category))}</div>`
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
      q('#wfp-msg').textContent = '加载详情…'
      try {
        const d = await api.get('/admin/templates/' + encodeURIComponent(id))
        q('#wfp-id').value = d.id || ''
        q('#wfp-name').value = d.name || ''
        q('#wfp-version').value = d.version || '1.0.0'
        q('#wfp-category').value = d.category || 'image'
        q('#wfp-desc').value = d.description || ''
        q('#wfp-schema').value = U.safeJsonStringify(d.paramsSchema || {}, 2)
        q('#wfp-json').value = d.workflowJsonText || ''
        q('#wfp-msg').textContent = '已加载：' + id
        renderList()
      } catch (e) {
        q('#wfp-msg').textContent = String(e.message || e)
        window.FlowidAdminToast(q('#wfp-msg').textContent, true)
      }
    }

    q('#wfp-cat').addEventListener('change', () => renderList())
    q('#wfp-q').addEventListener('input', () => renderList())

    q('#wfp-clear').onclick = () => clearForm()
    q('#wfp-refresh').onclick = async () => {
      try {
        await loadList()
        window.FlowidAdminToast('列表已刷新')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wfp-save-new').onclick = async () => {
      try {
        const workflowJson = U.workflowJsonTextForSubmit(q('#wfp-json').value)
        const paramsSchema = U.safeJsonParse(q('#wfp-schema').value, {})
        if (!q('#wfp-name').value.trim()) throw new Error('名称不能为空')
        await api.post('/admin/templates/upload', {
          id: q('#wfp-id').value.trim() || undefined,
          name: q('#wfp-name').value.trim(),
          version: q('#wfp-version').value.trim() || '1.0.0',
          category: q('#wfp-category').value.trim() || 'image',
          tier: TIER,
          description: q('#wfp-desc').value.trim(),
          paramsSchema,
          workflowJson,
        })
        window.FlowidAdminToast('已创建 Pro 预设模板')
        clearForm()
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wfp-save-meta').onclick = async () => {
      const id = q('#wfp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先在右侧列表选择条目', true)
        return
      }
      try {
        const paramsSchema = U.safeJsonParse(q('#wfp-schema').value, {})
        await api.put('/admin/templates/' + encodeURIComponent(id), {
          name: q('#wfp-name').value.trim(),
          version: q('#wfp-version').value.trim() || '1.0.0',
          category: q('#wfp-category').value.trim() || 'image',
          tier: TIER,
          description: q('#wfp-desc').value,
          paramsSchema,
        })
        window.FlowidAdminToast('元数据已保存（仍为 Pro）')
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wfp-save-flow').onclick = async () => {
      const id = q('#wfp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先选择条目', true)
        return
      }
      let workflowJson
      try {
        workflowJson = U.workflowJsonTextForSubmit(q('#wfp-json').value)
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

    q('#wfp-del').onclick = async () => {
      const id = q('#wfp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('无选中模板', true)
        return
      }
      if (!U.confirmDanger('确定删除该 Pro 预设模板？')) return
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
