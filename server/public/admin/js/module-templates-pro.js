;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi
  const ALL = '全部'

  window.FlowidAdminPanelTemplatesPro = async function (root) {
    let selectedId = ''
    let list = []

    root.innerHTML = `
<section class="tmpl-page" aria-label="预设模板管理">
  <header class="tmpl-crumb">
    <span class="tmpl-crumb__main">预设模板</span>
    <span class="tmpl-crumb__sep">/</span>
    <span class="tmpl-crumb__sub">项目预设模板 JSON</span>
  </header>
  <p class="tmpl-banner hint">
    维护<strong>项目预设模板</strong>（JSON 工程与元数据）。保存与上传时由服务端统一写入 <code>tier=free</code>，不再区分 PRO / 基础档位。
    下架请<strong>删除</strong>（暂无单条冻结字段）。大文件上传与「仅更新预设文件」由服务端解析；列表加载超大 JSON 时浏览器可能略卡。
  </p>
  <div class="tmpl-grid">
    <div class="tmpl-card tmpl-card--form">
      <h3 class="tmpl-card__title">编辑区</h3>
      <div class="tmpl-fields">
        <label class="tmpl-field"><span class="tmpl-field__label">模板 ID（新建可留空）</span><input id="wfp-id" class="tmpl-input" type="text" autocomplete="off" /></label>
        <label class="tmpl-field"><span class="tmpl-field__label">名称</span><input id="wfp-name" class="tmpl-input" type="text" /></label>
        <label class="tmpl-field"><span class="tmpl-field__label">版本</span><input id="wfp-version" class="tmpl-input" value="1.0.0" /></label>
        <label class="tmpl-field"><span class="tmpl-field__label">分类 category</span><input id="wfp-category" class="tmpl-input" value="image" placeholder="与前端筛选一致" /></label>
        <label class="tmpl-field"><span class="tmpl-field__label">描述</span><textarea id="wfp-desc" class="tmpl-textarea tmpl-textarea--sm" rows="3"></textarea></label>
        <label class="tmpl-field"><span class="tmpl-field__label">paramsSchema（JSON）</span><textarea id="wfp-schema" class="tmpl-textarea tmpl-textarea--json admin-json-mass" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm="false">{}</textarea></label>
        <label class="tmpl-field"><span class="tmpl-field__label">预设数据 JSON</span><textarea id="wfp-json" class="tmpl-textarea tmpl-textarea--json tall admin-json-mass" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm="false" wrap="off" placeholder="{ ... 项目预设 / Comfy workflow JSON ... }"></textarea></label>
      </div>
      <div class="tmpl-toolbar">
        <button type="button" class="btn" id="wfp-clear">清空表单</button>
        <button type="button" class="btn" id="wfp-import-json">导入 JSON</button>
        <button type="button" class="btn btn-primary" id="wfp-save-new">上传新预设</button>
        <button type="button" class="btn btn-primary" id="wfp-save-meta">保存元数据</button>
        <button type="button" class="btn" id="wfp-save-flow">仅更新预设文件</button>
        <button type="button" class="btn btn-danger" id="wfp-del">删除 / 下架</button>
      </div>
      <input type="file" id="wfp-import-file" class="tmpl-sr-only" accept=".json,application/json" aria-hidden="true" tabindex="-1" />
      <p class="tmpl-msg mono" id="wfp-msg"></p>
    </div>
    <div class="tmpl-card tmpl-card--list">
      <h3 class="tmpl-card__title">预设模板列表</h3>
      <div class="tmpl-list-head">
        <label class="tmpl-filter">
          <span class="tmpl-filter__lab">分类</span>
          <select id="wfp-cat" class="tmpl-select tmpl-select--narrow" aria-label="按分类筛选"></select>
        </label>
        <input id="wfp-q" class="tmpl-input tmpl-input--search" type="search" placeholder="搜索名称、ID、描述…" autocomplete="off" />
        <button type="button" class="btn btn-primary tmpl-refresh" id="wfp-refresh">刷新列表</button>
      </div>
      <div class="tmpl-list" id="wfp-list" role="list"></div>
    </div>
  </div>
</section>`

    const q = (id) => root.querySelector(id)

    function readFileAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsText(file)
      })
    }

    function looksLikeComfyWorkflow(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
      if (Array.isArray(obj.nodes)) return true
      if (obj.last_node_id != null && obj.version != null) return true
      return false
    }

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

    function itemsForCategorySource() {
      return list
    }

    function rebuildCategoryFilter() {
      const sel = q('#wfp-cat')
      const prev = sel.value || ALL
      const cats = new Set()
      for (const t of itemsForCategorySource()) cats.add(U.normalizeCategoryLabel(t.category))
      const sorted = Array.from(cats).sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'))
      sel.innerHTML = ''
      const opt0 = document.createElement('option')
      opt0.value = ALL
      opt0.textContent = ALL
      sel.appendChild(opt0)
      for (const c of sorted) {
        const o = document.createElement('option')
        o.value = c
        o.textContent = c
        sel.appendChild(o)
      }
      if ([ALL, ...sorted].includes(prev)) sel.value = prev
      else sel.value = ALL
    }

    function truncateId(id) {
      const s = String(id || '')
      if (s.length <= 24) return s
      return s.slice(0, 12) + '…' + s.slice(-8)
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
        host.innerHTML = '<div class="tmpl-empty">无匹配项（可调整分类 / 搜索词）</div>'
        return
      }
      for (const t of filtered) {
        const card = document.createElement('div')
        card.className = 'tmpl-card-item' + (t.id === selectedId ? ' is-selected' : '')
        card.setAttribute('role', 'listitem')
        card.tabIndex = 0
        card.innerHTML = `
          <div class="tmpl-card-item__main">
            <div class="tmpl-card-item__title-row">
              <span class="tmpl-card-item__title">${U.escapeHtml(t.name || t.id)}</span>
            </div>
            <div class="tmpl-card-item__meta">
              <span class="tmpl-card-item__id mono" title="${U.escapeHtml(t.id)}">${U.escapeHtml(truncateId(t.id))}</span>
              <span class="tmpl-pill">${U.escapeHtml(U.normalizeCategoryLabel(t.category))}</span>
            </div>
          </div>
          <div class="tmpl-card-item__actions">
            <button type="button" class="btn btn--sm tmpl-card-item__btn-edit">编辑</button>
            <button type="button" class="btn btn--sm btn-danger tmpl-card-item__btn-del">删除</button>
          </div>`
        const onSelect = () => void selectOne(t.id)
        card.addEventListener('click', (e) => {
          if (e.target.closest('.tmpl-card-item__actions')) return
          onSelect()
        })
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (e.target.closest('.tmpl-card-item__actions')) return
            onSelect()
          }
        })
        card.querySelector('.tmpl-card-item__btn-edit').addEventListener('click', (e) => {
          e.stopPropagation()
          onSelect()
        })
        card.querySelector('.tmpl-card-item__btn-del').addEventListener('click', (e) => {
          e.stopPropagation()
          void deleteOne(t.id)
        })
        host.appendChild(card)
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

    async function deleteOne(id) {
      if (!id) return
      if (!U.confirmDanger('确定删除该预设模板？下架后客户端将无法再拉取到此条目。')) return
      try {
        await api.delete('/admin/templates/' + encodeURIComponent(id))
        const wasSelected = selectedId === id
        await loadList()
        if (wasSelected) {
          selectedId = ''
          q('#wfp-id').value = ''
          q('#wfp-name').value = ''
          q('#wfp-version').value = '1.0.0'
          q('#wfp-category').value = 'image'
          q('#wfp-desc').value = ''
          q('#wfp-schema').value = '{}'
          q('#wfp-json').value = ''
          q('#wfp-msg').textContent = '已删除并清空编辑区。'
        } else {
          q('#wfp-msg').textContent = '已删除。'
        }
        renderList()
        window.FlowidAdminToast('已删除')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wfp-cat').addEventListener('change', () => renderList())
    q('#wfp-q').addEventListener('input', () => renderList())

    q('#wfp-clear').onclick = () => clearForm()

    q('#wfp-import-json').onclick = () => q('#wfp-import-file').click()
    q('#wfp-import-file').addEventListener('change', async () => {
      const inp = q('#wfp-import-file')
      const file = inp.files && inp.files[0]
      inp.value = ''
      if (!file) return
      try {
        const text = await readFileAsText(file)
        let data
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error('JSON 解析失败')
        }
        if (Array.isArray(data)) throw new Error('不支持 JSON 数组作为根')

        const wfNested =
          data.workflow != null && typeof data.workflow === 'object' ? data.workflow : null
        if (wfNested) {
          q('#wfp-json').value = U.safeJsonStringify(wfNested, 2)
        } else if (typeof data.workflowJsonText === 'string') {
          q('#wfp-json').value = data.workflowJsonText
        } else if (typeof data.workflowJson === 'string') {
          q('#wfp-json').value = data.workflowJson
        } else if (looksLikeComfyWorkflow(data)) {
          q('#wfp-json').value = U.safeJsonStringify(data, 2)
        }

        if (data.id != null) q('#wfp-id').value = String(data.id).trim()
        if (data.name != null) q('#wfp-name').value = String(data.name).trim()
        if (data.version != null) q('#wfp-version').value = String(data.version).trim() || '1.0.0'
        if (data.category != null) q('#wfp-category').value = String(data.category).trim() || 'image'
        if (data.description != null) q('#wfp-desc').value = String(data.description)
        if (data.paramsSchema != null && typeof data.paramsSchema === 'object') {
          q('#wfp-schema').value = U.safeJsonStringify(data.paramsSchema, 2)
        }

        q('#wfp-msg').textContent = '已从「' + file.name + '」解析并填入表单，请检查后「上传新预设」或继续编辑。'
        window.FlowidAdminToast('已导入 JSON')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    })

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
          tier: 'free',
          description: q('#wfp-desc').value.trim(),
          paramsSchema,
          workflowJson,
        })
        window.FlowidAdminToast('已创建预设模板')
        clearForm()
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#wfp-save-meta').onclick = async () => {
      const id = q('#wfp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先在列表中选择条目并加载到编辑区', true)
        return
      }
      try {
        const paramsSchema = U.safeJsonParse(q('#wfp-schema').value, {})
        await api.put('/admin/templates/' + encodeURIComponent(id), {
          name: q('#wfp-name').value.trim(),
          version: q('#wfp-version').value.trim() || '1.0.0',
          category: q('#wfp-category').value.trim() || 'image',
          tier: 'free',
          description: q('#wfp-desc').value,
          paramsSchema,
        })
        window.FlowidAdminToast('元数据已保存')
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

    q('#wfp-del').onclick = () => {
      const id = q('#wfp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('无选中模板', true)
        return
      }
      void deleteOne(id)
    }

    try {
      await loadList()
    } catch (e) {
      window.FlowidAdminToast(String(e.message || e), true)
    }
  }
})()
