;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi

  function esc(s) {
    return U.escapeHtml(String(s || ''))
  }

  window.FlowidAdminPanelOverview = async function (root) {
    root.innerHTML = `
      <div class="admin-card">
        <h3>运行状态</h3>
        <div class="ov-runtime-grid" id="ov-stats" aria-live="polite"></div>
      </div>
      <div class="admin-card">
        <h3>代理与白名单</h3>
        <p class="hint">OpenAI 兼容代理：<code>POST /proxy/openai</code>。上游域名白名单当前仅允许 <span class="admin-chip">dashscope.aliyuncs.com</span>（与后端实现一致）。</p>
        <div class="admin-form-actions">
          <button type="button" class="btn btn-primary" id="ov-proxy-test">刷新代理通道（安全请求）</button>
        </div>
        <p class="mono" id="ov-proxy-msg" style="margin-top:12px;"></p>
      </div>
      <div class="admin-card">
        <h3>环境变量（文档）</h3>
        <p class="hint">后端不会通过接口暴露密钥。以下为常用变量名，供运维对照；实际值请在启动进程环境中配置。</p>
        <div id="ov-env-grid" class="ov-env-grid"></div>
      </div>`

    const stats = root.querySelector('#ov-stats')
    const envGrid = root.querySelector('#ov-env-grid')
    const proxyMsg = root.querySelector('#ov-proxy-msg')

    const rows = [
      ['AUTH_SERVER_PORT', '服务端口，默认 3721'],
      ['AUTH_ADMIN_SECRET', '管理员口令（请求头 x-admin-token）；生产环境强制校验'],
      ['NODE_ENV', '设为 production 时启用管理员口令强制校验'],
      ['AUTH_LICENSE_DAYS', '签发授权默认有效天数'],
      ['SYSTEM_PROMPT_HMAC_SECRET', '系统提示词 HMAC 与完整性校验密钥'],
      ['AUTH_JWT_SECRET', '未设置 HMAC 密钥时可作为回退'],
    ]
    envGrid.innerHTML = rows
      .map(
        ([k, d]) =>
          `<div class="ov-env-chip"><div class="ov-env-chip__k">${esc(k)}</div><div class="ov-env-chip__d">${esc(d)}</div></div>`,
      )
      .join('')

    let health = {}
    try {
      health = await api.get('/healthz')
    } catch (e) {
      window.FlowidAdminToast(String(e.message || e), true)
    }

    const ok = Boolean(health && health.ok)
    const origin = window.location.origin
    stats.innerHTML = `
      <article class="ov-runtime-card">
        <div class="ov-runtime-card__hd">
          <span class="ov-health-dot ov-health-dot--neutral" title="信息"></span>
          <span class="ov-runtime-card__label">服务根地址</span>
        </div>
        <div class="ov-runtime-card__value mono" style="font-size:12px;">${esc(origin)}</div>
      </article>
      <article class="ov-runtime-card">
        <div class="ov-runtime-card__hd">
          <span class="ov-health-dot ${ok ? 'ov-health-dot--ok' : 'ov-health-dot--bad'}" title="${ok ? '正常' : '异常'}"></span>
          <span class="ov-runtime-card__label">健康检查</span>
        </div>
        <div class="ov-runtime-card__value">${ok ? '正常' : '异常'}</div>
      </article>
      <article class="ov-runtime-card">
        <div class="ov-runtime-card__hd">
          <span class="ov-health-dot ${ok ? 'ov-health-dot--ok' : 'ov-health-dot--warn'}" title="服务标识"></span>
          <span class="ov-runtime-card__label">服务标识</span>
        </div>
        <div class="ov-runtime-card__value mono" style="font-size:12px;">${esc(String(health.service || '-'))}</div>
      </article>
      <article class="ov-runtime-card">
        <div class="ov-runtime-card__hd">
          <span class="ov-health-dot ov-health-dot--neutral" title="本页时间"></span>
          <span class="ov-runtime-card__label">本页时间</span>
        </div>
        <div class="ov-runtime-card__value">${esc(U.fmt(Date.now()))}</div>
      </article>`

    root.querySelector('#ov-proxy-test').onclick = async () => {
      proxyMsg.textContent = '请求中…'
      try {
        const res = await api.post('/proxy/openai', {
          url: 'https://dashscope.aliyuncs.com/',
          method: 'GET',
          headers: { Accept: 'application/json' },
          json: null,
        })
        const preview =
          res && Object.prototype.hasOwnProperty.call(res, 'raw')
            ? '上游返回非 JSON 正文（长度 ' + String(res.raw || '').length + '）'
            : JSON.stringify(res).slice(0, 220)
        proxyMsg.textContent = '代理与白名单正常。预览：' + preview
      } catch (e) {
        const m = String(e.message || e)
        if (m.includes('Proxy target not allowed')) {
          proxyMsg.textContent = '白名单拒绝：' + m
          window.FlowidAdminToast(m, true)
          return
        }
        if (/^HTTP \d+/u.test(m)) {
          proxyMsg.textContent =
            '代理入口可用：请求已按白名单转发至 dashscope（管理页将非 2xx 上游状态视为探测成功）。详情：' + m
          window.FlowidAdminToast('代理通道正常（上游返回非 2xx 属预期）')
          return
        }
        proxyMsg.textContent = '代理探测：' + m
        window.FlowidAdminToast(m, true)
      }
    }
  }
})()
