;(function () {
  const state = window.FlowidAdminState
  const panels = {
    overview: window.FlowidAdminPanelOverview,
    licenses: window.FlowidAdminPanelLicenses,
    'cloud-comfyui': window.FlowidAdminPanelCloudComfyui,
    templates: window.FlowidAdminPanelTemplatesPro,
    'inspiration-market': window.FlowidAdminPanelInspirationMarket,
    prompts: window.FlowidAdminPanelPromptsPro,
    'user-agreement': window.FlowidAdminPanelUserAgreement,
  }

  const LEGACY_NAV = {
    'templates-free': 'templates',
    'templates-pro': 'templates',
    'prompts-free': 'prompts',
    'prompts-pro': 'prompts',
    'cloud-models': 'overview',
  }

  const NAV = [
    {
      id: 'overview',
      title: 'FlowID Auth 控制台',
      sub: '健康检查、端口、环境变量说明、代理状态',
    },
    {
      id: 'licenses',
      title: 'License 授权',
      sub: 'JWT 会员列表、服务状态与授权码录入',
    },
    {
      id: 'cloud-comfyui',
      title: '云端',
      sub: 'ComfyUI 官方工作流与云端模型辅助线路',
    },
    {
      id: 'templates',
      title: '预设模板',
      sub: '项目预设模板 JSON',
    },
    {
      id: 'inspiration-market',
      title: '灵感小镇',
      sub: '灵感条目 · 分类 · 封面与提示词（客户端「灵感小镇」同步）',
    },
    {
      id: 'prompts',
      title: '系统提示词',
      sub: '系统提示词正文',
    },
    {
      id: 'user-agreement',
      title: '用户协议',
      sub: '编辑正文与版本号；客户端从 /user-agreement 同步',
    },
  ]

  let activeId = 'overview'

  function setHeader(meta) {
    const t = document.getElementById('admin-main-title')
    const s = document.getElementById('admin-main-sub')
    if (t) t.textContent = meta.title
    if (s) s.textContent = meta.sub
  }

  async function mountPanel(id) {
    const mount = document.getElementById('admin-panel-mount')
    if (!mount) return
    const fn = panels[id]
    if (typeof fn !== 'function') {
      mount.innerHTML = '<div class="admin-card"><p class="hint">模块未加载</p></div>'
      return
    }
    mount.innerHTML = ''
    try {
      await fn(mount)
    } catch (e) {
      window.FlowidAdminToast(String(e.message || e), true)
      mount.innerHTML = `<div class="admin-card"><p class="hint">渲染失败：${String(e.message || e)}</p></div>`
    }
  }

  async function navigate(id, save) {
    if (!panels[id]) id = 'overview'
    activeId = id
    if (save !== false) state.setSavedNav(id)
    document.querySelectorAll('.admin-nav button[data-nav]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-nav') === id)
    })
    const meta = NAV.find((x) => x.id === id) || NAV[0]
    setHeader(meta)
    await mountPanel(id)
  }

  /** 供 License 页等模块跳转到其它管理面板（与侧栏点击一致） */
  window.FlowidAdminNavigate = function (id) {
    return navigate(String(id || '').trim() || 'overview', true)
  }

  function initSidebar() {
    const nav = document.getElementById('admin-nav-root')
    if (!nav) return
    nav.innerHTML = ''
    for (const item of NAV) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('data-nav', item.id)
      btn.innerHTML = `<span>${item.title}</span><small>${item.sub}</small>`
      btn.addEventListener('click', () => void navigate(item.id))
      nav.appendChild(btn)
    }
  }

  function initTokenUi() {
    const input = document.getElementById('admin-token-input')
    const save = document.getElementById('admin-token-save')
    if (!input || !save) return
    input.value = state.getAdminToken()
    save.addEventListener('click', () => {
      state.setAdminToken(input.value)
      window.FlowidAdminToast('管理员口令已写入本机 localStorage')
    })
  }

  window.addEventListener('DOMContentLoaded', async () => {
    initSidebar()
    initTokenUi()
    let fromUrl = ''
    try {
      const sp = new URLSearchParams(window.location.search)
      fromUrl = String(sp.get('panel') || sp.get('nav') || '').trim()
    } catch (_) {
      fromUrl = ''
    }
    const rawSaved = fromUrl || state.getSavedNav()
    const saved = LEGACY_NAV[rawSaved] || rawSaved
    const initial = panels[saved] ? saved : 'overview'
    await navigate(initial, !fromUrl)
  })
})()
