;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi
  const ALL = '全部'

  /** 分类下拉展示名（option value 仍为列表中的规范化分类字符串） */
  const CAT_LABEL = {
    general: '通用',
    professional: '专业',
    custom: '自定义',
  }

  window.FlowidAdminPanelPromptsPro = async function (root) {
    let selectedId = ''
    let list = []

    function newRowId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      return `spo-c-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    }

    /** @type {{ id: string, name: string, originalName: string }[]} */
    let spoCatOrderRows = []

    root.innerHTML = `
<section class="spo-page" aria-label="系统提示词管理">
  <header class="spo-crumb">
    <span class="spo-crumb__main">系统提示词</span>
    <span class="spo-crumb__sep">/</span>
    <span class="spo-crumb__sub">系统提示词正文</span>
  </header>
  <p class="spo-banner hint">
    列表：<code>GET /admin/system-prompts</code>；保存：<code>PUT /admin/system-prompts/:id</code> 会落盘正文并重算 <code>sha256</code> 与签名。
    后端无独立「全局」字段：上方正文为<strong>当前选中条目</strong>的文件内容；产品侧可将固定 ID 作为全对话默认。
  </p>

  <div class="spo-card spo-card--catorder" style="margin-bottom:16px">
    <h3 class="spo-card__title">分类标签</h3>
    <p class="hint" style="margin:0 0 12px">
      新增、改名、删除或排序后保存。画布右侧「系统提示词」顶部分类 Tab 按此列表；可先添加尚无条目的分类（空 Tab）。删除某分类且仍有提示词使用时，保存后这些条目的 category 会改为列表第一项。改名会更新索引中所有该分类条目（不重算正文签名）。
    </p>
    <div id="spo-cat-order-rows" class="im-cat-rows"></div>
    <div class="im-cats__actions">
      <button type="button" class="im-btn-ghost" id="spo-cat-order-add">+ 添加分类</button>
      <button type="button" class="btn btn-primary" id="spo-cat-order-save">保存分类</button>
    </div>
  </div>

  <div class="spo-card spo-card--body">
    <h3 class="spo-card__title">正文 · SYSTEM PROMPT TEXT</h3>
    <textarea id="spo-body" class="spo-body-editor" spellcheck="false" autocomplete="off" autocorrect="off" data-gramm="false" placeholder="在此编辑系统提示词全文…"></textarea>
    <p class="spo-body-foot">这是全局系统提示词，将影响所有 AI 对话行为</p>
  </div>

  <div class="spo-card spo-card--meta">
    <h3 class="spo-card__title">当前条目属性</h3>
    <div class="spo-meta-grid">
      <label class="spo-field"><span class="spo-field__lab">提示词 ID（新建可留空）</span><input id="spo-id" class="spo-input" type="text" autocomplete="off" /></label>
      <label class="spo-field"><span class="spo-field__lab">名称</span><input id="spo-name" class="spo-input" type="text" /></label>
      <label class="spo-field"><span class="spo-field__lab">版本</span><input id="spo-version" class="spo-input" value="1.0.0" /></label>
      <label class="spo-field"><span class="spo-field__lab">档位 tier</span>
        <select id="spo-tier" class="spo-select" aria-label="档位">
          <option value="pro">PRO</option>
          <option value="free">基础 / 公开（free）</option>
        </select>
      </label>
      <label class="spo-field"><span class="spo-field__lab">分类 category</span><input id="spo-category" class="spo-input" value="general" placeholder="general、建筑…" /></label>
      <label class="spo-field spo-field--full"><span class="spo-field__lab">描述</span><textarea id="spo-desc" class="spo-textarea spo-textarea--sm" rows="2"></textarea></label>
    </div>
    <div class="spo-meta-actions">
      <button type="button" class="btn btn-danger btn--sm" id="spo-del">删除 / 下架</button>
    </div>
  </div>

  <div class="spo-card spo-card--list">
    <h3 class="spo-card__title">提示词列表</h3>
    <div class="spo-list-toolbar">
      <label class="spo-filter">
        <span class="spo-filter__lab">档位</span>
        <select id="spo-tier-filter" class="spo-select spo-select--narrow" aria-label="按档位筛选">
          <option value="all">全部</option>
          <option value="pro">PRO</option>
          <option value="free">基础 / 公开</option>
        </select>
      </label>
      <label class="spo-filter">
        <span class="spo-filter__lab">分类</span>
        <select id="spo-cat" class="spo-select spo-select--narrow" aria-label="按分类筛选"></select>
      </label>
      <input id="spo-q" class="spo-input spo-input--search" type="search" placeholder="搜索名称、ID、描述…" autocomplete="off" />
      <button type="button" class="btn btn-primary spo-refresh" id="spo-refresh">刷新</button>
    </div>
    <div class="spo-table-wrap">
      <table class="spo-table" aria-label="系统提示词条目">
        <thead>
          <tr>
            <th>名称</th>
            <th>ID</th>
            <th>描述</th>
            <th>分类</th>
            <th>档位</th>
            <th class="spo-th-actions">操作</th>
          </tr>
        </thead>
        <tbody id="spo-tbody"></tbody>
      </table>
      <div id="spo-empty" class="spo-empty" hidden>无匹配项（可调整分类 / 搜索词）</div>
    </div>
    <div class="spo-bottom-toolbar">
      <button type="button" class="btn" id="spo-clear">清空表单</button>
      <button type="button" class="btn" id="spo-copy-id">复制引用 ID</button>
      <button type="button" class="btn" id="spo-import-json">导入 JSON</button>
      <button type="button" class="btn" id="spo-blank">新增空白</button>
      <button type="button" class="btn btn-primary" id="spo-post-new">上传新增</button>
      <button type="button" class="btn btn-primary" id="spo-save">保存修改</button>
    </div>
    <input type="file" id="spo-import-file" class="spo-sr-only" accept=".json,application/json" tabindex="-1" aria-hidden="true" />
    <p class="spo-msg mono" id="spo-msg"></p>
  </div>
</section>`

    const q = (sel) => root.querySelector(sel)

    function readFileAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsText(file)
      })
    }

    function pickDefaultEntry(items) {
      const arr = items || []
      const byGlobal =
        arr.find((p) => /global/i.test(String(p.id || ''))) ||
        arr.find((p) => String(p.category || '').trim().toLowerCase() === 'global')
      return byGlobal || arr[0] || null
    }

    function truncateId(id) {
      const s = String(id || '')
      if (s.length <= 22) return s
      return s.slice(0, 10) + '…' + s.slice(-8)
    }

    function truncateDesc(d, max) {
      const n = max == null ? 56 : max
      const s = String(d || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (s.length <= n) return s
      return s.slice(0, n - 1) + '…'
    }

    function catOptionLabel(catKey) {
      return CAT_LABEL[catKey] || catKey
    }

    function countPromptsForCategory(label) {
      const n = String(label || '').trim()
      if (!n) return 0
      return list.filter((p) => U.normalizeCategoryLabel(p.category) === n).length
    }

    function hydrateSpoCatOrderFromList(savedOrder, prompts) {
      const used = new Set()
      for (const p of prompts || []) used.add(U.normalizeCategoryLabel(p.category))
      const order = Array.isArray(savedOrder) ? savedOrder : []
      const rows = []
      const seen = new Set()
      for (const c of order) {
        const k = String(c || '').trim()
        if (!k || seen.has(k)) continue
        seen.add(k)
        rows.push({ id: newRowId(), name: k, originalName: k })
      }
      const rest = Array.from(used)
        .filter((k) => !seen.has(k))
        .sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'))
      for (const k of rest) rows.push({ id: newRowId(), name: k, originalName: k })
      spoCatOrderRows = rows
    }

    function renderSpoCatOrderRows() {
      const host = q('#spo-cat-order-rows')
      if (!host) return
      host.innerHTML = ''
      spoCatOrderRows.forEach((row, idx) => {
        const wrap = document.createElement('div')
        wrap.className = 'im-cat-row'
        const move = document.createElement('div')
        move.className = 'im-cat-row__move'
        const btnUp = document.createElement('button')
        btnUp.type = 'button'
        btnUp.className = 'im-btn-ghost im-cat-row__movebtn'
        btnUp.textContent = '↑'
        btnUp.title = '上移'
        btnUp.disabled = idx <= 0
        btnUp.onclick = () => {
          if (idx <= 0) return
          const t = spoCatOrderRows[idx - 1]
          spoCatOrderRows[idx - 1] = spoCatOrderRows[idx]
          spoCatOrderRows[idx] = t
          renderSpoCatOrderRows()
          rebuildCategoryFilter()
        }
        const btnDown = document.createElement('button')
        btnDown.type = 'button'
        btnDown.className = 'im-btn-ghost im-cat-row__movebtn'
        btnDown.textContent = '↓'
        btnDown.title = '下移'
        btnDown.disabled = idx >= spoCatOrderRows.length - 1
        btnDown.onclick = () => {
          if (idx >= spoCatOrderRows.length - 1) return
          const t = spoCatOrderRows[idx + 1]
          spoCatOrderRows[idx + 1] = spoCatOrderRows[idx]
          spoCatOrderRows[idx] = t
          renderSpoCatOrderRows()
          rebuildCategoryFilter()
        }
        move.appendChild(btnUp)
        move.appendChild(btnDown)
        wrap.appendChild(move)
        const inp = document.createElement('input')
        inp.type = 'text'
        inp.className = 'im-input im-cat-row__input'
        inp.value = row.name
        inp.placeholder = '分类名（如 general、绘画）'
        inp.autocomplete = 'off'
        inp.addEventListener('input', () => {
          row.name = inp.value
          rebuildCategoryFilter()
        })
        wrap.appendChild(inp)
        const meta = document.createElement('span')
        meta.className = 'im-cat-row__meta'
        const key = String(row.originalName || '').trim() || String(row.name || '').trim()
        if (key) meta.textContent = `${countPromptsForCategory(key)} 条`
        wrap.appendChild(meta)
        const btnDel = document.createElement('button')
        btnDel.type = 'button'
        btnDel.className = 'im-btn-ghost im-cat-row__del'
        btnDel.textContent = '删除'
        btnDel.onclick = () => {
          if (spoCatOrderRows.length <= 1) {
            window.FlowidAdminToast('至少保留一个分类', true)
            return
          }
          const lab = String(row.originalName || row.name || '').trim()
          const n = lab ? countPromptsForCategory(lab) : 0
          if (
            n > 0 &&
            !window.confirm(
              `「${lab}」正被 ${n} 条提示词使用。保存后这些条目的分类将改为列表第一项。确定从列表移除？`,
            )
          ) {
            return
          }
          spoCatOrderRows = spoCatOrderRows.filter((r) => r.id !== row.id)
          renderSpoCatOrderRows()
          rebuildCategoryFilter()
        }
        wrap.appendChild(btnDel)
        host.appendChild(wrap)
      })
    }

    function itemsForCategorySource() {
      const tf = q('#spo-tier-filter').value
      if (tf === 'all') return list
      return list.filter((p) => U.normalizeTier(p.tier) === tf)
    }

    function rebuildCategoryFilter() {
      const sel = q('#spo-cat')
      const prev = sel.value || ALL
      const cats = new Set()
      for (const p of itemsForCategorySource()) cats.add(U.normalizeCategoryLabel(p.category))
      const fromRows = spoCatOrderRows.map((r) => String(r.name || '').trim()).filter(Boolean)
      const seen = new Set()
      const sorted = []
      for (const c of fromRows) {
        if (seen.has(c)) continue
        seen.add(c)
        sorted.push(c)
      }
      const rest = Array.from(cats)
        .filter((c) => !seen.has(c))
        .sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'))
      sorted.push(...rest)
      sel.innerHTML = ''
      const opt0 = document.createElement('option')
      opt0.value = ALL
      opt0.textContent = ALL
      sel.appendChild(opt0)
      for (const c of sorted) {
        const o = document.createElement('option')
        o.value = c
        o.textContent = catOptionLabel(c)
        sel.appendChild(o)
      }
      if ([ALL, ...sorted].includes(prev)) sel.value = prev
      else sel.value = ALL
    }

    function clearFieldsOnly() {
      q('#spo-id').value = ''
      q('#spo-name').value = ''
      q('#spo-version').value = '1.0.0'
      q('#spo-tier').value = 'pro'
      q('#spo-category').value = 'general'
      q('#spo-desc').value = ''
      q('#spo-body').value = ''
    }

    function clearForm() {
      selectedId = ''
      clearFieldsOnly()
      q('#spo-msg').textContent = '已清空。'
      renderList()
    }

    function visibleItems() {
      const tf = q('#spo-tier-filter').value
      const cat = q('#spo-cat').value || ALL
      const search = q('#spo-q').value
      return list.filter((p) => {
        if (tf !== 'all' && U.normalizeTier(p.tier) !== tf) return false
        if (cat !== ALL && U.normalizeCategoryLabel(p.category) !== cat) return false
        if (!U.itemMatchesSearch(p, search, ['id', 'name', 'description'])) return false
        return true
      })
    }

    function tierBadgeClass(tier) {
      return U.normalizeTier(tier) === 'pro' ? 'spo-badge spo-badge--pro' : 'spo-badge spo-badge--free'
    }

    function tierLabel(tier) {
      return U.normalizeTier(tier) === 'pro' ? 'PRO' : '基础'
    }

    function renderList() {
      const tbody = q('#spo-tbody')
      const emptyEl = q('#spo-empty')
      const table = q('.spo-table')
      const filtered = visibleItems()
      tbody.innerHTML = ''
      if (!filtered.length) {
        table.hidden = true
        emptyEl.hidden = false
        return
      }
      table.hidden = false
      emptyEl.hidden = true
      for (const p of filtered) {
        const tr = document.createElement('tr')
        tr.className = p.id === selectedId ? 'is-selected' : ''
        const desc = p.description || ''
        const descShort = truncateDesc(desc, 56)
        tr.innerHTML = `
          <td class="spo-td-name">${U.escapeHtml(p.name || p.id)}</td>
          <td class="mono spo-td-id" title="${U.escapeHtml(p.id)}">${U.escapeHtml(truncateId(p.id))}</td>
          <td class="spo-td-desc" title="${U.escapeHtml(desc)}">${U.escapeHtml(descShort)}</td>
          <td>${U.escapeHtml(U.normalizeCategoryLabel(p.category))}</td>
          <td><span class="${tierBadgeClass(p.tier)}">${U.escapeHtml(tierLabel(p.tier))}</span></td>
          <td class="spo-td-actions">
            <button type="button" class="btn btn--sm btn-primary spo-row-edit">编辑</button>
            <button type="button" class="btn btn--sm btn-danger spo-row-del">删除</button>
          </td>`
        tr.querySelector('.spo-row-edit').addEventListener('click', (e) => {
          e.stopPropagation()
          void selectOne(p.id)
        })
        tr.querySelector('.spo-row-del').addEventListener('click', (e) => {
          e.stopPropagation()
          void deleteOne(p.id)
        })
        tr.addEventListener('click', () => void selectOne(p.id))
        tbody.appendChild(tr)
      }
    }

    async function loadList() {
      const keep = selectedId
      const res = await api.get('/admin/system-prompts')
      list = res.prompts || []
      hydrateSpoCatOrderFromList(res.categoryOrder, list)
      renderSpoCatOrderRows()
      rebuildCategoryFilter()
      if (keep && list.some((p) => p.id === keep)) {
        await selectOne(keep)
      } else if (list.length) {
        const def = pickDefaultEntry(list)
        if (def) await selectOne(def.id)
      } else {
        selectedId = ''
        clearFieldsOnly()
        q('#spo-msg').textContent = '暂无提示词条目。'
        renderList()
      }
    }

    async function selectOne(id) {
      selectedId = id
      q('#spo-msg').textContent = '加载详情…'
      try {
        const d = await api.get('/admin/system-prompts/' + encodeURIComponent(id))
        q('#spo-id').value = d.id || ''
        q('#spo-name').value = d.name || ''
        q('#spo-version').value = d.version || '1.0.0'
        q('#spo-tier').value = U.normalizeTier(d.tier)
        q('#spo-category').value = d.category || 'general'
        q('#spo-desc').value = d.description || ''
        q('#spo-body').value = d.systemPromptText || ''
        q('#spo-msg').textContent = '已加载：' + id
        renderList()
      } catch (e) {
        q('#spo-msg').textContent = String(e.message || e)
        window.FlowidAdminToast(q('#spo-msg').textContent, true)
      }
    }

    async function deleteOne(id) {
      if (!id) return
      if (!U.confirmDanger('确定删除该提示词？')) return
      try {
        await api.delete('/admin/system-prompts/' + encodeURIComponent(id))
        window.FlowidAdminToast('已删除')
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spo-cat-order-add').onclick = () => {
      spoCatOrderRows.push({ id: newRowId(), name: '', originalName: '' })
      renderSpoCatOrderRows()
      rebuildCategoryFilter()
    }

    q('#spo-cat-order-save').onclick = async () => {
      const names = []
      const seen = new Set()
      for (const row of spoCatOrderRows) {
        const s = String(row.name || '').trim()
        if (!s) {
          window.FlowidAdminToast('请填写所有分类名称，或删除空行', true)
          return
        }
        if (seen.has(s)) {
          window.FlowidAdminToast('分类名称不能重复', true)
          return
        }
        seen.add(s)
        names.push(s)
      }
      const renames = []
      for (const row of spoCatOrderRows) {
        const nm = String(row.name || '').trim()
        const orig = String(row.originalName || '').trim()
        if (orig && nm && orig !== nm) renames.push({ from: orig, to: nm })
      }
      try {
        await api.put('/admin/system-prompt-categories', { categories: names, renames })
        window.FlowidAdminToast('分类已保存')
        spoCatOrderRows.forEach((r) => {
          r.originalName = String(r.name || '').trim()
        })
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spo-tier-filter').addEventListener('change', () => {
      rebuildCategoryFilter()
      renderList()
    })
    q('#spo-cat').addEventListener('change', () => renderList())
    q('#spo-q').addEventListener('input', () => renderList())

    q('#spo-clear').onclick = () => clearForm()

    q('#spo-copy-id').onclick = async () => {
      const id = q('#spo-id').value.trim()
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

    q('#spo-import-json').onclick = () => q('#spo-import-file').click()
    q('#spo-import-file').addEventListener('change', async () => {
      const inp = q('#spo-import-file')
      const file = inp.files && inp.files[0]
      inp.value = ''
      if (!file) return
      try {
        const text = await readFileAsText(file)
        let data
        try {
          data = JSON.parse(String(text || '').trim())
        } catch {
          throw new Error('JSON 解析失败')
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 应为单个对象')
        if (data.id != null) q('#spo-id').value = String(data.id).trim()
        if (data.name != null) q('#spo-name').value = String(data.name).trim()
        if (data.version != null) q('#spo-version').value = String(data.version).trim() || '1.0.0'
        if (data.category != null) q('#spo-category').value = String(data.category).trim() || 'general'
        if (data.tier != null) q('#spo-tier').value = U.normalizeTier(data.tier)
        if (data.description != null) q('#spo-desc').value = String(data.description)
        if (data.systemPromptText != null) q('#spo-body').value = String(data.systemPromptText)
        selectedId = ''
        q('#spo-msg').textContent = '已从「' + file.name + '」导入，请检查后「上传新增」或先选择条目再保存。'
        window.FlowidAdminToast('已导入 JSON')
        renderList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    })

    q('#spo-blank').onclick = () => {
      selectedId = ''
      q('#spo-id').value = ''
      q('#spo-name').value = '未命名提示词'
      q('#spo-version').value = '1.0.0'
      q('#spo-tier').value = 'pro'
      q('#spo-category').value = 'general'
      q('#spo-desc').value = ''
      q('#spo-body').value = ''
      q('#spo-msg').textContent = '已准备空白条目：编辑正文后点「上传新增」。'
      renderList()
    }

    q('#spo-refresh').onclick = async () => {
      try {
        await loadList()
        window.FlowidAdminToast('列表已刷新')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spo-post-new').onclick = async () => {
      try {
        const text = q('#spo-body').value.trim()
        if (!q('#spo-name').value.trim()) throw new Error('名称不能为空')
        if (!text) throw new Error('正文不能为空')
        await api.post('/admin/system-prompts/upload', {
          id: q('#spo-id').value.trim() || undefined,
          name: q('#spo-name').value.trim(),
          version: q('#spo-version').value.trim() || '1.0.0',
          category: q('#spo-category').value.trim() || 'general',
          tier: U.normalizeTier(q('#spo-tier').value),
          description: q('#spo-desc').value.trim(),
          systemPromptText: text,
        })
        window.FlowidAdminToast('已新增提示词')
        clearForm()
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spo-save').onclick = async () => {
      const id = q('#spo-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('请先选择列表中的条目，或导入/新建后使用「上传新增」', true)
        return
      }
      try {
        const body = {
          name: q('#spo-name').value.trim(),
          version: q('#spo-version').value.trim() || '1.0.0',
          category: q('#spo-category').value.trim() || 'general',
          tier: U.normalizeTier(q('#spo-tier').value),
          description: q('#spo-desc').value.trim(),
        }
        const t = q('#spo-body').value
        if (t.trim()) body.systemPromptText = t
        await api.put('/admin/system-prompts/' + encodeURIComponent(id), body)
        window.FlowidAdminToast('已保存（后端已重算签名）')
        await loadList()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    q('#spo-del').onclick = () => {
      const id = q('#spo-id').value.trim()
      if (!id) {
        window.FlowidAdminToast('无选中项', true)
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
