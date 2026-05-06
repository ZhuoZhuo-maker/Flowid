/**
 * 授权码规范化：去分隔符、大写，便于与库存 `XXXX-XXXX-XXXX-XXXX` 比对。
 * @param {string} raw
 * @returns {string} 16 位无分隔大写串；非法长度返回空串
 */
export function normalizeLicenseKey(raw) {
  const alnum = String(raw || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
  if (alnum.length !== 16) return ''
  return alnum
}

/**
 * 展示用格式（每 4 位一组）。
 * @param {string} key16
 */
export function formatLicenseDisplay(key16) {
  const k = normalizeLicenseKey(key16)
  if (!k) return ''
  return `${k.slice(0, 4)}-${k.slice(4, 8)}-${k.slice(8, 12)}-${k.slice(12, 16)}`
}

/**
 * 机器码：去首尾空白，原样参与匹配（与桌面端 `getMachineId()` 返回一致）。
 * @param {string} raw
 */
export function normalizeMachineCode(raw) {
  return String(raw || '').trim()
}
