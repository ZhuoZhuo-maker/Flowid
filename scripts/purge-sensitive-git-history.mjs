/**
 * 从 Git 全历史中移除敏感/赘余路径（需已安装 git-filter-repo）。
 * 用法：node scripts/purge-sensitive-git-history.mjs
 * 完成后：git push --force-with-lease（与协作者同步后再推）
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const INVERT_PATHS = [
  'licenses_export_2026-05-05T17-04-46-004Z.csv',
  'licenses_export_2026-05-05T17-04-59-922Z.csv',
  'server/auth-db.json',
  'pack-flowid-user-config.bat',
  'pack-flowid-user-config.bat.example',
  'pack-flowid-user-config.bat.txt',
  'build/pyi_work',
]

function main() {
  const args = ['filter-repo', '--force']
  for (const p of INVERT_PATHS) {
    args.push('--invert-paths', '--path', p)
  }

  console.log('[purge] 若未安装 git-filter-repo，请先：pip install git-filter-repo')
  console.log('[purge] 将重写历史并删除：', INVERT_PATHS.join(', '))

  const r = spawnSync('git', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error('\n[purge] 失败。可改用 filter-branch（见 docs/open-source-security-checklist.md 第四节）')
    process.exit(r.status ?? 1)
  }
  console.log('\n[purge] 完成。请执行 npm run check:open-source-secrets，再 git push --force-with-lease')
}

main()
