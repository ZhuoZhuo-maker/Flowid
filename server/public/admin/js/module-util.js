;(function () {
  const INVALID_JSON = Symbol('invalid-json')
  window.FlowidAdminUtil = {
    INVALID_JSON,
    normalizeTier(v) {
      return String(v || '').trim().toLowerCase() === 'pro' ? 'pro' : 'free'
    },
    fmt(ts) {
      const n = Number(ts || 0)
      if (!Number.isFinite(n) || n <= 0) return '-'
      try {
        return new Date(n).toLocaleString('zh-CN')
      } catch {
        return '-'
      }
    },
    safeJsonStringify(obj, space) {
      try {
        return JSON.stringify(obj, null, space == null ? 2 : space)
      } catch {
        return '{}'
      }
    },
    safeJsonParse(text, fallback) {
      try {
        return JSON.parse(String(text || '').trim())
      } catch {
        return fallback
      }
    },
    confirmDanger(message) {
      if (!window.confirm(message)) return false
      if (!window.confirm('请再次确认该操作。')) return false
      return true
    },
    /** 列表分类展示：空 category 归为「未分类」 */
    normalizeCategoryLabel(raw) {
      const c = String(raw || '').trim()
      return c || '(未分类)'
    },
    /** 当前 tier 下所有不重复分类，供筛选下拉 */
    uniqueCategoriesForTier(items, tier) {
      const set = new Set()
      for (const it of items || []) {
        if (this.normalizeTier(it.tier) !== tier) continue
        set.add(this.normalizeCategoryLabel(it.category))
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    },
    /** 名称 / id / 描述 模糊匹配（不区分大小写） */
    itemMatchesSearch(item, query, keys) {
      const q = String(query || '').trim().toLowerCase()
      if (!q) return true
      const ks = keys || ['id', 'name', 'description']
      for (const k of ks) {
        if (String(item[k] ?? '').toLowerCase().includes(q)) return true
      }
      return false
    },
    escapeHtml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    },
  }
})()
