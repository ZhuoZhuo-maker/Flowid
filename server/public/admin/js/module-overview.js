;(function () {
  const U = window.FlowidAdminUtil
  const api = window.FlowidAdminApi

  window.FlowidAdminPanelOverview = async function (root) {
    root.innerHTML = `
      <div class="admin-card">
        <h3>运行状态</h3>
        <div class="stat-grid" id="ov-stats"></div>
      </div>
      <div class="admin-card">
        <h3>代理与白名单</h3>
        <p class="hint">OpenAI 兼容代理：<code>POST /proxy/openai</code>。上游域名白名单当前仅允许 <code>dashscope.aliyuncs.com</code>（与后端实现一致）。</p>
        <div class="admin-form-actions">
          <button type="button" class="btn btn-primary" id="ov-proxy-test">探测代理通道（安全请求）</button>
        </div>
        <p class="mono" id="ov-proxy-msg" style="margin-top:10px;"></p>
      </div>
      <div class="admin-card">
        <h3>环境变量（文档）</h3>
        <p class="hint">后端不会通过接口暴露密钥。以下为常用变量名，供运维对照；实际值请在启动进程环境中配置。</p>
        <table class="mono" style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);"><th style="padding:8px 6px;">变量</th><th style="padding:8px 6px;">说明</th></tr></thead>
          <tbody id="ov-env-rows"></tbody>
        </table>
      </div>`

    const stats = root.querySelector('#ov-stats')
    const envRows = root.querySelector('#ov-env-rows')
    const proxyMsg = root.querySelector('#ov-proxy-msg')

    const rows = [
      ['AUTH_SERVER_PORT', '服务端口，默认 3721'],
      ['AUTH_ADMIN_SECRET', '管理员口令（请求头 x-admin-token）；生产环境强制校验'],
      ['NODE_ENV', '设为 production 时启用管理员口令强制校验'],
      ['AUTH_LICENSE_DAYS', '签发授权默认有效天数'],
      ['SYSTEM_PROMPT_HMAC_SECRET', '系统提示词 HMAC 与完整性校验密钥'],
      ['AUTH_JWT_SECRET', '未设置 HMAC 密钥时可作为回退'],
    ]
    envRows.innerHTML = rows
      .map(
        ([k, d]) =>
          `<tr style="border-bottom:1px solid rgba(255,255,255,0.06);"><td style="padding:8px 6px;color:rgba(249,115,22,0.95);">${k}</td><td style="padding:8px 6px;color:rgba(255,255,255,0.55);">${d}</td></tr>`,
      )
      .join('')

    let health = {}
    try {
      health = await api.get('/healthz')
    } catch (e) {
      window.FlowidAdminToast(String(e.message || e), true)
    }

    const origin = window.location.origin
    stats.innerHTML = `
      <div class="stat"><div class="k">服务根地址</div><div class="v mono" style="font-size:12px;">${origin}</div></div>
      <div class="stat"><div class="k">健康检查</div><div class="v">${health.ok ? 'OK' : '异常'}</div></div>
      <div class="stat"><div class="k">服务标识</div><div class="v mono" style="font-size:12px;">${String(health.service || '-')}</div></div>
      <div class="stat"><div class="k">本页时间</div><div class="v">${U.fmt(Date.now())}</div></div>`

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
