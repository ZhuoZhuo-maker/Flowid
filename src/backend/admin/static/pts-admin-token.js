/**
 * /pts 管理页共用：把 ADMIN_TOKEN 存到 localStorage，避免返回页面后输入框为空、列表拉取失败。
 * 键名与 Auth 管理台区分，仅用于积分 SQLite 管理 HTML。
 */
;(function () {
  var KEY = 'flowid.pts.admin.token.v1'
  window.flowidPtsAdminToken = {
    key: KEY,
    load: function (inputId) {
      inputId = inputId || 'token'
      try {
        var v = String(localStorage.getItem(KEY) || '').trim()
        var el = document.getElementById(inputId)
        if (el && v) el.value = v
        return v
      } catch (e) {
        return ''
      }
    },
    save: function (inputId) {
      inputId = inputId || 'token'
      try {
        var el = document.getElementById(inputId)
        var v = el ? String(el.value || '').trim() : ''
        if (v) localStorage.setItem(KEY, v)
        else localStorage.removeItem(KEY)
      } catch (e) {
        /* ignore */
      }
    },
    bind: function (inputId) {
      inputId = inputId || 'token'
      var el = document.getElementById(inputId)
      if (!el) return
      var self = window.flowidPtsAdminToken
      el.addEventListener('change', function () {
        self.save(inputId)
      })
      el.addEventListener('blur', function () {
        self.save(inputId)
      })
    },
  }
})()
