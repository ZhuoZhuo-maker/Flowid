import fs from 'fs'
const path = 'server/cloud-workflows.json'
const j = JSON.parse(fs.readFileSync(path, 'utf8'))
const wf = j.workflows.find((w) => w.name && w.name.includes('首尾视频'))
if (!wf) {
  console.error('workflow not found')
  process.exit(1)
}
let s = wf.workflowJson
s = s.replaceAll('"clip_name": "umt5_xxl_fp16.safetensors"', '"clip_name": "Wan\\\\umt5_xxl_fp16.safetensors"')
s = s.replaceAll('"vae_name": "wan_2.1_vae.safetensors"', '"vae_name": "Wan\\\\wan_2.1_vae.safetensors"')
wf.workflowJson = s
fs.writeFileSync(path, JSON.stringify(j, null, 2))
console.log('ok', wf.name)
