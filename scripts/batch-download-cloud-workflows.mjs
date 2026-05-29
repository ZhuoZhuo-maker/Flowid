/**
 * 批量下载云端工作流 JSON 到指定目录
 * 运行方式: node scripts/batch-download-cloud-workflows.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 配置 - 使用 F: 盘路径
const AUTH_BASE = 'http://127.0.0.1:3721'
const OUTPUT_DIR = 'F:\\flowid-zy\\云端comfyui工作流管理\\后端工作流api本地备份'

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.json()
}

async function main() {
  console.log('📡 获取云端工作流列表...')
  
  // 获取工作流列表
  const metaRes = await fetchJson(`${AUTH_BASE}/cloud-workflows`)
  const workflows = metaRes.workflows || []
  
  console.log(`📋 找到 ${workflows.length} 个工作流\n`)
  
  // 确保输出目录存在
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
    console.log(`📁 创建目录: ${OUTPUT_DIR}\n`)
  }
  
  let success = 0
  let failed = 0
  
  for (const wf of workflows) {
    const id = wf.id
    const name = String(wf.name || '').trim()
    
    // 清理文件名中的非法字符
    const safeName = name.replace(/[<>:"/\\|?*]/g, ' ').trim()
    
    // 生成序号便于排序
    const num = String(workflows.indexOf(wf) + 1).padStart(2, '0')
    const filename = `${num} ${safeName}.api.json`
    const filepath = join(OUTPUT_DIR, filename)
    
    try {
      console.log(`[${num}/${workflows.length}] 下载: ${name}`)
      
      // 获取完整工作流 JSON
      const wfRes = await fetchJson(`${AUTH_BASE}/cloud-workflows/${encodeURIComponent(id)}/workflow`)
      const workflowJson = wfRes.workflowJson
      
      if (workflowJson) {
        writeFileSync(filepath, workflowJson, 'utf-8')
        success++
        console.log(`  ✅ 已保存: ${filename}`)
      } else {
        failed++
        console.log(`  ❌ 无 workflowJson 数据`)
      }
    } catch (err) {
      failed++
      console.log(`  ❌ 失败: ${err.message}`)
    }
  }
  
  console.log(`\n🎉 完成! 成功: ${success}, 失败: ${failed}`)
}

main().catch(console.error)
