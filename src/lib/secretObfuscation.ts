const KEY_STORAGE = 'flowid.secretObfuscation.key.v1'

function getOrCreateKey(): string {
  if (typeof window === 'undefined') return 'flowid'
  const existing = window.localStorage.getItem(KEY_STORAGE)
  if (existing && existing.length >= 16) return existing
  const key = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  window.localStorage.setItem(KEY_STORAGE, key)
  return key
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Lightweight reversible obfuscation for secrets at rest (localStorage).
 * This is NOT cryptographic security, but prevents plain-text exposure in storage.
 */
export function sealSecret(plain: string): string {
  const text = String(plain || '')
  if (!text) return ''
  const key = getOrCreateKey()
  const data = new TextEncoder().encode(text)
  const keyBytes = new TextEncoder().encode(key)
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i] ^ keyBytes[i % keyBytes.length]
  }
  return `obf1:${toBase64(out)}`
}

export function unsealSecret(sealed: string): string {
  const raw = String(sealed || '')
  if (!raw) return ''
  if (!raw.startsWith('obf1:')) return raw
  const b64 = raw.slice(5)
  try {
    const key = getOrCreateKey()
    const data = fromBase64(b64)
    const keyBytes = new TextEncoder().encode(key)
    const out = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i += 1) {
      out[i] = data[i] ^ keyBytes[i % keyBytes.length]
    }
    return new TextDecoder().decode(out)
  } catch {
    return ''
  }
}

