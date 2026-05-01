import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** 唯一源：你放入的打包用 PNG（参见 build/README-icons.md）。脚本不会覆盖此文件。 */
const srcPng = path.join(root, 'build', 'icon.png')
const outIco = path.join(root, 'build', 'icon.ico')
const outRuntimePng = path.join(root, 'electron', 'assets', 'icon.png')
/** 供界面内 Logo、favicon 使用，由源图导出 */
const publicMarkPng = path.join(root, 'public', 'flowid-mark.png')

async function main() {
  try {
    await fs.access(srcPng)
  } catch {
    process.stderr.write(
      [
        '缺少应用图标源文件：build/icon.png',
        '请将 512×512（或接近正方形）的 PNG 放到该路径后再运行 npm run gen:icon。',
        '说明见 build/README-icons.md',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  const raw = await fs.readFile(srcPng)
  const normalized = await sharp(raw)
    .resize(512, 512, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const sizes = [16, 32, 48, 256]
  const pngBuffers = await Promise.all(
    sizes.map((s) =>
      sharp(normalized)
        .resize(s, s, { fit: 'cover' })
        .png()
        .toBuffer(),
    ),
  )
  const ico = await pngToIco(pngBuffers)
  await fs.writeFile(outIco, ico)
  await fs.mkdir(path.dirname(outRuntimePng), { recursive: true })
  await fs.writeFile(outRuntimePng, normalized)
  await fs.writeFile(publicMarkPng, normalized)
  process.stdout.write(`from ${srcPng}\ngenerated: ${outIco}\n${outRuntimePng}\n${publicMarkPng}\n`)
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err?.message || err || 'generate-icon failed') + '\n')
  process.exit(1)
})
