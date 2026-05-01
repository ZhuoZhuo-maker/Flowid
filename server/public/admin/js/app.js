;(function () {
  const state = window.FlowidAdminState
  const panels = {
    overview: window.FlowidAdminPanelOverview,
    licenses: window.FlowidAdminPanelLicenses,
    'cloud-models': window.FlowidAdminPanelCloudModels,
    'templates-free': window.FlowidAdminPanelTemplatesFree,
    'templates-pro': window.FlowidAdminPanelTemplatesPro,
    'prompts-free': window.FlowidAdminPanelPromptsFree,
    'prompts-pro': window.FlowidAdminPanelPromptsPro,
    'user-agreement': window.FlowidAdminPanelUserAgreement,
  }

  const NAV = [
    {
      id: 'overview',
      title: '服务总览',
      sub: '健康检查、端口、环境变量说明、代理状态',
    },
    {
      id: 'licenses',
      title: 'License 授权',
      sub: '授权码、绑定、冻结、续期、权益、用户账号',
    },
    {
      id: 'cloud-models',
      title: '云端模型（辅助模式）',
      sub: '维护 Token + 代理 baseUrl + 模型列表（供用户端“辅助模式”拉取）',
    },
    {
      id: 'templates-free',
      title: '基础免费预设模板',
      sub: '对应前端预设模板 · free · 独立维护',
    },
    {
      id: 'templates-pro',
      title: '授权 Pro 预设模板',
      sub: '对应前端预设模板 · pro · 会员可见',
    },
    {
      id: 'prompts-free',
      title: '基础免费提示词',
      sub: '仅 free 系统提示词',
    },
    {
      id: 'prompts-pro',
      title: '授权 Pro 提示词',
      sub: '仅 pro 系统提示词',
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
    const saved = state.getSavedNav()
    const initial = panels[saved] ? saved : 'overview'
    await navigate(initial, true)
  })
})()
