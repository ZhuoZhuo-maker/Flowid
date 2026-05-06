;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi

  function newRowId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    return `r-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result || ''))
      fr.onerror = () => reject(new Error('读取图片失败'))
      fr.readAsDataURL(file)
    })
  }

  window.FlowidAdminPanelInspirationMarket = async function (root) {
    root.innerHTML = `
      <div class="im-root">
        <header class="im-hero">
          <p class="im-hero__eyebrow">Inspiration gallery</p>
          <h1 class="im-hero__title">灵感市集</h1>
          <p class="im-hero__sub">管理提示词模板与封面，右侧为客户端卡片预览。</p>
        </header>

        <section class="im-card im-cats" aria-labelledby="im-cats-h">
          <h2 id="im-cats-h" class="im-cats__title">分类标签</h2>
          <p class="im-cats__hint">
            在此添加、删除或改名；保存后客户端「灵感市集」筛选与条目分类会同步。若新增标签，请先保存本区再在下拉框中为条目选择该分类。删除列表中的某标签并保存后，仍使用该标签的条目会自动归入「其它」（若无「其它」则归入列表第一项）。
          </p>
          <div id="im-cat-rows" class="im-cat-rows"></div>
          <div class="im-cats__actions">
            <button type="button" class="im-btn-ghost" id="im-cat-add">+ 添加标签</button>
            <button type="button" class="im-btn-primary" id="im-cat-save">保存分类</button>
          </div>
        </section>

        <section class="im-card im-editor">
          <div class="im-editor__grid">
            <div class="im-editor__form">
              <div class="im-field">
                <span>标题</span>
                <input type="text" id="im-title" class="im-input" autocomplete="off" placeholder="展示标题" />
              </div>
              <div class="im-field">
                <span>分类</span>
                <select id="im-cat" class="im-select"></select>
              </div>
              <div class="im-field">
                <span>简介</span>
                <textarea id="im-desc" class="im-textarea" rows="3" placeholder="卡片上的短介绍"></textarea>
              </div>
              <div class="im-field">
                <span>提示词正文</span>
                <textarea id="im-prompt" class="im-textarea im-textarea--tall" placeholder="用户端可见全文"></textarea>
              </div>
              <div class="im-field">
                <span>内部 ID（可选，留空则创建时自动生成）</span>
                <input type="text" id="im-id" class="im-input" autocomplete="off" placeholder="uuid 或英文标识" />
              </div>
              <div class="im-field">
                <span>封面图</span>
                <input type="file" id="im-file" accept="image/png,image/jpeg,image/webp,image/gif" class="visually-hidden" />
                <div class="im-dropzone" id="im-dropzone" tabindex="0" role="button" aria-label="上传封面，支持点击或拖拽">
                  <p class="im-dropzone__hint">点击或拖拽图片到此处</p>
                  <p class="im-dropzone__sub">PNG / JPG / WebP / GIF · 新建必填 · 编辑时可选更新</p>
                  <img id="im-local-thumb" class="im-thumb" alt="" />
                </div>
              </div>
              <div class="im-actions">
                <button type="button" class="im-btn-primary" id="im-save">保存</button>
                <button type="button" class="im-btn-ghost" id="im-reset">清空表单</button>
              </div>
            </div>
            <div class="im-editor__preview im-preview-wrap">
              <p class="im-preview-label">实时预览</p>
              <div class="im-preview-card" id="im-preview-card">
                <div class="im-preview-card__media">
                  <img id="im-pr-img" alt="" style="display:none" />
                  <div class="im-preview-card__placeholder" id="im-pr-ph">🎨</div>
                  <div class="im-preview-card__badge" id="im-pr-cat">分类</div>
                </div>
                <div class="im-preview-card__body">
                  <h3 class="im-preview-card__title" id="im-pr-title">未命名条目</h3>
                  <p class="im-preview-card__desc" id="im-pr-desc">简介将显示在这里。</p>
                  <div class="im-preview-card__prompt" id="im-pr-snippet"></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="im-card im-toolbar">
          <div class="im-toolbar__left">
            <button type="button" class="btn btn-primary" id="im-refresh">刷新</button>
            <span class="im-toolbar__meta mono" id="imsg-list"></span>
          </div>
          <div class="im-toolbar__right">
            <select id="im-sort" class="im-select im-sort" title="排序">
              <option value="updated_desc">更新时间 ↓</option>
              <option value="updated_asc">更新时间 ↑</option>
              <option value="title_asc">标题 A→Z</option>
            </select>
            <input type="search" id="im-q" class="im-input im-search" placeholder="搜索标题 / 简介 / id" />
          </div>
        </section>

        <div id="im-gallery" class="im-gallery" aria-label="灵感条目列表"></div>
      </div>
      <style>
        .visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      </style>`

    const catEl = root.querySelector('#im-cat')
    const msgList = root.querySelector('#imsg-list')
    const listEl = root.querySelector('#im-gallery')
    const dropzone = root.querySelector('#im-dropzone')
    const fileInput = root.querySelector('#im-file')
    const localThumb = root.querySelector('#im-local-thumb')
    const prImg = root.querySelector('#im-pr-img')
    const prPh = root.querySelector('#im-pr-ph')
    const prTitle = root.querySelector('#im-pr-title')
    const prCat = root.querySelector('#im-pr-cat')
    const prDesc = root.querySelector('#im-pr-desc')
    const prSnip = root.querySelector('#im-pr-snippet')
    const sortEl = root.querySelector('#im-sort')

    let categories = ['UI', '海报', '角色', '场景', '产品', '其它']
    /** @type {{ id: string, name: string, originalName: string }[]} */
    let catRows = []
    let cache = []
    /** 当前编辑的条目 id；空表示新建 */
    let editingId = ''
    /** 用户新选的封面 data URL，未选则为空 */
    let pickedDataUrl = ''

    function countItemsForCategory(label) {
      const n = String(label || '').trim()
      if (!n) return 0
      return cache.filter((r) => String(r.category || '').trim() === n).length
    }

    function hydrateCatRowsFromServer(list) {
      const arr = Array.isArray(list) && list.length ? list : categories
      catRows = arr.map((name) => ({
        id: newRowId(),
        name: String(name || '').trim(),
        originalName: String(name || '').trim(),
      }))
      renderCatRows()
    }

    function renderCatRows() {
      const host = root.querySelector('#im-cat-rows')
      if (!host) return
      host.innerHTML = ''
      catRows.forEach((row) => {
        const wrap = document.createElement('div')
        wrap.className = 'im-cat-row'
        const inp = document.createElement('input')
        inp.type = 'text'
        inp.className = 'im-input im-cat-row__input'
        inp.value = row.name
        inp.placeholder = '标签名称'
        inp.autocomplete = 'off'
        inp.addEventListener('input', () => {
          row.name = inp.value
          fillCats()
          syncPreview()
        })
        const meta = document.createElement('span')
        meta.className = 'im-cat-row__meta'
        const key = String(row.originalName || '').trim() || String(row.name || '').trim()
        if (key) meta.textContent = `${countItemsForCategory(key)} 条`
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'im-btn-ghost im-cat-row__del'
        btn.textContent = '删除'
        btn.onclick = () => {
          if (catRows.length <= 1) {
            window.FlowidAdminToast('至少保留一个分类', true)
            return
          }
          const lab = String(row.originalName || row.name || '').trim()
          const n = lab ? countItemsForCategory(lab) : 0
          if (
            n > 0 &&
            !window.confirm(
              `「${lab}」正被 ${n} 条条目使用。从列表移除并在之后点击「保存分类」后，这些条目将归入「其它」或当前列表首项。确定删除该标签？`,
            )
          ) {
            return
          }
          catRows = catRows.filter((r) => r.id !== row.id)
          renderCatRows()
          fillCats()
          syncPreview()
        }
        wrap.appendChild(inp)
        wrap.appendChild(meta)
        wrap.appendChild(btn)
        host.appendChild(wrap)
      })
    }

    function fillCats() {
      if (!catEl) return
      const prev = catEl.value
      const merged = []
      const seen = new Set()
      for (const x of catRows.map((r) => String(r.name || '').trim()).concat(categories)) {
        const s = String(x || '').trim()
        if (!s || seen.has(s)) continue
        seen.add(s)
        merged.push(s)
      }
      catEl.innerHTML = ''
      for (const c of merged) {
        const o = document.createElement('option')
        o.value = c
        o.textContent = c
        catEl.appendChild(o)
      }
      if (prev && merged.includes(prev)) catEl.value = prev
    }

    function syncPreview() {
      const title = String(root.querySelector('#im-title')?.value || '').trim()
      const desc = String(root.querySelector('#im-desc')?.value || '').trim()
      const prompt = String(root.querySelector('#im-prompt')?.value || '').trim()
      const cat = String(catEl?.value || '其它')
      prTitle.textContent = title || '未命名条目'
      prCat.textContent = cat
      prDesc.textContent = desc || '（暂无简介）'
      const sn = prompt.replace(/\s+/g, ' ').slice(0, 140)
      prSnip.textContent = sn ? `正文预览 · ${sn}${prompt.length > 140 ? '…' : ''}` : '（暂无正文）'

      const showLocal = Boolean(pickedDataUrl)
      const showServer = Boolean(editingId) && !showLocal
      prImg.onerror = null
      if (showLocal) {
        prImg.src = pickedDataUrl
        prImg.style.display = 'block'
        prPh.style.display = 'none'
      } else if (showServer) {
        prImg.src = `/inspiration-market/image/${encodeURIComponent(editingId)}?t=${Date.now()}`
        prImg.style.display = 'block'
        prPh.style.display = 'none'
        prImg.onerror = function () {
          prImg.style.display = 'none'
          prPh.style.display = 'flex'
          prPh.textContent = '📷'
        }
      } else {
        prImg.removeAttribute('src')
        prImg.style.display = 'none'
        prPh.style.display = 'flex'
        prPh.textContent = '🎨'
      }
    }

    function setPickedFile(file) {
      if (!file) return
      void readFileAsDataUrl(file).then((url) => {
        pickedDataUrl = url
        localThumb.src = url
        localThumb.classList.add('is-on')
        syncPreview()
      })
    }

    function resetForm() {
      editingId = ''
      pickedDataUrl = ''
      localThumb.removeAttribute('src')
      localThumb.classList.remove('is-on')
      const idInput = root.querySelector('#im-id')
      const title = root.querySelector('#im-title')
      const desc = root.querySelector('#im-desc')
      const prompt = root.querySelector('#im-prompt')
      if (idInput) {
        idInput.removeAttribute('disabled')
        idInput.value = ''
      }
      if (title) title.value = ''
      if (desc) desc.value = ''
      if (prompt) prompt.value = ''
      if (fileInput) fileInput.value = ''
      syncPreview()
    }

    function sortRows(rows) {
      const mode = String(sortEl?.value || 'updated_desc')
      const arr = rows.slice()
      arr.sort((a, b) => {
        const ta = String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN')
        const ua = Number(a.updatedAtMs || 0)
        const ub = Number(b.updatedAtMs || 0)
        if (mode === 'updated_asc') return ua - ub
        if (mode === 'updated_desc') return ub - ua
        if (mode === 'title_asc') return ta
        return ub - ua
      })
      return arr
    }

    function getFiltered() {
      const q = String(root.querySelector('#im-q')?.value || '')
        .trim()
        .toLowerCase()
      let rows = cache.slice()
      if (q) {
        rows = rows.filter((r) => {
          const hay = [r.id, r.title, r.description, r.category].join(' ').toLowerCase()
          return hay.includes(q)
        })
      }
      return sortRows(rows)
    }

    function renderList() {
      const rows = getFiltered()
      listEl.innerHTML = ''
      if (!cache.length) {
        const empty = document.createElement('div')
        empty.className = 'im-gallery__empty'
        empty.innerHTML = '<span>🎨</span>暂无条目，可在上方创建第一条灵感模板。'
        listEl.appendChild(empty)
        return
      }
      if (!rows.length) {
        const empty = document.createElement('div')
        empty.className = 'im-gallery__empty'
        empty.innerHTML = '<span>🔍</span>没有匹配的条目，请调整搜索或排序。'
        listEl.appendChild(empty)
        return
      }
      rows.forEach((r) => {
        const card = document.createElement('article')
        card.className = 'im-gallery-card'
        const media = document.createElement('div')
        media.className = 'im-gallery-card__media'
        const img = document.createElement('img')
        img.alt = ''
        img.loading = 'lazy'
        img.src = `/inspiration-market/image/${encodeURIComponent(r.id)}?t=${Number(r.updatedAtMs) || 0}`
        const ph = document.createElement('div')
        ph.className = 'im-gallery-card__ph'
        ph.textContent = '📷'
        ph.style.display = 'none'
        img.onerror = function () {
          img.style.display = 'none'
          ph.style.display = 'flex'
        }
        media.appendChild(img)
        media.appendChild(ph)
        const body = document.createElement('div')
        body.className = 'im-gallery-card__body'
        const h = document.createElement('h3')
        h.className = 'im-gallery-card__title'
        h.textContent = r.title || r.id
        const p = document.createElement('p')
        p.className = 'im-gallery-card__desc'
        p.textContent = r.description || '（无简介）'
        const meta = document.createElement('div')
        meta.className = 'im-gallery-card__meta'
        meta.textContent = `${r.category || ''} · 更新 ${U.fmt(r.updatedAtMs)}`
        body.appendChild(h)
        body.appendChild(p)
        body.appendChild(meta)
        const actions = document.createElement('div')
        actions.className = 'im-gallery-card__actions'
        const btnEd = document.createElement('button')
        btnEd.type = 'button'
        btnEd.className = 'im-icon-btn'
        btnEd.innerHTML = '✏️ 编辑'
        btnEd.onclick = () => {
          void loadOne(r.id)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
        const btnDel = document.createElement('button')
        btnDel.type = 'button'
        btnDel.className = 'im-icon-btn im-icon-btn--danger'
        btnDel.innerHTML = '🗑 删除'
        btnDel.onclick = async () => {
          if (!U.confirmDanger(`确定删除「${r.title || r.id}」？\n磁盘上的封面与提示词文件将一并删除，且不可恢复。`)) return
          try {
            await api.delete(`/admin/inspiration-market/${encodeURIComponent(r.id)}`)
            window.FlowidAdminToast('已删除')
            if (editingId === r.id) resetForm()
            await refresh()
          } catch (e) {
            window.FlowidAdminToast(String(e.message || e), true)
          }
        }
        actions.appendChild(btnEd)
        actions.appendChild(btnDel)
        card.appendChild(media)
        card.appendChild(body)
        card.appendChild(actions)
        listEl.appendChild(card)
      })
    }

    async function refresh() {
      msgList.textContent = '加载中…'
      listEl.innerHTML = ''
      try {
        const res = await api.get('/admin/inspiration-market')
        categories = Array.isArray(res.categories) && res.categories.length ? res.categories : categories
        hydrateCatRowsFromServer(categories)
        fillCats()
        cache = res.items || []
        msgList.textContent = `共 ${res.total || 0} 条 · ${U.fmt(res.serverTimeMs)}`
        renderList()
      } catch (e) {
        msgList.textContent = String(e.message || e)
        window.FlowidAdminToast(msgList.textContent, true)
        listEl.innerHTML = ''
      }
    }

    async function loadOne(id) {
      try {
        const res = await api.get(`/admin/inspiration-market/${encodeURIComponent(id)}`)
        const it = res.item
        if (!it) return
        editingId = id
        pickedDataUrl = ''
        localThumb.removeAttribute('src')
        localThumb.classList.remove('is-on')
        const idInput = root.querySelector('#im-id')
        const title = root.querySelector('#im-title')
        const desc = root.querySelector('#im-desc')
        const prompt = root.querySelector('#im-prompt')
        if (idInput) {
          idInput.value = it.id
          idInput.setAttribute('disabled', 'disabled')
        }
        if (title) title.value = it.title || ''
        if (desc) desc.value = it.description || ''
        if (prompt) prompt.value = it.promptText || ''
        if (catEl) catEl.value = it.category || '其它'
        if (fileInput) fileInput.value = ''
        syncPreview()
        window.FlowidAdminToast('已载入编辑，修改后点击保存')
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    ;['#im-title', '#im-desc', '#im-prompt'].forEach((sel) => {
      const el = root.querySelector(sel)
      if (el) el.addEventListener('input', () => syncPreview())
    })
    if (catEl) catEl.addEventListener('change', () => syncPreview())

    dropzone.addEventListener('click', () => fileInput.click())
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fileInput.click()
      }
    })
    ;['dragenter', 'dragover'].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault()
        dropzone.classList.add('im-dropzone--active')
      })
    })
    ;['dragleave', 'drop'].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault()
        if (ev === 'dragleave') dropzone.classList.remove('im-dropzone--active')
      })
    })
    dropzone.addEventListener('drop', (e) => {
      dropzone.classList.remove('im-dropzone--active')
      const f = e.dataTransfer?.files?.[0]
      if (f && /^image\//u.test(f.type)) setPickedFile(f)
    })
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0]
      if (f) setPickedFile(f)
    })

    root.querySelector('#im-cat-add').onclick = () => {
      catRows.push({ id: newRowId(), name: '', originalName: '' })
      renderCatRows()
      fillCats()
    }
    root.querySelector('#im-cat-save').onclick = async () => {
      const names = []
      const seen = new Set()
      for (const row of catRows) {
        const s = String(row.name || '').trim()
        if (!s) {
          window.FlowidAdminToast('请填写所有标签名称，或删除空行', true)
          return
        }
        if (seen.has(s)) {
          window.FlowidAdminToast('分类标签不能重复', true)
          return
        }
        seen.add(s)
        names.push(s)
      }
      const renames = []
      for (const row of catRows) {
        const nm = String(row.name || '').trim()
        const orig = String(row.originalName || '').trim()
        if (orig && nm && orig !== nm) renames.push({ from: orig, to: nm })
      }
      try {
        await api.put('/admin/inspiration-market/categories', { categories: names, renames })
        window.FlowidAdminToast('分类已保存')
        catRows.forEach((r) => {
          r.originalName = String(r.name || '').trim()
        })
        await refresh()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    root.querySelector('#im-refresh').onclick = () => void refresh()
    root.querySelector('#im-reset').onclick = () => {
      resetForm()
      window.FlowidAdminToast('表单已清空')
    }
    root.querySelector('#im-q').addEventListener('input', () => renderList())
    sortEl.addEventListener('change', () => renderList())

    root.querySelector('#im-save').onclick = async () => {
      const idInput = root.querySelector('#im-id')
      const title = String(root.querySelector('#im-title')?.value || '').trim()
      const description = String(root.querySelector('#im-desc')?.value || '')
      const promptText = String(root.querySelector('#im-prompt')?.value || '').trim()
      const category = String(catEl?.value || '其它')
      const file = fileInput?.files?.[0] || null
      if (!title) {
        window.FlowidAdminToast('请填写标题', true)
        return
      }
      if (!promptText) {
        window.FlowidAdminToast('请填写提示词正文', true)
        return
      }
      try {
        let imageBase64 = ''
        if (file) imageBase64 = await readFileAsDataUrl(file)
        else if (pickedDataUrl) imageBase64 = pickedDataUrl
        const idVal = String(idInput?.value || '').trim()
        if (editingId) {
          const body = { title, description, category, promptText }
          if (imageBase64) body.imageBase64 = imageBase64
          await api.put(`/admin/inspiration-market/${encodeURIComponent(editingId)}`, body)
          window.FlowidAdminToast('已更新')
        } else {
          if (!imageBase64) {
            window.FlowidAdminToast('新建必须上传封面图', true)
            return
          }
          await api.post('/admin/inspiration-market', {
            id: idVal || undefined,
            title,
            description,
            category,
            promptText,
            imageBase64,
          })
          window.FlowidAdminToast('已创建')
        }
        resetForm()
        await refresh()
      } catch (e) {
        window.FlowidAdminToast(String(e.message || e), true)
      }
    }

    hydrateCatRowsFromServer(categories)
    fillCats()
    syncPreview()
    await refresh()
  }
})()
