;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi
  const state = window.FlowidAdminState

  const sel = { codes: new Set() }

  function normalizeText(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
  }

  const DAY_MS = 24 * 60 * 60 * 1000

  /** @returns {{ dot: string, label: string }} */
  function licenseExpiryUi(r) {
    if (r.frozen) return { dot: 'lic-dot--muted', label: '冻结' }
    const ex = Number(r.expiresAtMs || 0)
    const now = Date.now()
    if (!Number.isFinite(ex) || ex <= 0) return { dot: 'lic-dot--warn', label: '未知' }
    if (ex < now) return { dot: 'lic-dot--bad', label: '已过期' }
    if (ex < now + 7 * DAY_MS) return { dot: 'lic-dot--warn', label: '快到期' }
    return { dot: 'lic-dot--ok', label: '有效' }
  }

  function maskHash(s) {
    const t = String(s || '').trim()
    if (!t) return '—'
    if (t.length <= 14) return '••••'
    return `${t.slice(0, 6)}…${t.slice(-4)}`
  }

  function maskMachine(s) {
    const t = String(s || '').trim()
    if (!t || t === '-') return '—'
    if (t.length <= 10) return '••••'
    return `${t.slice(0, 4)}…${t.slice(-3)}`
  }

  function entSummary(ent) {
    try {
      const o = ent && typeof ent === 'object' ? ent : {}
      const tier = String(o.tier || o.plan || o.level || '').trim()
      if (tier) return tier
      const raw = U.safeJsonStringify(ent || {})
      if (raw.length <= 28) return raw
      return `${raw.slice(0, 25)}…`
    } catch {
      return '—'
    }
  }

  function paginate(items, page, pageSize) {
    const size = Math.max(5, Math.min(200, Math.floor(Number(pageSize || 30) || 30)))
    const total = items.length
    const totalPages = Math.max(1, Math.ceil(total / size))
    const p = Math.max(0, Math.min(totalPages - 1, Math.floor(Number(page || 0) || 0)))
    const start = p * size
    return { page: p, pageSize: size, total, totalPages, items: items.slice(start, start + size) }
  }

  function svcCard(dotClass, label, value, sub) {
    return `<article class="lic-svc-card">
      <header class="lic-svc-card__hd">
        <span class="lic-svc-dot ${dotClass}" aria-hidden="true"></span>
        <span class="lic-svc-card__label">${U.escapeHtml(label)}</span>
      </header>
      <div class="lic-svc-card__val">${U.escapeHtml(value)}</div>
      ${sub ? `<div class="lic-svc-card__sub">${U.escapeHtml(sub)}</div>` : ''}
    </article>`
  }

  async function loadServiceCards(host) {
    if (!host) return
    host.innerHTML = `<div class="lic-svc-grid">${svcCard('lic-svc-dot--neutral', '加载中', '请稍候', '正在探测服务状态')}</div>`

    let healthOk = false
    let healthSub = ''
    try {
      const h = await api.get('/healthz')
      healthOk = Boolean(h && h.ok)
      healthSub = String(h?.service || 'flowid-auth-server')
    } catch (e) {
      healthOk = false
      healthSub = String(e.message || e).slice(0, 80)
    }

    const token = state.getAdminToken()
    const envOk = Boolean(token)
    const envLabel = envOk ? '已配置' : '未填写'
    const envSub = envOk ? '本机已保存 x-admin-token' : '开发环境可留空；生产请务必填写'

    const scanDot = 'lic-svc-dot--warn'
    const scanVal = '未接入'
    const scanSub = '漏洞扫描需对接 CI/镜像；当前后端未上报'

    let proxyOk = false
    let proxyVal = '异常'
    let proxySub = ''
    try {
      await api.post('/proxy/openai', {
        url: 'https://dashscope.aliyuncs.com/',
        method: 'GET',
        headers: { Accept: 'application/json' },
        json: null,
      })
      proxyOk = true
      proxyVal = '已启用'
      proxySub = '代理入口与白名单探测成功'
    } catch (e) {
      const m = String(e.message || e)
      if (m.includes('Proxy target not allowed')) {
        proxyOk = false
        proxyVal = '拒绝'
        proxySub = '白名单未放行该目标'
      } else if (/^HTTP \d+/u.test(m)) {
        proxyOk = true
        proxyVal = '已启用'
        proxySub = '入口可达（上游非 2xx 视为探测成功）'
      } else {
        proxyOk = false
        proxyVal = '异常'
        proxySub = m.slice(0, 72)
      }
    }

    host.innerHTML = `<div class="lic-svc-grid">
      ${svcCard(healthOk ? 'lic-svc-dot--ok' : 'lic-svc-dot--bad', '健康检查', healthOk ? '正常' : '异常', healthSub)}
      ${svcCard(scanDot, '漏洞扫描', scanVal, scanSub)}
      ${svcCard(envOk ? 'lic-svc-dot--ok' : 'lic-svc-dot--warn', '环境配置检测', envLabel, envSub)}
      ${svcCard(proxyOk ? 'lic-svc-dot--ok' : 'lic-svc-dot--bad', '代理状态', proxyOk ? '已启用' : '未启用 / 异常', proxySub)}
    </div>`
  }

  function renderLicenses(container) {
    const tbody = container.querySelector('#lic-tbody')
    const msgEl = container.querySelector('#lic-msg')
    const qEl = container.querySelector('#lic-q')
    const sizeEl = container.querySelector('#lic-size')
    const prevEl = container.querySelector('#lic-prev')
    const nextEl = container.querySelector('#lic-next')
    const pageInfoEl = container.querySelector('#lic-page')
    const sortEl = container.querySelector('#lic-sort')
    const selAllEl = container.querySelector('#lic-sel-all')
    const selInfoEl = container.querySelector('#lic-sel-info')
    const bulkFreezeEl = container.querySelector('#lic-bulk-freeze')
    const bulkUnfreezeEl = container.querySelector('#lic-bulk-unfreeze')
    const bulkUnbindEl = container.querySelector('#lic-bulk-unbind')
    const bulkDeleteEl = container.querySelector('#lic-bulk-delete')
    let page = 0
    let cache = []

    if (!tbody || !msgEl) return

    function updateBulkState() {
      const count = sel.codes.size
      if (selInfoEl) selInfoEl.textContent = count ? `已选 ${count} 条` : '未选择'
      const dis = count <= 0
      if (bulkFreezeEl) bulkFreezeEl.disabled = dis
      if (bulkUnfreezeEl) bulkUnfreezeEl.disabled = dis
      if (bulkUnbindEl) bulkUnbindEl.disabled = dis
      if (bulkDeleteEl) bulkDeleteEl.disabled = dis
    }

    async function refresh() {
      msgEl.textContent = '加载中…'
      tbody.innerHTML = ''
      try {
        const res = await api.get('/admin/licenses')
        msgEl.textContent = `共 ${res.total} 条 · 服务器时间 ${U.fmt(res.serverTimeMs)}`
        cache = res.licenses || []
        if (!cache.length) {
          tbody.innerHTML =
            '<tr><td colspan="9" class="lic-table__empty">暂无 JWT 授权记录</td></tr>'
          if (selAllEl) {
            selAllEl.indeterminate = false
            selAllEl.checked = false
          }
          updateBulkState()
          return
        }
        render()
      } catch (e) {
        msgEl.textContent = String(e.message || e)
        window.FlowidAdminToast(msgEl.textContent, true)
        tbody.innerHTML = `<tr><td colspan="9" class="lic-table__empty">${U.escapeHtml(
          String(e.message || e),
        )}</td></tr>`
      }
    }

    function getFilteredSorted() {
      const q = normalizeText(qEl ? qEl.value : '')
      const sort = sortEl ? String(sortEl.value || 'created_desc') : 'created_desc'
      const rows = (cache || []).slice()
      rows.sort((a, b) => {
        const ac = Number(a.createdAtMs || 0)
        const bc = Number(b.createdAtMs || 0)
        const ae = Number(a.expiresAtMs || 0)
        const be = Number(b.expiresAtMs || 0)
        if (sort === 'expires_asc') return ae - be
        if (sort === 'expires_desc') return be - ae
        if (sort === 'created_asc') return ac - bc
        return bc - ac
      })
      if (!q) return rows
      return rows.filter((r) => {
        const hay = [
          r.id,
          r.codeHash,
          r.boundMachineId,
          U.safeJsonStringify(r.entitlements || {}),
          String(r.frozen ? 'frozen' : 'active'),
        ]
          .map(normalizeText)
          .join(' ')
        return hay.includes(q)
      })
    }

    function wireRow(tr, r, hash) {
      const selBox = tr.querySelector('[data-a="sel"]')
      if (selBox) {
        selBox.addEventListener('change', () => {
          if (!hash) return
          if (selBox.checked) sel.codes.add(hash)
          else sel.codes.delete(hash)
          updateBulkState()
        })
      }

      const bind = (sel, fn) => {
        const el = tr.querySelector(sel)
        if (el) el.addEventListener('click', fn)
      }

      bind('[data-a="copy"]', async () => {
        if (!hash) return
        try {
          await navigator.clipboard.writeText(hash)
          window.FlowidAdminToast('已复制完整 codeHash')
        } catch {
          window.alert('复制失败：\n' + hash)
        }
      })

      bind('[data-a="reissue"]', async () => {
        if (!hash) return
        if (!U.confirmDanger('确定重新签发一个新的授权码并复制吗？\n（旧授权码将永久失效；新码会清空机器绑定并解除冻结）')) return
        try {
          const res = await api.post('/admin/licenses/reissue', { codeHash: hash })
          const code = String(res.licenseCode || '').trim()
          if (code) {
            await navigator.clipboard.writeText(code)
            window.FlowidAdminToast('新授权码已复制，可直接发给用户')
          } else {
            window.FlowidAdminToast('已重签，但未返回新码', true)
          }
          sel.codes.delete(hash)
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })

      bind('[data-a="renew"]', async () => {
        if (!hash) return
        const raw = window.prompt('续期天数（正整数）', '30')
        const days = Math.floor(Number(raw || 0))
        if (!Number.isFinite(days) || days <= 0) return
        try {
          await api.post('/admin/licenses/renew', { codeHash: hash, days })
          window.FlowidAdminToast('续期成功')
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })

      bind('[data-a="freeze"]', async () => {
        if (!hash) return
        try {
          await api.post('/admin/licenses/freeze', { codeHash: hash, frozen: !r.frozen })
          window.FlowidAdminToast('已更新冻结状态')
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })

      bind('[data-a="unbind"]', async () => {
        if (!hash) return
        if (!U.confirmDanger('确定解绑该授权的机器码绑定吗？解绑后该码可被重新绑定到任意设备。')) return
        try {
          await api.post('/admin/licenses/unbind', { codeHash: hash })
          window.FlowidAdminToast('已解绑')
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })

      bind('[data-a="ent"]', async () => {
        if (!hash) return
        const raw = window.prompt('输入 entitlements JSON', U.safeJsonStringify(r.entitlements || {}))
        if (!raw) return
        const obj = U.safeJsonParse(raw, null)
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          window.FlowidAdminToast('必须是 JSON 对象', true)
          return
        }
        try {
          await api.post('/admin/licenses/entitlements', { codeHash: hash, entitlements: obj })
          window.FlowidAdminToast('权益已更新')
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })

      bind('[data-a="del"]', async () => {
        if (!hash) return
        if (!U.confirmDanger('确定删除该授权码记录吗？\n（删除后该授权码将永久失效，且无法恢复）')) return
        try {
          await api.post('/admin/licenses/delete', { codeHash: hash })
          sel.codes.delete(hash)
          window.FlowidAdminToast('已删除授权码')
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })
    }

    function render() {
      const filtered = getFilteredSorted()
      const paged = paginate(filtered, page, sizeEl ? sizeEl.value : 30)
      page = paged.page
      if (pageInfoEl) pageInfoEl.textContent = `第 ${paged.page + 1} / ${paged.totalPages} 页 · 共 ${paged.total} 条`
      if (prevEl) prevEl.disabled = paged.page <= 0
      if (nextEl) nextEl.disabled = paged.page >= paged.totalPages - 1

      tbody.innerHTML = ''
      if (!paged.items.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="lic-table__empty">没有匹配的数据</td></tr>'
        if (selAllEl) {
          selAllEl.indeterminate = false
          selAllEl.checked = false
        }
        updateBulkState()
        return
      }

      const visibleHashes = paged.items.map((x) => String(x.codeHash || '').trim()).filter(Boolean)
      const checkedCount = visibleHashes.filter((h) => sel.codes.has(h)).length
      if (selAllEl) {
        selAllEl.indeterminate = checkedCount > 0 && checkedCount < visibleHashes.length
        selAllEl.checked = visibleHashes.length > 0 && checkedCount === visibleHashes.length
      }

      for (const r of paged.items) {
        const hash = String(r.codeHash || '').trim()
        const isChecked = Boolean(hash && sel.codes.has(hash))
        const st = licenseExpiryUi(r)
        const mid = String(r.boundMachineId || '').trim()
        const tr = document.createElement('tr')
        tr.innerHTML = `
          <td class="lic-td-check">
            <input type="checkbox" data-a="sel" ${isChecked ? 'checked' : ''} ${hash ? '' : 'disabled'} aria-label="选择该行" />
          </td>
          <td class="mono lic-td-id">${U.escapeHtml(String(r.id || ''))}</td>
          <td class="mono lic-mono-fade" title="${U.escapeHtml(hash)}">${U.escapeHtml(maskHash(hash))}</td>
          <td class="mono lic-mono-fade" title="${U.escapeHtml(mid || '—')}">${U.escapeHtml(maskMachine(mid))}</td>
          <td class="mono lic-td-ent" title="${U.escapeHtml(U.safeJsonStringify(r.entitlements || {}))}">${U.escapeHtml(
            entSummary(r.entitlements),
          )}</td>
          <td><span class="lic-badge ${r.frozen ? 'lic-badge--bad' : 'lic-badge--ok'}">${r.frozen ? '冻结' : '正常'}</span></td>
          <td><span class="lic-status lic-status--inline"><span class="lic-dot ${st.dot}" aria-hidden="true"></span>${U.escapeHtml(
            st.label,
          )}</span></td>
          <td class="lic-td-time">${U.escapeHtml(U.fmt(r.createdAtMs))}</td>
          <td class="lic-actions-cell">
            <div class="lic-row-actions">
              <button type="button" class="btn btn--sm" data-a="ent">编辑</button>
              <button type="button" class="btn btn--sm btn-danger" data-a="del">删除</button>
              <details class="lic-more">
                <summary class="btn btn--sm" title="更多">⋯</summary>
                <div class="lic-more-menu">
                  <button type="button" class="lic-more-menu__btn" data-a="copy">复制 codeHash</button>
                  <button type="button" class="lic-more-menu__btn" data-a="reissue">重签并复制</button>
                  <button type="button" class="lic-more-menu__btn" data-a="renew">续期</button>
                  <button type="button" class="lic-more-menu__btn" data-a="freeze">${r.frozen ? '解冻' : '冻结'}</button>
                  <button type="button" class="lic-more-menu__btn" data-a="unbind">解绑机器</button>
                </div>
              </details>
            </div>
          </td>`
        wireRow(tr, r, hash)
        tbody.appendChild(tr)
      }

      updateBulkState()
    }

    const refreshBtn = container.querySelector('#lic-refresh')
    if (refreshBtn) refreshBtn.onclick = () => void refresh()
    const searchBtn = container.querySelector('#lic-search-btn')
    if (searchBtn)
      searchBtn.addEventListener('click', () => {
        page = 0
        render()
      })
    if (qEl) {
      qEl.addEventListener('input', () => {
        page = 0
        render()
      })
      qEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          page = 0
          render()
        }
      })
    }
    if (sizeEl) sizeEl.addEventListener('change', () => {
      page = 0
      render()
    })
    if (sortEl) sortEl.addEventListener('change', () => {
      page = 0
      render()
    })
    if (prevEl) prevEl.addEventListener('click', () => {
      page = Math.max(0, page - 1)
      render()
    })
    if (nextEl) nextEl.addEventListener('click', () => {
      page += 1
      render()
    })

    if (selAllEl) {
      selAllEl.addEventListener('change', () => {
        const filtered = getFilteredSorted()
        const paged = paginate(filtered, page, sizeEl ? sizeEl.value : 30)
        const visible = paged.items.map((x) => String(x.codeHash || '').trim()).filter(Boolean)
        if (selAllEl.checked) visible.forEach((h) => sel.codes.add(h))
        else visible.forEach((h) => sel.codes.delete(h))
        render()
      })
    }

    if (bulkFreezeEl) {
      bulkFreezeEl.addEventListener('click', async () => {
        const arr = Array.from(sel.codes.values())
        if (!arr.length) return
        if (!U.confirmDanger(`确定将已选 ${arr.length} 条授权码批量冻结吗？`)) return
        try {
          for (const h of arr) {
            // eslint-disable-next-line no-await-in-loop
            await api.post('/admin/licenses/freeze', { codeHash: h, frozen: true })
          }
          window.FlowidAdminToast('批量冻结完成')
          sel.codes.clear()
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })
    }

    if (bulkUnfreezeEl) {
      bulkUnfreezeEl.addEventListener('click', async () => {
        const arr = Array.from(sel.codes.values())
        if (!arr.length) return
        if (!U.confirmDanger(`确定将已选 ${arr.length} 条授权码批量解冻吗？`)) return
        try {
          for (const h of arr) {
            // eslint-disable-next-line no-await-in-loop
            await api.post('/admin/licenses/freeze', { codeHash: h, frozen: false })
          }
          window.FlowidAdminToast('批量解冻完成')
          sel.codes.clear()
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })
    }

    if (bulkUnbindEl) {
      bulkUnbindEl.addEventListener('click', async () => {
        const arr = Array.from(sel.codes.values())
        if (!arr.length) return
        if (!U.confirmDanger(`确定批量解绑 ${arr.length} 条授权码的机器绑定吗？`)) return
        try {
          for (const h of arr) {
            // eslint-disable-next-line no-await-in-loop
            await api.post('/admin/licenses/unbind', { codeHash: h })
          }
          window.FlowidAdminToast('批量解绑完成')
          sel.codes.clear()
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })
    }

    if (bulkDeleteEl) {
      bulkDeleteEl.addEventListener('click', async () => {
        const arr = Array.from(sel.codes.values())
        if (!arr.length) return
        if (!U.confirmDanger(`确定批量删除 ${arr.length} 条授权码吗？\n（删除后永久失效且无法恢复）`)) return
        try {
          for (const h of arr) {
            // eslint-disable-next-line no-await-in-loop
            await api.post('/admin/licenses/delete', { codeHash: h })
          }
          window.FlowidAdminToast('批量删除完成')
          sel.codes.clear()
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      })
    }

    void refresh()
  }

  window.FlowidAdminPanelLicenses = async function (root) {
    root.innerHTML = `
      <div class="lic-page">
        <section class="lic-svc-host" id="lic-svc-cards" aria-label="服务状态概览"></section>

        <div class="lic-layout">
          <div class="lic-main">
            <p class="lic-lead hint">
              明文积分授权码请前往
              <a href="/pts/admin/licenses" target="_blank" rel="noopener"><code>/pts/admin/licenses</code></a>
              生成与管理；本区域仅维护 <strong>JWT 会员授权</strong>（codeHash、续期、权益、冻结等）。
            </p>

            <div class="admin-card lic-card">
              <div class="lic-card__head">
                <h3 class="lic-card__title">License 授权 — JWT 会员授权列表</h3>
                <p class="lic-meta mono" id="lic-msg"></p>
              </div>

              <div class="lic-toolbar">
                <div class="lic-toolbar__left">
                  <button type="button" class="btn btn-primary lic-btn-primary" id="lic-refresh">刷新</button>
                  <button type="button" class="btn" id="lic-bulk-edit" disabled title="需后端批量修改接口，当前仅前端占位">批量修改</button>
                  <button type="button" class="btn" id="lic-bulk-freeze" disabled>批量冻结</button>
                  <button type="button" class="btn" id="lic-bulk-unfreeze" disabled>批量解冻</button>
                  <button type="button" class="btn" id="lic-bulk-unbind" disabled>批量解绑</button>
                  <button type="button" class="btn btn-danger" id="lic-bulk-delete" disabled>批量删除</button>
                  <span class="lic-sel-info mono" id="lic-sel-info">未选择</span>
                </div>
                <div class="lic-toolbar__right">
                  <input id="lic-q" class="admin-filter-input" type="search" placeholder="ID / codeHash / 机器码 / 权益 / 冻结" autocomplete="off" />
                  <button type="button" class="btn" id="lic-search-btn">搜索</button>
                  <select id="lic-sort" title="排序">
                    <option value="created_desc" selected>创建时间 ↓</option>
                    <option value="created_asc">创建时间 ↑</option>
                    <option value="expires_asc">到期时间 ↑</option>
                    <option value="expires_desc">到期时间 ↓</option>
                  </select>
                  <select id="lic-size" title="每页条数">
                    <option value="20">20 条/页</option>
                    <option value="30" selected>30 条/页</option>
                    <option value="50">50 条/页</option>
                    <option value="100">100 条/页</option>
                  </select>
                </div>
              </div>

              <div class="lic-table-wrap">
                <table class="lic-table">
                  <thead>
                    <tr>
                      <th class="lic-th-check"><input type="checkbox" id="lic-sel-all" aria-label="全选当前页" /></th>
                      <th>ID</th>
                      <th>codeHash</th>
                      <th>机器码</th>
                      <th>权益</th>
                      <th>冻结</th>
                      <th>有效期</th>
                      <th>创建时间</th>
                      <th class="lic-th-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody id="lic-tbody"></tbody>
                </table>
              </div>

              <div class="lic-pagination">
                <button type="button" class="btn" id="lic-prev">上一页</button>
                <span class="mono" id="lic-page"></span>
                <button type="button" class="btn" id="lic-next">下一页</button>
              </div>

              <p class="hint lic-footnote">
                <strong>删除</strong>立即失效；<strong>解绑</strong>后可换设备；<strong>重签</strong>在「⋯」菜单（仍属 JWT，非积分 SQLite 码）。悬停单元格可查看脱敏前完整字段。
              </p>
            </div>
          </div>

          <aside class="lic-aside" aria-label="快捷入口">
            <button type="button" class="lic-dash-card" data-lic-go="templates">
              <span class="lic-dash-card__k">预设模板</span>
              <span class="lic-dash-card__t">项目预设模板 JSON</span>
              <span class="lic-dash-card__d">进入「预设模板」页查看与编辑</span>
            </button>
            <button type="button" class="lic-dash-card" data-lic-go="user-agreement">
              <span class="lic-dash-card__k">用户协议</span>
              <span class="lic-dash-card__t">自定义条款与版本号</span>
              <span class="lic-dash-card__d">保存后客户端从 /user-agreement 同步</span>
            </button>
            <div class="lic-dash-card lic-dash-card--token">
              <span class="lic-dash-card__k">管理员口令</span>
              <span class="lic-dash-card__t"><code class="admin-inline-code">x-admin-token</code></span>
              <p class="lic-dash-card__d">与左侧栏口令联动；写入本机 localStorage。</p>
              <input id="lic-page-token" type="password" autocomplete="off" placeholder="粘贴管理员口令" />
              <button type="button" class="btn btn-primary lic-btn-primary" id="lic-page-token-save">保存口令</button>
            </div>
          </aside>
        </div>
      </div>`

    root.querySelectorAll('[data-lic-go]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-lic-go')
        if (window.FlowidAdminNavigate) window.FlowidAdminNavigate(id)
      })
    })

    const pageTok = root.querySelector('#lic-page-token')
    const sideTok = document.querySelector('#admin-token-input')
    if (pageTok) pageTok.value = state.getAdminToken()
    root.querySelector('#lic-page-token-save')?.addEventListener('click', () => {
      const v = String(pageTok?.value || '').trim()
      state.setAdminToken(v)
      if (sideTok) sideTok.value = v
      window.FlowidAdminToast('管理员口令已保存（与侧栏同步）')
    })

    void loadServiceCards(root.querySelector('#lic-svc-cards'))
    renderLicenses(root)
  }
})()
