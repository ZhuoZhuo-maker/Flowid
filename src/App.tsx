import { useEffect, useMemo, useState } from 'react'
import {
  getLicenseNoticeMessage,
  loadLocalLicenseSnapshot,
  saveLocalLicenseSnapshot,
} from './lib/license'
import { Plus, Search, ChevronDown, Wallet, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { StudioApp } from './components/StudioApp'
import { loadLocalDiskPathsSettings } from './lib/localDiskPathsSettings'
import { parseProjectFile } from './lib/persistence'
import './App.css'

type View = 'archive' | 'templates' | 'workspace'

interface Project {
  id: string
  name: string
  updatedAt: string
  createdAt: string
  thumbnail: string
  type: 'local' | 'cloud'
  filePath?: string
}

interface Template {
  id: string
  name: string
  category: string
  image: string
  description: string
}

const MOCK_PROJECTS: Project[] = [
  {
    id: '1',
    name: '电商模特项目',
    updatedAt: '2026/04/24',
    createdAt: '2026/04/20',
    thumbnail:
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
    type: 'local',
  },
  {
    id: '2',
    name: '分镜脚本 A',
    updatedAt: '2026/04/23',
    createdAt: '2026/04/18',
    thumbnail:
      'https://images.unsplash.com/photo-1633167606207-d840b5070fc2?q=80&w=2564&auto=format&fit=crop',
    type: 'local',
  },
  {
    id: '3',
    name: '未命名项目 111',
    updatedAt: '2026/04/24',
    createdAt: '2026/04/24',
    thumbnail:
      'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=2564&auto=format&fit=crop',
    type: 'cloud',
  },
  {
    id: '4',
    name: '景观渲染方案 B',
    updatedAt: '2026/04/22',
    createdAt: '2026/04/15',
    thumbnail:
      'https://images.unsplash.com/photo-1605142127394-ba5f403063f1?q=80&w=2564&auto=format&fit=crop',
    type: 'local',
  },
]

function formatDate(ts: number): string {
  if (!Number.isFinite(ts)) return '-'
  try {
    return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return '-'
  }
}

function hashToHue(input: string): number {
  const s = String(input || '')
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h % 360
}

function makeThumbDataUri(seed: string): string {
  const hue = hashToHue(seed)
  const h2 = (hue + 42) % 360
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue}, 70%, 28%)"/>
        <stop offset="1" stop-color="hsl(${h2}, 70%, 20%)"/>
      </linearGradient>
      <radialGradient id="r" cx="30%" cy="20%" r="80%">
        <stop offset="0" stop-color="rgba(234,88,12,0.22)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="750" fill="url(#g)"/>
    <rect width="1200" height="750" fill="url(#r)"/>
    <g opacity="0.18" fill="white">
      <circle cx="220" cy="240" r="120"/>
      <circle cx="980" cy="140" r="90"/>
      <circle cx="780" cy="560" r="160"/>
    </g>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const TEMPLATE_CATEGORIES = ['全部', '建筑', '角色', '抽象', '工业', '景观']

const MOCK_TEMPLATES: Template[] = [
  {
    id: 't1',
    name: '极简流线型建筑',
    category: '建筑',
    image:
      'https://images.unsplash.com/photo-1506146332389-18140ed74d5a?q=80&w=2564&auto=format&fit=crop',
    description: '采用参数化设计风格，强调流动感与现代性。',
  },
  {
    id: 't2',
    name: '赛博朋克工业组件',
    category: '工业',
    image:
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2564&auto=format&fit=crop',
    description: '硬表面建模参考，包含复杂的机械刻线与发光原件。',
  },
  {
    id: 't3',
    name: '超现实有机生命体',
    category: '角色',
    image:
      'https://images.unsplash.com/photo-1614728263952-84ea206f99b6?q=80&w=2564&auto=format&fit=crop',
    description: '结合生物形态与几何结构的奇幻物种设计。',
  },
  {
    id: 't4',
    name: '未来城市景观',
    category: '景观',
    image:
      'https://images.unsplash.com/photo-1605142127394-ba5f403063f1?q=80&w=2564&auto=format&fit=crop',
    description: '多层级城市架构，光影效果针对夜景极致优化。',
  },
]

function Navigation({
  activeView,
  setView,
}: {
  activeView: View
  setView: (v: View) => void
}) {
  return (
    <header className="fixed top-6 inset-x-8 h-14 flex items-center justify-between z-50 pointer-events-none">
      <div className="flex items-center gap-4 pointer-events-auto">
        <div className="flex items-center gap-3 bg-[#111114] border border-white/5 px-6 py-2.5 rounded-full shadow-2xl backdrop-blur-xl">
          <div className="w-6 h-6 bg-orange-600 flex items-center justify-center rounded-sm">
            <span className="text-[14px] font-black text-white">F</span>
          </div>
          <span className="text-sm font-black tracking-widest uppercase">
            Flowid
          </span>
          <div className="w-[1px] h-4 bg-white/10 mx-2" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('archive')}
              className={`text-[14px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full transition-all ${
                activeView === 'archive'
                  ? 'text-orange-500 bg-orange-500/10'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              项目档案
            </button>
            <button
              onClick={() => setView('templates')}
              className={`text-[14px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full transition-all ${
                activeView === 'templates'
                  ? 'text-orange-500 bg-orange-500/10'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              预设模板
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="flex items-center gap-4 bg-[#111114] border border-white/10 px-6 py-2.5 rounded-full shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-mono text-white/50 uppercase tracking-widest">
              Available
            </span>
            <span className="text-[15px] font-black text-orange-500">
              500.00 PTS
            </span>
            <div className="w-[1px] h-3 bg-white/10 mx-1" />
            <button className="flex items-center gap-2 text-[14px] font-black uppercase text-white/70 hover:text-white transition-colors">
              <Wallet className="w-3 h-3" />
              充值
            </button>
          </div>
        </div>
        <button className="bg-white text-black font-black text-[14px] uppercase tracking-widest px-8 py-2.5 rounded-full hover:bg-orange-500 hover:text-white transition-all shadow-xl">
          注册 / 登录
        </button>
      </div>
    </header>
  )
}

function HeroBanner() {
  return (
    <div className="relative w-full py-20 px-12 mb-20 overflow-hidden">
      <div className="absolute top-0 right-0 text-right">
        <div className="text-[15px] font-mono opacity-60 uppercase tracking-widest">
          版本_4.0.2 // 稳定运行
        </div>
        <div className="text-[15px] font-mono opacity-60 uppercase mb-4 tracking-widest">
          L-884-NXS
        </div>
        <div className="w-12 h-[1px] bg-orange-500 ml-auto"></div>
      </div>

      <div className="relative z-10">
        <div className="text-orange-500 font-bold text-[16px] uppercase tracking-[0.6em] mb-8">
          创意工程工作室
        </div>

        <h1 className="text-[120px] font-black leading-[0.85] uppercase tracking-tighter mb-12 relative">
          Flowid
          <br />
          <span className="text-outline">全面升级</span>
        </h1>

        <div className="flex items-end gap-20">
          <p className="max-w-sm text-lg text-white/40 leading-snug font-light">
            我们更新了原始模型，在图像生成、风格化和多参考编辑方面进行了显著改进。
          </p>
          <div className="flex-1 h-[1px] bg-white/10 mb-2"></div>
          <div className="text-4xl font-black text-orange-500 flex items-center gap-6">
            <span className="w-14 h-14 border border-orange-500 rounded-full flex items-center justify-center text-sm">
              →
            </span>
            立即探索
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  onClick,
  onDelete,
}: {
  project: Project
  onClick?: () => void
  onDelete?: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
      className="group bg-[#111114] border border-white/5 rounded-2xl overflow-hidden shadow-2xl relative"
    >
      <div className="aspect-[16/10] bg-[#0A0A0C] relative overflow-hidden">
        <img
          src={project.thumbnail}
          className="w-full h-full object-cover opacity-30 group-hover:scale-110 group-hover:opacity-80 transition-all duration-700"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080809] to-transparent opacity-60" />

        <div className="absolute top-4 right-4 flex gap-2 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.()
            }}
            className="w-10 h-10 rounded-xl bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center text-white/40 hover:text-red-500 transition-all"
            aria-label="删除项目"
            title="删除项目"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>

        <div className="absolute top-4 left-4">
          <div
            className={`px-3 py-1 rounded-full text-[13px] font-black uppercase tracking-widest border border-white/10 backdrop-blur-md ${
              project.type === 'cloud'
                ? 'bg-orange-500/10 text-orange-500 border-orange-500/20'
                : 'bg-white/5 text-white/60'
            }`}
          >
            {project.type} // Source
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h3 className="text-3xl font-black tracking-tighter uppercase italic text-white group-hover:text-orange-500 transition-colors mb-3 leading-none">
              {project.name}
            </h3>
            <div className="flex items-center gap-3 text-[13px] font-mono uppercase tracking-[0.2em] text-white/50">
              <span>修改: {project.updatedAt}</span>
              <div className="w-1 h-1 rounded-full bg-white/10" />
              <span>创建: {project.createdAt}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/5 pt-6">
          <div className="flex gap-1.5">
            <div className="w-10 h-[2px] bg-orange-600" />
            <div className="w-4 h-[2px] bg-orange-600/40" />
            <div className="w-2 h-[2px] bg-orange-600/20" />
          </div>
          <button
            onClick={onClick}
            className="text-[14px] font-black uppercase tracking-[0.3em] text-white/60 flex items-center gap-3 hover:text-white transition-all"
          >
            进入项目
            <ChevronDown className="w-3 h-3 -rotate-90" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function TemplateCard({ template }: { template: Template }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -10 }}
      className="group bg-[#0A0A0B] border border-white/5 overflow-hidden transition-all duration-500 hover:border-orange-500/30"
    >
      <div className="aspect-[16/10] relative overflow-hidden">
        <img
          src={template.image}
          alt={template.name}
          className="w-full h-full object-cover grayscale opacity-50 group-hover:opacity-100 group-hover:grayscale-0 transition-all duration-1000 group-hover:scale-110"
        />
        <div className="absolute top-4 left-4">
          <div className="bg-black/60 backdrop-blur px-3 py-1 border border-white/10 rounded text-[13px] font-mono uppercase tracking-widest text-orange-500">
            {template.category}
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
      </div>

      <div className="p-6">
        <div className="flex items-start justify-between mb-2">
          <h4 className="text-lg font-black uppercase tracking-tight group-hover:text-orange-500 transition-colors">
            {template.name}
          </h4>
        </div>
        <p className="text-xs text-white/40 leading-relaxed font-light mb-6">
          {template.description}
        </p>
        <div className="flex items-center gap-2">
          <button className="flex-1 py-3 bg-white/5 hover:bg-orange-600 hover:text-white transition-all text-[14px] font-black uppercase tracking-widest border border-white/10 group-hover:border-orange-500">
            调用预设
          </button>
          <button className="p-3 bg-white/5 hover:text-red-500 transition-all border border-white/10 opacity-0 group-hover:opacity-100">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function App() {
  const [view, setView] = useState<View>('archive')
  const [selectedCategory, setSelectedCategory] = useState<string>('全部')
  const [projectQuery, setProjectQuery] = useState('')
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const filteredTemplates = useMemo(() => {
    return selectedCategory === '全部'
      ? MOCK_TEMPLATES
      : MOCK_TEMPLATES.filter((t) => t.category === selectedCategory)
  }, [selectedCategory])

  const refreshProjectsFromDisk = async () => {
    const desk = window.flowidDesktop
    if (!desk?.readDirectory) {
      setProjects(MOCK_PROJECTS)
      return
    }
    const dir = String(loadLocalDiskPathsSettings().flowidProjectJsonPath || '').trim()
    if (!dir) {
      setProjects(MOCK_PROJECTS)
      return
    }
    setProjectsLoading(true)
    try {
      const res = await desk.readDirectory(dir, { recursive: true, maxFiles: 4000, maxDepth: 3 })
      if (!res?.ok || !Array.isArray(res.files)) {
        setProjects([])
        return
      }
      const files = res.files
        .filter((f) => String(f.name || '').toLowerCase().endsWith('.json'))
        .filter((f) => !/^flowid\.current\.json$/i.test(String(f.name || '').trim()))
        .sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0))
        .slice(0, 60)
      const mapped: Project[] = files.map((f, idx) => {
        const stem = String(f.name || '').replace(/\.[^.]+$/, '')
        const updatedAt = formatDate(Number(f.mtimeMs || 0))
        return {
          id: String(f.path || `${idx}`),
          name: stem || '未命名项目',
          updatedAt,
          createdAt: updatedAt,
          thumbnail: makeThumbDataUri(stem || String(f.path || '')),
          type: 'local',
          filePath: String(f.path || ''),
        }
      })
      setProjects(mapped.length ? mapped : [])
    } finally {
      setProjectsLoading(false)
    }
  }

  useEffect(() => {
    if (view !== 'archive') return
    void refreshProjectsFromDisk()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate
  }, [view])

  useEffect(() => {
    const onChanged = () => {
      if (view !== 'archive') return
      void refreshProjectsFromDisk()
    }
    window.addEventListener('flowid:local-disk-paths-changed', onChanged as EventListener)
    return () => {
      window.removeEventListener('flowid:local-disk-paths-changed', onChanged as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate
  }, [view])

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim()
    if (!q) return projects
    return projects.filter((p) => p.name.includes(q))
  }, [projectQuery, projects])

  const openProject = async (project: Project) => {
    const fp = String(project.filePath || '').trim()
    const desk = window.flowidDesktop
    if (fp && desk?.readUtf8File) {
      const res = await desk.readUtf8File(fp)
      if (res?.ok && res.text) {
        try {
          const snap = parseProjectFile(res.text)
          window.dispatchEvent(
            new CustomEvent('flowid:archive-open-project', {
              detail: {
                name: snap.name || project.name,
                snapshot: {
                  nodes: snap.nodes,
                  edges: snap.edges,
                  viewport: snap.viewport,
                },
                filePath: fp,
              },
            }),
          )
        } catch {
          // ignore parse errors; still enter workspace
        }
      }
    }
    setView('workspace')
  }

  const deleteProject = async (project: Project) => {
    const fp = String(project.filePath || '').trim()
    if (!fp) return
    if (!window.confirm(`确定删除项目「${project.name}」吗？\n将删除文件：\n${fp}`)) return
    const desk = window.flowidDesktop
    if (!desk?.deleteFile) {
      window.alert('当前环境不支持删除文件（仅桌面端可用）。')
      return
    }
    const res = await desk.deleteFile(fp)
    if (!res?.ok) {
      window.alert(`删除失败：${String(res?.error || 'unknown')}`)
      return
    }
    window.dispatchEvent(
      new CustomEvent('flowid:archive-deleted-project', {
        detail: { filePath: fp },
      }),
    )
    setProjects((prev) => prev.filter((p) => p.id !== project.id))
    if (view === 'archive') {
      void refreshProjectsFromDisk()
    }
  }

  useEffect(() => {
    const snapshot = loadLocalLicenseSnapshot()
    const notice = getLicenseNoticeMessage(snapshot)
    if (!notice || !snapshot) return
    window.alert(notice)
    saveLocalLicenseSnapshot({
      ...snapshot,
      lastNoticeAtMs: Date.now(),
    })
  }, [])

  return (
    <>
      <div className="fixed inset-0" style={{ display: view === 'workspace' ? 'block' : 'none' }}>
        <StudioApp onGoHome={() => setView('archive')} />
      </div>

      <div
        className="min-h-screen bg-[#080809] text-[#F0F0F0] font-sans selection:bg-orange-500/30 relative overflow-x-hidden"
        style={{ display: view === 'workspace' ? 'none' : 'block' }}
      >
      <div
        className="fixed inset-0 opacity-[0.05] pointer-events-none z-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, #fff 1.2px, transparent 1.2px)',
          backgroundSize: '48px 48px',
        }}
      />

      <Navigation activeView={view} setView={setView} />

      <main className="relative z-10 pt-32 px-16 md:px-32 pb-40">
        <AnimatePresence mode="wait">
          {view === 'archive' ? (
            <motion.div
              key="archive"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="max-w-6xl mx-auto"
            >
              <HeroBanner />

              <div className="flex items-end justify-between mb-20 flex-wrap gap-8">
                <div className="flex items-center gap-12">
                  <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic opacity-90 flex items-end gap-6">
                    项目档案
                    <div className="flex gap-2 mb-4">
                      <div className="w-20 h-3 bg-orange-600" />
                      <div className="w-8 h-3 bg-orange-600/40" />
                      <div className="w-4 h-3 bg-orange-600/20" />
                    </div>
                  </h1>
                </div>

                <div className="flex items-center gap-4 bg-[#111114] border border-white/5 p-1 rounded-full shadow-2xl pl-6 backdrop-blur-xl pointer-events-auto">
                  <Search className="w-4 h-4 text-white/50" />
                  <input
                    type="text"
                    placeholder="搜索项目档案..."
                    value={projectQuery}
                    onChange={(e) => setProjectQuery(e.target.value)}
                    className="bg-transparent border-none focus:ring-0 text-[14px] tracking-widest font-bold uppercase w-64 placeholder:text-gray-700 outline-none"
                  />
                  {projectQuery.trim() ? (
                    <button
                      type="button"
                      onClick={() => setProjectQuery('')}
                      className="px-3 py-2 rounded-full text-[12px] font-black uppercase tracking-widest text-white/45 hover:text-white hover:bg-white/5 transition-colors"
                      title="清空搜索"
                      aria-label="清空搜索"
                    >
                      清空
                    </button>
                  ) : null}
                  <button
                    onClick={() => setView('workspace')}
                    className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-2.5 rounded-full text-[14px] uppercase tracking-widest font-black transition-all shadow-xl shadow-orange-600/20 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    启动项目
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {projectsLoading ? (
                  <div className="col-span-full text-white/40 text-[12px] font-mono uppercase tracking-widest">
                    Loading local projects…
                  </div>
                ) : filteredProjects.length ? (
                  filteredProjects.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onClick={() => void openProject(p)}
                      onDelete={() => void deleteProject(p)}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-white/40 text-[12px] font-mono leading-relaxed tracking-wide">
                    未找到项目。请在「设置 → 本地存储」里配置“工程目录”，或检查目录下是否有工程 JSON 文件。
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="templates"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-6xl mx-auto"
            >
              <div className="mb-20">
                <div className="flex items-center gap-4 text-orange-500 font-black tracking-widest mb-6">
                  <span className="text-xs">PRESET_COLLECTION // V4.0</span>
                  <div className="h-[1px] w-12 bg-orange-600" />
                </div>
                <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic text-white/90 flex items-end gap-6">
                  预设模板
                  <div className="flex gap-2 mb-4">
                    <div className="w-20 h-3 bg-orange-600" />
                    <div className="w-8 h-3 bg-orange-600/40" />
                    <div className="w-4 h-3 bg-orange-600/20" />
                  </div>
                </h1>
              </div>

              <div className="flex gap-4 mb-16 overflow-x-auto pb-4">
                {TEMPLATE_CATEGORIES.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-8 py-3 rounded-full text-[14px] font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 border whitespace-nowrap ${
                      selectedCategory === category
                        ? 'bg-orange-600 border-orange-600 text-white shadow-orange-600/30'
                        : 'bg-[#111114] border-white/10 text-white/60 hover:border-white/20'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredTemplates.map((t) => (
                  <TemplateCard key={t.id} template={t} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      </div>
    </>
  )
}

export default App
