;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi
  const TIER = 'pro'
  const ALL = '全部'

  window.FlowidAdminPanelPromptsPro = async function (root) {
    let selectedId = ''
    let list = []

    root.innerHTML = `
      <p class="hint">此页仅管理「授权 Pro」系统提示词。前端需有效 License 且 <code>entitlements.proTemplates</code> 为真才可拉取正文。右侧支持<strong>分类筛选</strong>与<strong>搜索</strong>。</p>
      <div class="admin-resource-grid">
        <div class="admin-card admin-form-block">
          <h3>编辑区 · 上传 / 修改</h3>
          <label><span>提示词 ID（新建可留空）</span><input id="spp-id" type="text" autocomplete="off" /></label>
          <label><span>名称</span><input id="spp-name" type="text" /></label>
          <label><span>版本</span><input id="spp-version" value="1.0.0" /></label>
          <label><span>分类 category</span><input id="spp-category" value="general" /></label>
          <label><span>描述</span><textarea id="spp-desc"></textarea></label>
          <label><span>正文 systemPromptText</span><textarea id="spp-body" class="tall"></textarea></label>
          <div class="admin-form-actions">
            <button type="button" class="btn" id="spp-clear">清空表单</button>
            <button type="button" class="btn" id="spp-copy-id">复制引用 ID</button>
            <button type="button" class="btn btn-primary" id="spp-new">上传新增 Pro</button>
            <button type="button" class="btn btn-primary" id="spp-save">保存修改</button>
            <button type="button" class="btn btn-danger" id="spp-del">删除 / 下架</button>
          </div>
          <p class="mono" id="spp-msg"></p>
        </div>
        <div class="admin-card">
          <h3>Pro 提示词列表</h3>
          <div class="admin-list-toolbar">
            <label class="mono" style="margin:0;display:flex;align-items:center;gap:8px;">
              <span style="font-size:11px;text-transform:uppercase;color:var(--text-soft);white-space:nowrap;">分类</span>
              <select id="spp-cat" aria-label="按分类筛选"></select>
            </label>
            <input id="spp-q" class="admin-filter-input" type="search" placeholder="搜索名称、ID、描述…" autocomplete="off" />
            <button type="button" class="btn btn-primary" id="spp-refresh">刷新</button>
          </div>
          <div class="admin-list" id="spp-list"></div>
        </div>
      </div>`

    const q = (id) => root.querySelector(id)

    function rebuildCategoryFilter() {
      const sel = q('#spp-cat')
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
      q('#spp-id').value = ''
      q('#spp-name').value = ''
      q('#spp-version').value = '1.0.0'
      q('#spp-category').value = 'general'
      q('#spp-desc').value = ''
      q('#spp-body').value = ''
      q('#spp-msg').textContent = '已清空。'
      renderList()
    }

    function visibleItems() {
      const cat = q('#spp-cat').value || ALL
      const search = q('#spp-q').value
      return list.filter((p) => {
        if (U.normalizeTier(p.tier) !== TIER) return false
        if (cat !== ALL && U.normalizeCategoryLabel(p.category) !== cat) return false
        if (!U.itemMatchesSearch(p, search, ['id', 'name', 'description'])) return false
        return true
      })
    }

    function renderList() {
      const host = q('#spp-list')
      host.innerHTML = ''
      const filtered = visibleItems()
      if (!filtered.length) {
        host.innerHTML = '<div class="empty-state">无匹配项（可调整分类 / 搜索词）</div>'
        return
      }
      for (const p of filtered) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'admin-list-item' + (p.id === selectedId ? ' is-selected' : '')
        btn.innerHTML = `<div class="title">${U.escapeHtml(p.name || p.id)} <span class="tag tag-bad">PRO</span></div><div class="meta">${U.escapeHtml(p.id)} · ${U.escapeHtml(U.normalizeCategoryLabel(p.category))}</div>`
        btn.onclick = () => void selectOne(p.id)
        host.appendChild(btn)
      }
    }

    async function loadList() {
      const res = await api.get('/admin/system-prompts')
      list = res.prompts || []
      rebuildCategoryFilter()
      renderList()
    }

    async function selectOne(id) {
      selectedId = id
      q('#spp-msg').textContent = '加载详情…'
      try {
        const d = await api.get('/admin/system-prompts/' + encodeURIComponent(id))
        q('#spp-id').value = d.id || ''
        q('#spp-name').value = d.name || ''
        q('#spp-version').value = d.version || '1.0.0'
        q('#spp-category').value = d.category || 'general'
        q('#spp-desc').value = d.description || ''
        q('#spp-body').value = d.systemPromptText || ''
        q('#spp-msg').textContent = '已加载：' + id
        renderList()
      } catch (e) {
        q('#spp-msg').textContent = String(e.message || e)
        window.FlowidAdminToast(q('#spp-msg').textContent, true)
      }
    }

    q('#spp-cat').addEventListener('change', () => renderList())
    q('#spp-q').addEventListener('input', () => renderList())

    q('#spp-clear').onclick = () => clearForm()
    q('#spp-copy-id').onclick = async () => {
      const id = q('#spp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('无 ID 可复制', true)
        return
      }
      try {
        await navigator.clipboard.writeText(id)
        window.FlowidAdminToast('已复制 ID')
      } catch {
        window.alert(id)
      }
    }
    q('#spp-refresh').onclick = async () => {
      try {
        await loadList()
        window.FlowidAdminToast('列表已刷新')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spp-new').onclick = async () => {
      try {
        const text = q('#spp-body').value.trim()
        if (!q('#spp-name').value.trim()) throw new Error('名称不能为空')
        if (!text) throw new Error('正文不能为空')
        await api.post('/admin/system-prompts/upload', {
          id: q('#spp-id').value.trim() || undefined,
          name: q('#spp-name').value.trim(),
          version: q('#spp-version').value.trim() || '1.0.0',
          category: q('#spp-category').value.trim() || 'general',
          tier: TIER,
          description: q('#spp-desc').value.trim(),
          systemPromptText: text,
        })
        window.FlowidAdminToast('已新增 Pro 提示词')
        clearForm()
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spp-save').onclick = async () => {
      const id = q('#spp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先选择条目', true)
        return
      }
      try {
        const body = {
          name: q('#spp-name').value.trim(),
          version: q('#spp-version').value.trim() || '1.0.0',
          category: q('#spp-category').value.trim() || 'general',
          tier: TIER,
          description: q('#spp-desc').value.trim(),
        }
        const t = q('#spp-body').value
        if (t.trim()) body.systemPromptText = t
        await api.put('/admin/system-prompts/' + encodeURIComponent(id), body)
        window.FlowidAdminToast('已保存（后端已重算签名）')
        await selectOne(id)
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spp-del').onclick = async () => {
      const id = q('#spp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('无选中项', true)
        return
      }
      if (!U.confirmDanger('确定删除该 Pro 提示词？')) return
      try {
        await api.delete('/admin/system-prompts/' + encodeURIComponent(id))
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
