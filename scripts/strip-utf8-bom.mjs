/**
 * 1) Remove a leading UTF-8 BOM (EF BB BF) from files.
 * 2) For .bat / .cmd: normalize newlines to CRLF (cmd.exe is unreliable with LF-only scripts).
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2).filter(Boolean)
if (!args.length) {
  console.error('Usage: node scripts/strip-utf8-bom.mjs <file> [file...]')
  process.exit(1)
}

/** @param {Buffer} buf */
function stripUtf8Bom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { buf: buf.subarray(3), stripped: true }
  }
  return { buf, stripped: false }
}

/** @param {Buffer} buf */
function normalizeCrlf(buf) {
  const out = []
  let i = 0
  while (i < buf.length) {
    const c = buf[i]
    if (c === 0x0d) {
      if (i + 1 < buf.length && buf[i + 1] === 0x0a) {
        out.push(0x0d, 0x0a)
        i += 2
      } else {
        out.push(0x0d, 0x0a)
        i += 1
      }
    } else if (c === 0x0a) {
      out.push(0x0d, 0x0a)
      i += 1
    } else {
      out.push(c)
      i += 1
    }
  }
  return Buffer.from(out)
}

/** @param {Buffer} a @param {Buffer} b */
function bufEqual(a, b) {
  return a.length === b.length && a.compare(b) === 0
}

for (const arg of args) {
  const p = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg)
  if (!fs.existsSync(p)) continue

  const orig = fs.readFileSync(p)
  let { buf: afterBom, stripped } = stripUtf8Bom(orig)

  const ext = path.extname(p).toLowerCase()
  const base = path.basename(p).toLowerCase()
  /** `.bat.example` has ext `.example` — still a cmd.exe batch fragment. */
  const isBatLike =
    ext === '.bat' || ext === '.cmd' || base.endsWith('.bat.example') || base.endsWith('.cmd.example')

  let buf = afterBom
  let crlfNormalized = false
  if (isBatLike) {
    const n = normalizeCrlf(afterBom)
    crlfNormalized = !bufEqual(n, afterBom)
    buf = n
  }

  if (!bufEqual(buf, orig)) {
    fs.writeFileSync(p, buf)
    if (stripped) console.error(`[strip-utf8-bom] removed BOM: ${p}`)
    if (crlfNormalized) console.error(`[strip-utf8-bom] normalized to CRLF: ${p}`)
  }
}
process.exit(0)
