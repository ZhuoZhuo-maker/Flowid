;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi
  const TIER = 'free'
  const ALL = '全部'

  window.FlowidAdminPanelPromptsFree = async function (root) {
    let selectedId = ''
    let list = []

    root.innerHTML = `
      <p class="hint">此页仅管理「基础免费」系统提示词（<code>tier=free</code>）。保存时由后端重算 <code>sha256</code> 与 HMAC 签名。右侧支持<strong>按分类筛选</strong>与<strong>搜索</strong>（名称、ID、描述）。</p>
      <div class="admin-resource-grid">
        <div class="admin-card admin-form-block">
          <h3>编辑区 · 上传 / 修改</h3>
          <label><span>提示词 ID（新建可留空）</span><input id="sp-id" type="text" autocomplete="off" /></label>
          <label><span>名称</span><input id="sp-name" type="text" /></label>
          <label><span>版本</span><input id="sp-version" value="1.0.0" /></label>
          <label><span>分类 category（与列表筛选一致）</span><input id="sp-category" value="general" placeholder="general 或 建筑、角色等" /></label>
          <label><span>描述</span><textarea id="sp-desc"></textarea></label>
          <label><span>正文 systemPromptText</span><textarea id="sp-body" class="tall" placeholder="系统提示词全文…"></textarea></label>
          <div class="admin-form-actions">
            <button type="button" class="btn" id="sp-clear">清空表单</button>
            <button type="button" class="btn" id="sp-copy-id">复制引用 ID</button>
            <button type="button" class="btn btn-primary" id="sp-new">上传新增</button>
            <button type="button" class="btn btn-primary" id="sp-save">保存修改</button>
            <button type="button" class="btn btn-danger" id="sp-del">删除</button>
          </div>
          <p class="mono" id="sp-msg"></p>
        </div>
        <div class="admin-card">
          <h3>免费提示词列表</h3>
          <div class="admin-list-toolbar">
            <label class="mono" style="margin:0;display:flex;align-items:center;gap:8px;">
              <span style="font-size:11px;text-transform:uppercase;color:var(--text-soft);white-space:nowrap;">分类</span>
              <select id="sp-cat" aria-label="按分类筛选"></select>
            </label>
            <input id="sp-q" class="admin-filter-input" type="search" placeholder="搜索名称、ID、描述…" autocomplete="off" />
            <button type="button" class="btn btn-primary" id="sp-refresh">刷新</button>
          </div>
          <div class="admin-list" id="sp-list"></div>
        </div>
      </div>`

    const q = (id) => root.querySelector(id)

    function rebuildCategoryFilter() {
      const sel = q('#sp-cat')
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
      q('#sp-id').value = ''
      q('#sp-name').value = ''
      q('#sp-version').value = '1.0.0'
      q('#sp-category').value = 'general'
      q('#sp-desc').value = ''
      q('#sp-body').value = ''
      q('#sp-msg').textContent = '已清空。'
      renderList()
    }

    function visibleItems() {
      const cat = q('#sp-cat').value || ALL
      const search = q('#sp-q').value
      return list.filter((p) => {
        if (U.normalizeTier(p.tier) !== TIER) return false
        if (cat !== ALL && U.normalizeCategoryLabel(p.category) !== cat) return false
        if (!U.itemMatchesSearch(p, search, ['id', 'name', 'description'])) return false
        return true
      })
    }

    function renderList() {
      const host = q('#sp-list')
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
        btn.innerHTML = `<div class="title">${U.escapeHtml(p.name || p.id)}</div><div class="meta">${U.escapeHtml(p.id)} · ${U.escapeHtml(U.normalizeCategoryLabel(p.category))} · v${U.escapeHtml(String(p.version || '-'))}</div>`
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
      q('#sp-msg').textContent = '加载详情…'
      try {
        const d = await api.get('/admin/system-prompts/' + encodeURIComponent(id))
        q('#sp-id').value = d.id || ''
        q('#sp-name').value = d.name || ''
        q('#sp-version').value = d.version || '1.0.0'
        q('#sp-category').value = d.category || 'general'
        q('#sp-desc').value = d.description || ''
        q('#sp-body').value = d.systemPromptText || ''
        q('#sp-msg').textContent = '已加载（HMAC 校验通过）：' + id
        renderList()
      } catch (e) {
        q('#sp-msg').textContent = String(e.message || e)
        window.FlowidAdminToast(q('#sp-msg').textContent, true)
      }
    }

    q('#sp-cat').addEventListener('change', () => renderList())
    q('#sp-q').addEventListener('input', () => renderList())

    q('#sp-clear').onclick = () => clearForm()

    q('#sp-copy-id').onclick = async () => {
      const id = q('#sp-id').value.trim()
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

    q('#sp-refresh').onclick = async () => {
      try {
        await loadList()
        window.FlowidAdminToast('列表已刷新')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#sp-new').onclick = async () => {
      try {
        const text = q('#sp-body').value.trim()
        if (!q('#sp-name').value.trim()) throw new Error('名称不能为空')
        if (!text) throw new Error('正文不能为空')
        await api.post('/admin/system-prompts/upload', {
          id: q('#sp-id').value.trim() || undefined,
          name: q('#sp-name').value.trim(),
          version: q('#sp-version').value.trim() || '1.0.0',
          category: q('#sp-category').value.trim() || 'general',
          tier: TIER,
          description: q('#sp-desc').value.trim(),
          systemPromptText: text,
        })
        window.FlowidAdminToast('已新增免费提示词')
        clearForm()
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#sp-save').onclick = async () => {
      const id = q('#sp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先选择条目', true)
        return
      }
      try {
        const body = {
          name: q('#sp-name').value.trim(),
          version: q('#sp-version').value.trim() || '1.0.0',
          category: q('#sp-category').value.trim() || 'general',
          tier: TIER,
          description: q('#sp-desc').value.trim(),
        }
        const t = q('#sp-body').value
        if (t.trim()) body.systemPromptText = t
        await api.put('/admin/system-prompts/' + encodeURIComponent(id), body)
        window.FlowidAdminToast('已保存（后端已重算签名）')
        await selectOne(id)
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#sp-del').onclick = async () => {
      const id = q('#sp-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('无选中项', true)
        return
      }
      if (!U.confirmDanger('确定删除该提示词及其文件？')) return
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
