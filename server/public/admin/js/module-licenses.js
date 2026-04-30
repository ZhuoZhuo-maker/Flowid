;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi

  const sel = { codes: new Set() }

  function normalizeText(v) {
    return String(v == null ? '' : v).trim().toLowerCase()
  }

  function paginate(items, page, pageSize) {
    const size = Math.max(5, Math.min(200, Math.floor(Number(pageSize || 30) || 30)))
    const total = items.length
    const totalPages = Math.max(1, Math.ceil(total / size))
    const p = Math.max(0, Math.min(totalPages - 1, Math.floor(Number(page || 0) || 0)))
    const start = p * size
    return { page: p, pageSize: size, total, totalPages, items: items.slice(start, start + size) }
  }

  function bindIssuePanel(container, onAfterIssue) {
    const issueBtn = container.querySelector('#lic-issue')
    const copyBtn = container.querySelector('#lic-copy')
    const msg = container.querySelector('#lic-issue-msg')
    const daysEl = container.querySelector('#lic-days')
    const entEl = container.querySelector('#lic-ent')
    const codeEl = container.querySelector('#lic-code')
    const codeRowEl = container.querySelector('#lic-code-row')
    if (!issueBtn || !msg || !daysEl || !entEl || !codeEl || !codeRowEl) return

    issueBtn.onclick = async () => {
      msg.textContent = '发码中…'
      try {
        const days = Math.max(1, Math.min(3650, Math.floor(Number(daysEl.value || 30))))
        const ent = U.safeJsonParse(entEl.value, null)
        if (!ent || typeof ent !== 'object' || Array.isArray(ent)) throw new Error('权益需为 JSON 对象')
        const res = await api.post('/admin/licenses/issue', { days, entitlements: ent })
        msg.textContent = '发码成功，请立即复制保存。'
        codeEl.textContent = res.licenseCode || ''
        codeRowEl.style.display = res.licenseCode ? 'block' : 'none'
        window.FlowidAdminToast('新授权码已生成')
        if (typeof onAfterIssue === 'function') await onAfterIssue()
      } catch (e) {
        msg.textContent = String(e.message || e)
        window.FlowidAdminToast(msg.textContent, true)
      }
    }

    if (copyBtn) {
      copyBtn.onclick = async () => {
        const code = String(codeEl.textContent || '').trim()
        if (!code) return
        try {
          await navigator.clipboard.writeText(code)
          window.FlowidAdminToast('已复制新授权码')
        } catch {
          window.alert('复制失败：\n' + code)
        }
      }
    }
  }

  function renderLicenses(container) {
    const listEl = container.querySelector('#lic-list')
    const msgEl = container.querySelector('#lic-msg')
    const qEl = container.querySelector('#lic-q')
    const sizeEl = container.querySelector('#lic-size')
    const prevEl = container.querySelector('#lic-prev')
    const nextEl = container.querySelector('#lic-next')
    const pageInfoEl = container.querySelector('#lic-page')
    const sortEl = container.querySelector('#lic-sort')
    const selAllEl = container.querySelector('#lic-sel-all')
    const selInfoEl = container.querySelector('#lic-sel-info')
    const bulkCopyEl = container.querySelector('#lic-bulk-copy')
    const bulkFreezeEl = container.querySelector('#lic-bulk-freeze')
    const bulkUnbindEl = container.querySelector('#lic-bulk-unbind')
    const bulkDeleteEl = container.querySelector('#lic-bulk-delete')
    let page = 0
    let cache = []

    if (!listEl || !msgEl) return

    function updateBulkState() {
      const count = sel.codes.size
      if (selInfoEl) selInfoEl.textContent = count ? `已选 ${count}` : '未选择'
      const dis = count <= 0
      if (bulkCopyEl) bulkCopyEl.disabled = dis
      if (bulkFreezeEl) bulkFreezeEl.disabled = dis
      if (bulkUnbindEl) bulkUnbindEl.disabled = dis
      if (bulkDeleteEl) bulkDeleteEl.disabled = dis
    }

    async function refresh() {
      msgEl.textContent = '加载中…'
      listEl.innerHTML = ''
      try {
        const res = await api.get('/admin/licenses')
        msgEl.textContent = `共 ${res.total} 条 · 服务器时间 ${U.fmt(res.serverTimeMs)}`
        cache = res.licenses || []
        if (!cache.length) {
          listEl.innerHTML = '<div class="empty-state">暂无授权码</div>'
          return
        }
        render()
      } catch (e) {
        msgEl.textContent = String(e.message || e)
        window.FlowidAdminToast(msgEl.textContent, true)
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

    function render() {
      const filtered = getFilteredSorted()
      const paged = paginate(filtered, page, sizeEl ? sizeEl.value : 30)
      page = paged.page
      if (pageInfoEl) pageInfoEl.textContent = `第 ${paged.page + 1} / ${paged.totalPages} 页（${paged.total}）`
      if (prevEl) prevEl.disabled = paged.page <= 0
      if (nextEl) nextEl.disabled = paged.page >= paged.totalPages - 1

      listEl.innerHTML = ''
      if (!paged.items.length) {
        listEl.innerHTML = '<div class="empty-state">没有匹配的数据</div>'
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

      const startNo = paged.page * paged.pageSize
      paged.items.forEach((r, idx) => {
        const hash = String(r.codeHash || '').trim()
        const isChecked = hash && sel.codes.has(hash)
        const wrap = document.createElement('div')
        wrap.className = 'admin-list-item'
        wrap.style.cursor = 'default'
        const serial = startNo + idx + 1
        wrap.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
            <div style="min-width:280px;flex:1;">
              <div class="title">
                <label style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;">
                  <input type="checkbox" data-a="sel" ${isChecked ? 'checked' : ''} />
                  <span>#${serial} · ${U.escapeHtml(r.id)}</span>
                </label>
                <span class="tag ${r.frozen ? 'tag-bad' : 'tag-ok'}" style="margin-left:8px;">${r.frozen ? '冻结' : '正常'}</span>
              </div>
              <div class="meta">创建：${U.fmt(r.createdAtMs)} · 到期：${U.fmt(r.expiresAtMs)}</div>
              <div class="meta">绑定机器：${U.escapeHtml(r.boundMachineId || '-')}</div>
              <div class="meta">entitlements：${U.escapeHtml(U.safeJsonStringify(r.entitlements || {}))}</div>
              <div class="meta">codeHash：${U.escapeHtml(r.codeHash || '')}</div>
            </div>
            <div class="admin-form-actions" style="margin:0;">
              <button type="button" class="btn" data-a="copy">复制</button>
              <button type="button" class="btn" data-a="reissue">重签并复制</button>
              <button type="button" class="btn" data-a="renew">续期</button>
              <button type="button" class="btn ${r.frozen ? '' : 'btn-danger'}" data-a="freeze">${r.frozen ? '解冻' : '冻结'}</button>
              <button type="button" class="btn" data-a="unbind">解绑</button>
              <button type="button" class="btn" data-a="ent">权益</button>
              <button type="button" class="btn btn-danger" data-a="del">删除</button>
            </div>
          </div>`

        const selBox = wrap.querySelector('[data-a="sel"]')
        if (selBox) {
          selBox.onchange = () => {
            if (!hash) return
            if (selBox.checked) sel.codes.add(hash)
            else sel.codes.delete(hash)
            updateBulkState()
          }
        }

        wrap.querySelector('[data-a="copy"]').onclick = async () => {
          if (!hash) return
          try {
            await navigator.clipboard.writeText(hash)
            window.FlowidAdminToast('已复制 codeHash')
          } catch {
            window.alert('复制失败：\n' + hash)
          }
        }

        wrap.querySelector('[data-a="reissue"]').onclick = async () => {
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
        }

        wrap.querySelector('[data-a="renew"]').onclick = async () => {
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
        }

        wrap.querySelector('[data-a="freeze"]').onclick = async () => {
          try {
            await api.post('/admin/licenses/freeze', { codeHash: hash, frozen: !r.frozen })
            window.FlowidAdminToast('已更新冻结状态')
            await refresh()
          } catch (e) {
            window.FlowidAdminToast(String(e.message || e), true)
          }
        }

        wrap.querySelector('[data-a="unbind"]').onclick = async () => {
          if (!U.confirmDanger('确定解绑该授权的机器码绑定吗？解绑后该码可被重新绑定到任意设备。')) return
          try {
            await api.post('/admin/licenses/unbind', { codeHash: hash })
            window.FlowidAdminToast('已解绑')
            await refresh()
          } catch (e) {
            window.FlowidAdminToast(String(e.message || e), true)
          }
        }

        wrap.querySelector('[data-a="ent"]').onclick = async () => {
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
        }

        wrap.querySelector('[data-a="del"]').onclick = async () => {
          if (!U.confirmDanger('确定删除该授权码记录吗？\n（删除后该授权码将永久失效，且无法恢复）')) return
          try {
            await api.post('/admin/licenses/delete', { codeHash: hash })
            sel.codes.delete(hash)
            window.FlowidAdminToast('已删除授权码')
            await refresh()
          } catch (e) {
            window.FlowidAdminToast(String(e.message || e), true)
          }
        }

        listEl.appendChild(wrap)
      })

      updateBulkState()
    }

    const refreshBtn = container.querySelector('#lic-refresh')
    if (refreshBtn) refreshBtn.onclick = () => refresh()
    if (qEl) qEl.oninput = () => {
      page = 0
      render()
    }
    if (sizeEl) sizeEl.onchange = () => {
      page = 0
      render()
    }
    if (sortEl) sortEl.onchange = () => {
      page = 0
      render()
    }
    if (prevEl) prevEl.onclick = () => {
      page = Math.max(0, page - 1)
      render()
    }
    if (nextEl) nextEl.onclick = () => {
      page = page + 1
      render()
    }

    if (selAllEl) {
      selAllEl.onchange = () => {
        const filtered = getFilteredSorted()
        const paged = paginate(filtered, page, sizeEl ? sizeEl.value : 30)
        const visible = paged.items.map((x) => String(x.codeHash || '').trim()).filter(Boolean)
        if (selAllEl.checked) visible.forEach((h) => sel.codes.add(h))
        else visible.forEach((h) => sel.codes.delete(h))
        render()
      }
    }

    if (bulkCopyEl) {
      bulkCopyEl.onclick = async () => {
        const arr = Array.from(sel.codes.values())
        if (!arr.length) return
        const text = arr.join('\n')
        try {
          await navigator.clipboard.writeText(text)
          window.FlowidAdminToast(`已复制 ${arr.length} 条 codeHash`)
        } catch {
          window.alert(text)
        }
      }
    }

    if (bulkFreezeEl) {
      bulkFreezeEl.onclick = async () => {
        const arr = Array.from(sel.codes.values())
        if (!arr.length) return
        const toFrozen = window.confirm(`批量冻结 ${arr.length} 条授权码？\n确定=冻结；取消=解冻`)
        try {
          for (const h of arr) {
            // eslint-disable-next-line no-await-in-loop
            await api.post('/admin/licenses/freeze', { codeHash: h, frozen: toFrozen })
          }
          window.FlowidAdminToast('批量更新冻结状态完成')
          sel.codes.clear()
          await refresh()
        } catch (e) {
          window.FlowidAdminToast(String(e.message || e), true)
        }
      }
    }

    if (bulkUnbindEl) {
      bulkUnbindEl.onclick = async () => {
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
      }
    }

    if (bulkDeleteEl) {
      bulkDeleteEl.onclick = async () => {
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
      }
    }

    void refresh()
  }

  window.FlowidAdminPanelLicenses = async function (root) {
    root.innerHTML = `
      <div class="tabs" id="lic-tabs">
        <button type="button" class="is-active" data-tab="issue">发放授权</button>
        <button type="button" data-tab="list">授权码列表</button>
      </div>

      <div class="tab-panel is-active" data-tab="issue">
        <div class="admin-card admin-form-block" style="max-width:980px;">
          <h3>发放新授权</h3>
          <label><span>时长（天）</span><input type="number" id="lic-days" value="30" min="1" max="3650" /></label>
          <label><span>权益 entitlements（JSON）</span><textarea id="lic-ent" class="tall">${U.safeJsonStringify({ proTemplates: true, cloudModels: true })}</textarea></label>
          <div class="admin-form-actions">
            <button type="button" class="btn btn-primary" id="lic-issue">签发授权码</button>
          </div>
          <p class="mono" id="lic-issue-msg"></p>
          <div id="lic-code-row" style="display:none;margin-top:10px;">
            <div class="mono" style="word-break:break-all;">新码：<strong id="lic-code"></strong></div>
            <button type="button" class="btn" id="lic-copy" style="margin-top:8px;">复制新码</button>
          </div>
          <p class="hint">提示：列表中仅保存 <code>codeHash</code>，无法找回原始授权码；如需要重新发给用户，请用列表里的「重签并复制」。</p>
        </div>
      </div>

      <div class="tab-panel" data-tab="list">
        <div class="admin-card">
          <h3>授权码列表（按时间排序）</h3>
          <div class="admin-list-toolbar">
            <button type="button" class="btn btn-primary" id="lic-refresh">刷新</button>
            <label class="mono" style="display:inline-flex;align-items:center;gap:8px;">
              <input type="checkbox" id="lic-sel-all" />
              <span id="lic-sel-info">未选择</span>
            </label>
            <button type="button" class="btn" id="lic-bulk-copy" disabled>批量复制</button>
            <button type="button" class="btn" id="lic-bulk-freeze" disabled>批量冻结/解冻</button>
            <button type="button" class="btn" id="lic-bulk-unbind" disabled>批量解绑</button>
            <button type="button" class="btn btn-danger" id="lic-bulk-delete" disabled>批量删除</button>
            <input id="lic-q" class="admin-filter-input" placeholder="搜索：ID / codeHash / 机器码 / 权益 / 冻结" />
            <select id="lic-sort">
              <option value="created_desc" selected>创建时间↓</option>
              <option value="expires_asc">到期时间↑</option>
              <option value="expires_desc">到期时间↓</option>
            </select>
            <select id="lic-size">
              <option value="20">20/页</option>
              <option value="30" selected>30/页</option>
              <option value="50">50/页</option>
              <option value="100">100/页</option>
            </select>
            <button type="button" class="btn" id="lic-prev">上一页</button>
            <button type="button" class="btn" id="lic-next">下一页</button>
            <span class="mono" id="lic-page"></span>
          </div>
          <p class="mono" id="lic-msg"></p>
          <div id="lic-list" class="admin-list"></div>
          <p class="hint"><strong>删除授权码</strong>会让该码立即永久失效；<strong>解绑机器</strong>会让该码可被重新绑定到任意设备。</p>
        </div>
      </div>`

    const tabs = root.querySelectorAll('#lic-tabs button')
    const panels = root.querySelectorAll('.tab-panel')
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tab')
        tabs.forEach((b) => b.classList.toggle('is-active', b === btn))
        panels.forEach((p) => p.classList.toggle('is-active', p.getAttribute('data-tab') === id))
      })
    })

    const issuePanel = root.querySelector('.tab-panel[data-tab="issue"]')
    const listPanel = root.querySelector('.tab-panel[data-tab="list"]')
    if (issuePanel) {
      bindIssuePanel(issuePanel, async () => {
        const btn = listPanel ? listPanel.querySelector('#lic-refresh') : null
        if (btn) btn.click()
      })
    }
    if (listPanel) renderLicenses(listPanel)
  }
})()
