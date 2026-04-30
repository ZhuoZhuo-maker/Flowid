;(function () {
  const ADMIN_TOKEN_KEY = 'flowid.admin.token.v1'
  const NAV_KEY = 'flowid.admin.nav.v1'

  window.FlowidAdminState = {
    getAdminToken() {
      try {
        return String(localStorage.getItem(ADMIN_TOKEN_KEY) || '').trim()
      } catch {
        return ''
      }
    },
    setAdminToken(v) {
      try {
        localStorage.setItem(ADMIN_TOKEN_KEY, String(v || '').trim())
      } catch (_) {}
    },
    getSavedNav() {
      try {
        return String(localStorage.getItem(NAV_KEY) || '').trim()
      } catch {
        return ''
      }
    },
    setSavedNav(id) {
      try {
        localStorage.setItem(NAV_KEY, String(id || ''))
      } catch (_) {}
    },
  }
})()
