#!/usr/bin/env node
/** 与 generate-licenses.mjs 等价（便于文档中写 .js 路径） */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mjs = path.join(root, 'scripts', 'generate-licenses.mjs')
const r = spawnSync(process.execPath, [mjs, ...process.argv.slice(2)], { stdio: 'inherit', cwd: root })
process.exit(r.status === null ? 1 : r.status)
