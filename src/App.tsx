import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  getLicenseNoticeMessage,
  loadLocalLicenseSnapshot,
  saveLocalLicenseSnapshot,
} from './lib/license'
import { Plus, Search, ChevronDown, Trash2, ImageUp } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { StudioApp } from './components/StudioApp'
import { FlowidMark } from './components/FlowidMark'
import { PresetTemplateCoverImage } from './components/PresetTemplateCoverImage'
import { loadLocalDiskPathsSettings } from './lib/localDiskPathsSettings'
import { parseProjectFile } from './lib/persistence'
import { computeAccessState, loadLicenseSnapshotV2 } from './lib/licenseAccess'
import { openStudioSettingsDeviceActivation } from './lib/studioSettingsOpen'
import {
  USER_AGREEMENT_TEXT,
  USER_AGREEMENT_VERSION,
  fetchRemoteUserAgreement,
} from './lib/userAgreement'
import './App.css'
import {
  PRESET_TEMPLATE_MOCKS,
  buildPresetTemplateCategoryTabs,
  fetchPresetTemplatesFromServer,
  fetchPresetTemplateWorkflowText,
  makePresetThumbDataUri,
  type PresetTemplate,
} from './lib/templateCatalog'
import { imageMimeTypeFromPath } from './lib/materialLibrary'
import {
  SYSTEM_PROMPT_COVER_EXT_TRIES,
  coverLeafForTry,
  joinDiskPath,
} from './lib/systemPromptCoverPaths'
import { saveCoverReplaceByTitle } from './lib/coverDisk'
import {
  InspirationMarketDetailPage,
  InspirationMarketGrid,
} from './components/home/InspirationMarketPages'

function isDesktopCoverIo(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      window.flowidDesktop?.writeBinaryFile &&
      window.flowidDesktop?.ensureDirectory,
  )
}

/** 预设模板页与项目档案：封面上传触发器统一为圆形，与项目卡片删除按钮同高宽以便对齐 */
const COVER_UPLOAD_TRIGGER_CLASS =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/65 backdrop-blur hover:border-orange-400/45 hover:bg-orange-600/22 hover:text-white transition-colors disabled:opacity-40'

type View = 'archive' | 'templates' | 'inspiration' | 'inspiration-detail' | 'workspace'

interface Project {
  id: string
  name: string
  updatedAt: string
  createdAt: string
  thumbnail: string
  type: 'local' | 'cloud'
  filePath?: string
}

type Template = PresetTemplate

const MOCK_PROJECTS: Project[] = [
  {
    id: '1',
    name: '电商模特项目',
    updatedAt: '2026/04/24 12:00',
    createdAt: '2026/04/20 09:30',
    thumbnail:
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
    type: 'local',
  },
  {
    id: '2',
    name: '分镜脚本 A',
    updatedAt: '2026/04/23 15:20',
    createdAt: '2026/04/18 10:00',
    thumbnail:
      'https://images.unsplash.com/photo-1633167606207-d840b5070fc2?q=80&w=2564&auto=format&fit=crop',
    type: 'local',
  },
  {
    id: '3',
    name: '未命名项目 111',
    updatedAt: '2026/04/24 08:45',
    createdAt: '2026/04/24 08:45',
    thumbnail:
      'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=2564&auto=format&fit=crop',
    type: 'cloud',
  },
  {
    id: '4',
    name: '景观渲染方案 B',
    updatedAt: '2026/04/22 18:00',
    createdAt: '2026/04/15 11:15',
    thumbnail:
      'https://images.unsplash.com/photo-1605142127394-ba5f403063f1?q=80&w=2564&auto=format&fit=crop',
    type: 'local',
  },
]

function formatDateTimeZh(ts: number): string {
  if (!Number.isFinite(ts)) return '-'
  try {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}/${m}/${day} ${h}:${min}`
  } catch {
    return '-'
  }
}

/** 首页「新建项目」用：单调递增序号，避免随机三位数看起来「跳号」。 */
const UNNAMED_PROJECT_SEQ_KEY = 'flowid.unnamed-project-seq.v1'

function nextUnnamedProjectDisplayNumber(): number {
  try {
    const raw = localStorage.getItem(UNNAMED_PROJECT_SEQ_KEY)
    let cur = Number.parseInt(String(raw || '0'), 10)
    if (!Number.isFinite(cur) || cur < 0) cur = 0
    const next = cur + 1
    localStorage.setItem(UNNAMED_PROJECT_SEQ_KEY, String(next))
    return next
  } catch {
    return Math.floor(Math.random() * 900 + 100)
  }
}

function Navigation({
  activeView,
  setView,
  accessState,
  onOpenLicense,
}: {
  activeView: View
  setView: (v: View) => void
  accessState: 'unauthorized' | 'valid' | 'expired' | 'tampered_need_verify'
  onOpenLicense: () => void
}) {
  return (
    <header className="fixed top-6 inset-x-8 h-14 flex items-center justify-between z-50 pointer-events-none">
      <div className="flex items-center gap-4 pointer-events-auto">
        <div className="flex items-center gap-3 bg-[#111114] border border-white/5 px-6 py-2.5 rounded-full shadow-2xl backdrop-blur-xl">
          <FlowidMark />
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
            <button
              onClick={() => setView('inspiration')}
              className={`text-[14px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full transition-all ${
                activeView === 'inspiration' || activeView === 'inspiration-detail'
                  ? 'text-orange-500 bg-orange-500/10'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              灵感市集
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pointer-events-auto">
        <button
          className="bg-white text-black font-black text-[14px] uppercase tracking-widest px-8 py-2.5 rounded-full hover:bg-orange-500 hover:text-white transition-all shadow-xl"
          onClick={onOpenLicense}
        >
          {accessState === 'valid'
            ? '会员已激活'
            : accessState === 'expired'
              ? '授权已过期'
              : accessState === 'tampered_need_verify'
                ? '授权需校验'
                : '输入授权码'}
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
  onUploadCover,
  coverUploadBusy,
  onCoverFileDrop,
}: {
  project: Project
  onClick?: () => void
  onDelete?: () => void
  onUploadCover?: () => void
  coverUploadBusy?: boolean
  /** 已有本地封面时用于拖拽替换（不显示上传按钮时仍可用） */
  onCoverFileDrop?: (file: File) => void | Promise<void>
}) {
  const canDropReplaceCover =
    Boolean(onCoverFileDrop) &&
    isDesktopCoverIo() &&
    String(project.thumbnail || '').startsWith('blob:')

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
      className="group bg-[#111114] border border-white/5 rounded-2xl overflow-hidden shadow-2xl relative"
    >
      <div
        className="aspect-[16/10] bg-[#0A0A0C] relative overflow-hidden"
        title={canDropReplaceCover ? '拖拽新图片到此处可替换封面' : undefined}
        onDragOver={(e) => {
          if (!canDropReplaceCover) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          if (!canDropReplaceCover || !onCoverFileDrop) return
          e.preventDefault()
          e.stopPropagation()
          const f = e.dataTransfer.files?.[0]
          if (!f || !String(f.type || '').startsWith('image/')) return
          void onCoverFileDrop(f)
        }}
      >
        {project.thumbnail ? (
          <img
            src={project.thumbnail}
            alt=""
            className="w-full h-full object-cover opacity-30 group-hover:scale-110 group-hover:opacity-80 transition-all duration-700"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#080809] to-transparent opacity-60" />

        {project.filePath ? (
          <div
            className={`absolute top-4 right-4 z-[2] flex flex-row items-center gap-2 transition-all ${
              project.thumbnail
                ? 'translate-y-4 opacity-0 pointer-events-none group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto'
                : 'translate-y-0 opacity-100 pointer-events-auto'
            }`}
          >
            {onUploadCover ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onUploadCover()
                }}
                disabled={coverUploadBusy}
                className={COVER_UPLOAD_TRIGGER_CLASS}
                aria-label="上传或替换项目封面"
                title="上传或替换封面（保存到「设置 → 封面存储」，以项目名为文件名）"
              >
                <ImageUp className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete?.()
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/60 backdrop-blur border border-white/10 text-white/40 hover:text-red-500 transition-all"
              aria-label="删除项目"
              title="删除项目（悬停卡片后显示；将删除磁盘上的工程 JSON）"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ) : null}

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
              <span>更新: {project.updatedAt}</span>
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

function TemplateCard({
  template,
  busy,
  onInvoke,
  coverUploadBusy,
  onUploadCover,
}: {
  template: Template
  busy: boolean
  onInvoke: (t: Template) => void | Promise<void>
  coverUploadBusy?: boolean
  onUploadCover?: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -10 }}
      className="group bg-[#0A0A0B] border border-white/5 overflow-hidden transition-all duration-500 hover:border-orange-500/30"
    >
      <div className="aspect-[16/10] relative overflow-hidden">
        <PresetTemplateCoverImage
          title={template.name}
          fallbackSrc={template.image}
          alt={template.name}
          className="w-full h-full object-cover grayscale opacity-50 group-hover:opacity-100 group-hover:grayscale-0 transition-all duration-1000 group-hover:scale-110 pointer-events-none"
        />
        <div className="absolute top-4 left-4 z-10">
          <div className="bg-black/60 backdrop-blur px-3 py-1 border border-white/10 rounded text-[13px] font-mono uppercase tracking-widest text-orange-500">
            {template.category}
          </div>
        </div>
        <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
          {onUploadCover ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onUploadCover()
              }}
              disabled={coverUploadBusy}
              className={COVER_UPLOAD_TRIGGER_CLASS}
              title="上传封面（与画布左侧预设模板同步；保存到「设置 → 封面存储」）"
              aria-label="上传预设模板封面"
            >
              <ImageUp className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          ) : null}
        </div>
        <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
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
          <button
            type="button"
            className="w-full py-3 bg-white/5 hover:bg-orange-600 hover:text-white transition-all text-[14px] font-black uppercase tracking-widest border border-white/10 group-hover:border-orange-500 disabled:opacity-50 disabled:pointer-events-none"
            disabled={busy}
            onClick={() => void onInvoke(template)}
          >
            {busy ? '加载中…' : '调用预设'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function readAcceptedAgreementV2Ms(): number | null {
  try {
    const raw = localStorage.getItem('flowid.userAgreement.accepted.v2')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { serverUpdatedAtMs?: number } | null
    const n = Number(parsed?.serverUpdatedAtMs)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function readAcceptedAgreementV1Ok(): boolean {
  try {
    const raw = localStorage.getItem('flowid.userAgreement.accepted.v1')
    if (!raw) return false
    const parsed = JSON.parse(raw) as { version?: string } | null
    return Boolean(parsed && parsed.version === USER_AGREEMENT_VERSION)
  } catch {
    return false
  }
}

function App() {
  const [agreementAccepted, setAgreementAccepted] = useState<boolean>(() => {
    try {
      const v2 = readAcceptedAgreementV2Ms()
      if (v2 != null) return true
      return readAcceptedAgreementV1Ok()
    } catch {
      return false
    }
  })
  const [agreementDisplay, setAgreementDisplay] = useState<{
    version: string
    text: string
    updatedAtMs: number
  }>({
    version: USER_AGREEMENT_VERSION,
    text: USER_AGREEMENT_TEXT,
    updatedAtMs: 0,
  })
  const [agreementShowFull, setAgreementShowFull] = useState(false)

  const [view, setView] = useState<View>('archive')
  const [inspirationDetailId, setInspirationDetailId] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('全部')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectPage, setProjectPage] = useState(0)
  const [templatePage, setTemplatePage] = useState(0)
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [licenseSnap, setLicenseSnap] = useState(() => loadLicenseSnapshotV2())
  const [templateCatalogFromServer, setTemplateCatalogFromServer] = useState<{
    ok: true
    items: Template[]
  } | null>(null)
  const [templateInvokeBusyId, setTemplateInvokeBusyId] = useState<string | null>(null)
  const [coverUploadBusyId, setCoverUploadBusyId] = useState<string | null>(null)
  const [presetTemplateCoverBusyId, setPresetTemplateCoverBusyId] = useState<string | null>(null)
  const projectThumbBlobUrlsRef = useRef<string[]>([])
  const projectCoverFileInputRef = useRef<HTMLInputElement>(null)
  const projectCoverPickIdRef = useRef<string | null>(null)
  const projectCoverPickNameRef = useRef<string | null>(null)
  const presetTemplateCoverFileInputRef = useRef<HTMLInputElement>(null)
  const presetTemplateCoverPickRef = useRef<{ id: string; name: string } | null>(null)

  const accessState = computeAccessState(licenseSnap)

  const openTemplateAsProject = useCallback(async (template: Template) => {
    setTemplateInvokeBusyId(template.id)
    try {
      const text = await fetchPresetTemplateWorkflowText(template.id)
      const snap = parseProjectFile(text)
      window.dispatchEvent(
        new CustomEvent('flowid:archive-open-project', {
          detail: {
            name: snap.name || template.name,
            snapshot: {
              nodes: snap.nodes,
              edges: snap.edges,
              viewport: snap.viewport,
            },
          },
        }),
      )
      setView('workspace')
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      if (msg === 'MEMBER_ONLY') {
        window.alert('该模板为会员内容，请在设置 → 授权码中完成授权。')
        setView('workspace')
        openStudioSettingsDeviceActivation()
        return
      }
      window.alert(msg)
    } finally {
      setTemplateInvokeBusyId(null)
    }
  }, [])

  const refreshTemplateCatalog = useCallback(async () => {
    const fromServer = await fetchPresetTemplatesFromServer()
    setTemplateCatalogFromServer(fromServer)
  }, [])

  const baseTemplateSource = useMemo(() => {
    return templateCatalogFromServer?.ok ? templateCatalogFromServer.items : PRESET_TEMPLATE_MOCKS
  }, [templateCatalogFromServer])

  const templateCategoryOptions = useMemo(
    () => buildPresetTemplateCategoryTabs(baseTemplateSource, true),
    [baseTemplateSource],
  )

  useEffect(() => {
    setSelectedCategory((cur) => (templateCategoryOptions.includes(cur) ? cur : '全部'))
  }, [templateCategoryOptions])

  const filteredTemplates = useMemo(() => {
    const byCat =
      selectedCategory === '全部'
        ? baseTemplateSource
        : baseTemplateSource.filter((t) => t.category === selectedCategory)
    return byCat
  }, [baseTemplateSource, selectedCategory])

  useEffect(() => {
    setTemplatePage(0)
  }, [selectedCategory])

  const pagedTemplates = useMemo(() => {
    // 参考 @flowid (2)：三列网格时一页两行更舒适（6 个）
    const pageSize = 6
    const total = filteredTemplates.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.max(0, Math.min(totalPages - 1, Math.floor(Number(templatePage || 0) || 0)))
    const start = page * pageSize
    return { page, pageSize, total, totalPages, items: filteredTemplates.slice(start, start + pageSize) }
  }, [filteredTemplates, templatePage])

  useEffect(() => {
    void refreshTemplateCatalog()
  }, [refreshTemplateCatalog])

  useEffect(() => {
    const onChanged = () => {
      setLicenseSnap(loadLicenseSnapshotV2())
      void refreshTemplateCatalog()
    }
    window.addEventListener('flowid:license-changed', onChanged as EventListener)
    return () => window.removeEventListener('flowid:license-changed', onChanged as EventListener)
  }, [refreshTemplateCatalog])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await fetchRemoteUserAgreement()
      if (cancelled) return
      if (remote) {
        setAgreementDisplay({
          version: remote.version,
          text: remote.text,
          updatedAtMs: remote.updatedAtMs,
        })
        const v2 = readAcceptedAgreementV2Ms()
        const need = v2 == null || remote.updatedAtMs > v2
        setAgreementAccepted(!need)
        return
      }
      setAgreementDisplay({
        version: USER_AGREEMENT_VERSION,
        text: USER_AGREEMENT_TEXT,
        updatedAtMs: 0,
      })
      setAgreementAccepted(readAcceptedAgreementV1Ok())
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onLicenseChanged = () => {
      void (async () => {
        const remote = await fetchRemoteUserAgreement()
        if (remote) {
          setAgreementDisplay({
            version: remote.version,
            text: remote.text,
            updatedAtMs: remote.updatedAtMs,
          })
          const v2 = readAcceptedAgreementV2Ms()
          const need = v2 == null || remote.updatedAtMs > v2
          setAgreementAccepted(!need)
          return
        }
        setAgreementDisplay({
          version: USER_AGREEMENT_VERSION,
          text: USER_AGREEMENT_TEXT,
          updatedAtMs: 0,
        })
        setAgreementAccepted(readAcceptedAgreementV1Ok())
      })()
    }
    window.addEventListener('flowid:license-changed', onLicenseChanged as EventListener)
    return () => window.removeEventListener('flowid:license-changed', onLicenseChanged as EventListener)
  }, [])

  const refreshProjectsFromDisk = async () => {
    for (const u of projectThumbBlobUrlsRef.current) {
      try {
        URL.revokeObjectURL(u)
      } catch {
        /* ignore */
      }
    }
    projectThumbBlobUrlsRef.current = []

    const desk = window.flowidDesktop
    if (!desk?.readDirectory) {
      setProjects(import.meta.env.PROD ? [] : MOCK_PROJECTS)
      return
    }
    const dir = String(loadLocalDiskPathsSettings().flowidProjectJsonPath || '').trim()
    if (!dir) {
      // 生产包不要用无 filePath 的 MOCK，否则删除等操作会静默无效、易误解。
      setProjects(import.meta.env.PROD ? [] : MOCK_PROJECTS)
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
      const coverRoot = String(loadLocalDiskPathsSettings().systemPromptCoverPath || '').trim()
      const readBinaryFile = desk.readBinaryFile
      const mapped: Project[] = await Promise.all(
        files.map(async (f, idx) => {
          const stem = String(f.name || '').replace(/\.[^.]+$/, '')
          const mtime = Number(f.mtimeMs || 0)
          const bRaw = Number((f as { birthtimeMs?: number }).birthtimeMs)
          const birthMs = Number.isFinite(bRaw) && bRaw > 0 ? bRaw : mtime
          const updatedAt = formatDateTimeZh(mtime)
          const createdAt = formatDateTimeZh(birthMs)
          let thumbnail = makePresetThumbDataUri(stem || String(f.path || ''))
          if (coverRoot && readBinaryFile) {
            for (const ext of SYSTEM_PROMPT_COVER_EXT_TRIES) {
              const leaf = coverLeafForTry(stem, ext)
              const fp = joinDiskPath(coverRoot, leaf)
              const r = await readBinaryFile(fp)
              if (r.ok && r.data && r.data.byteLength > 0) {
                const mime = imageMimeTypeFromPath(fp)
                const blobUrl = URL.createObjectURL(new Blob([r.data], { type: mime }))
                projectThumbBlobUrlsRef.current.push(blobUrl)
                thumbnail = blobUrl
                break
              }
            }
          }
          return {
            id: String(f.path || `${idx}`),
            name: stem || '未命名项目',
            updatedAt,
            createdAt,
            thumbnail,
            type: 'local' as const,
            filePath: String(f.path || ''),
          }
        }),
      )
      setProjects(mapped.length ? mapped : [])
    } finally {
      setProjectsLoading(false)
    }
  }

  const saveProjectCoverToDisk = async (project: Project, file: File) => {
    const r = await saveCoverReplaceByTitle(project.name, file)
    if (!r.ok) {
      window.alert(r.error)
      return
    }
    void refreshProjectsFromDisk()
  }

  const requestProjectCoverUpload = (project: Project) => {
    if (!project.filePath) return
    projectCoverPickIdRef.current = project.id
    projectCoverPickNameRef.current = project.name
    queueMicrotask(() => projectCoverFileInputRef.current?.click())
  }

  const onProjectCoverFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const id = projectCoverPickIdRef.current
    const nameSnap = projectCoverPickNameRef.current
    e.target.value = ''
    projectCoverPickIdRef.current = null
    projectCoverPickNameRef.current = null
    if (!file || !id || !nameSnap) return
    const stub: Project = {
      id,
      name: nameSnap,
      updatedAt: '',
      createdAt: '',
      thumbnail: '',
      type: 'local',
      filePath: id,
    }
    setCoverUploadBusyId(id)
    try {
      await saveProjectCoverToDisk(stub, file)
    } finally {
      setCoverUploadBusyId(null)
    }
  }

  const requestPresetTemplateCoverUpload = (template: Template) => {
    presetTemplateCoverPickRef.current = { id: template.id, name: template.name }
    queueMicrotask(() => presetTemplateCoverFileInputRef.current?.click())
  }

  const onPresetTemplateCoverFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const pick = presetTemplateCoverPickRef.current
    e.target.value = ''
    presetTemplateCoverPickRef.current = null
    if (!file || !pick) return
    setPresetTemplateCoverBusyId(pick.id)
    try {
      const r = await saveCoverReplaceByTitle(pick.name, file)
      if (!r.ok) window.alert(r.error)
    } finally {
      setPresetTemplateCoverBusyId(null)
    }
  }

  useEffect(() => {
    if (view !== 'archive') return
    void refreshProjectsFromDisk()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate
  }, [view])

  useEffect(() => {
    // 路径在「工作区设置」里保存时，App 可能处于 workspace 视图；此处必须始终刷新列表，回到档案页才是新数据。
    const onChanged = () => {
      void refreshProjectsFromDisk()
    }
    window.addEventListener('flowid:local-disk-paths-changed', onChanged as EventListener)
    return () => {
      window.removeEventListener('flowid:local-disk-paths-changed', onChanged as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate
  }, [])

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim()
    if (!q) return projects
    return projects.filter((p) => p.name.includes(q))
  }, [projectQuery, projects])

  useEffect(() => {
    setProjectPage(0)
  }, [projectQuery, projects])

  const archiveItems = useMemo(() => {
    const base = filteredProjects.slice()
    base.push({
      id: '__new__',
      name: '新建项目',
      updatedAt: '',
      createdAt: '',
      thumbnail: '',
      type: 'local',
    })
    return base
  }, [filteredProjects])

  const pagedArchive = useMemo(() => {
    // 参考 @flowid (2)：两列网格更舒适的翻页密度（每页 4 个卡片）
    const pageSize = 4
    const total = archiveItems.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.max(0, Math.min(totalPages - 1, Math.floor(Number(projectPage || 0) || 0)))
    const start = page * pageSize
    return { page, pageSize, total, totalPages, items: archiveItems.slice(start, start + pageSize) }
  }, [archiveItems, projectPage])

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

  const createNewProject = () => {
    const name = `未命名项目 ${nextUnnamedProjectDisplayNumber()}`
    window.dispatchEvent(
      new CustomEvent('flowid:archive-open-project', {
        detail: {
          name,
          snapshot: {
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      }),
    )
    setView('workspace')
  }

  const deleteProject = async (project: Project) => {
    const fp = String(project.filePath || '').trim()
    if (!fp) {
      window.alert(
        '此卡片没有关联的磁盘 JSON 路径（多为开发环境示例数据，或尚未配置工程目录）。\n请先在「设置 → 本地存储」里配置「工程 JSON 目录」，刷新列表后再删除真实项目文件。',
      )
      return
    }
    const desk = window.flowidDesktop
    let allow = false
    if (desk?.confirmDialog) {
      const cr = await desk.confirmDialog({
        message: `确定删除项目「${project.name}」吗？`,
        detail: `将删除文件：\n${fp}`,
      })
      allow = Boolean(cr?.confirmed)
    } else {
      allow = window.confirm(`确定删除项目「${project.name}」吗？\n将删除文件：\n${fp}`)
    }
    if (!allow) return
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
      <input
        ref={projectCoverFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        onChange={(ev) => void onProjectCoverFileInputChange(ev)}
      />
      <input
        ref={presetTemplateCoverFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        onChange={(ev) => void onPresetTemplateCoverFileInputChange(ev)}
      />
      {!agreementAccepted ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-[min(880px,calc(100vw-48px))] max-h-[min(82vh,calc(100vh-64px))] rounded-3xl border border-white/10 bg-[#0c0c0e] shadow-[0_0_120px_rgba(0,0,0,0.75)] overflow-hidden">
            <div className="px-8 py-6 border-b border-white/10 flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-[14px] font-black uppercase tracking-[0.35em] text-white/50">
                  用户协议
                </div>
                <div className="text-[18px] font-black tracking-wider text-white/90">
                  首次启动需同意协议
                </div>
              </div>
              <button
                type="button"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-black uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setAgreementShowFull((v) => !v)}
              >
                {agreementShowFull ? '收起全文' : '查看全文'}
              </button>
            </div>
            <div className="px-8 py-6 space-y-5 overflow-y-auto custom-scrollbar max-h-[calc(82vh-140px)]">
              <div className="text-[14px] leading-relaxed text-white/55 space-y-2">
                <div>感谢您使用本软件。本协议构成您与本软件运营方之间的有效法律约定。</div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-[14px] font-black text-white/80">摘要要点</div>
                  <ul className="mt-2 m-0 list-disc pl-6 space-y-1">
                    <li>本软件为本地工具：调用您自行配置的第三方 API，不内置模型能力</li>
                    <li>本软件不收集、不存储用户数据；生成内容责任由用户与其 API 服务商承担</li>
                    <li>不得用于违法用途；违规产生的后果由用户自行承担</li>
                    <li>第三方服务变更/故障导致的损失，本软件不承担责任</li>
                  </ul>
                </div>
                <div className="text-[12px] text-white/35">
                  点击「同意并进入」表示您已阅读、理解并同意受本协议约束（版本 {agreementDisplay.version}
                  {agreementDisplay.updatedAtMs
                    ? ` · 修订 ${new Date(agreementDisplay.updatedAtMs).toLocaleString('zh-CN')}`
                    : ''}）。
                </div>
              </div>

              {agreementShowFull ? (
                <textarea
                  readOnly
                  value={agreementDisplay.text}
                  className="custom-scrollbar w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-[13px] font-mono text-white/65 outline-none whitespace-pre-wrap leading-relaxed max-h-[46vh] resize-y"
                  aria-label="用户协议全文（只读）"
                />
              ) : null}

              <div className="flex flex-wrap gap-3 justify-end pt-1">
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-[12px] font-black uppercase tracking-widest text-white/45 hover:text-white hover:bg-white/10 transition-colors"
                  onClick={() => {
                    try {
                      window.close()
                    } catch {
                      // ignore
                    }
                    window.alert('如不同意协议，请关闭软件后停止使用。')
                  }}
                >
                  不同意
                </button>
                <button
                  type="button"
                  className="rounded-full border border-orange-600/30 bg-orange-600 px-6 py-2.5 text-[12px] font-black uppercase tracking-widest text-white shadow-xl shadow-orange-600/20 hover:bg-orange-500 transition-colors"
                  onClick={() => {
                    const now = Date.now()
                    const v = agreementDisplay.version
                    const ms = agreementDisplay.updatedAtMs
                    localStorage.setItem(
                      'flowid.userAgreement.accepted.v1',
                      JSON.stringify({ version: v, acceptedAtMs: now }),
                    )
                    localStorage.setItem(
                      'flowid.userAgreement.accepted.v2',
                      JSON.stringify({ serverUpdatedAtMs: ms, acceptedAtMs: now }),
                    )
                    setAgreementAccepted(true)
                  }}
                >
                  同意并进入
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

      <Navigation
        activeView={view}
        setView={setView}
        accessState={accessState}
        onOpenLicense={() => {
          setView('workspace')
          openStudioSettingsDeviceActivation()
        }}
      />

      {view === 'inspiration-detail' && inspirationDetailId ? (
        <InspirationMarketDetailPage
          id={inspirationDetailId}
          onBackHome={() => {
            setInspirationDetailId(null)
            setView('archive')
          }}
          onBackMarket={() => {
            setInspirationDetailId(null)
            setView('inspiration')
          }}
        />
      ) : null}

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
                ) : pagedArchive.items.length ? (
                  pagedArchive.items.map((p) =>
                    p.id === '__new__' ? (
                      <motion.button
                        key="__new__"
                        type="button"
                        onClick={createNewProject}
                        className="group bg-[#111114] border border-white/5 rounded-2xl overflow-hidden shadow-2xl relative text-left"
                        whileHover={{ y: -5 }}
                      >
                        <div className="aspect-[16/10] bg-[#0A0A0C] relative overflow-hidden flex items-center justify-center">
                          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 group-hover:text-white group-hover:bg-orange-600/20 group-hover:border-orange-500/30 transition-all">
                            <Plus className="w-6 h-6" />
                          </div>
                          <div className="absolute inset-0 bg-gradient-to-t from-[#080809] to-transparent opacity-70" />
                        </div>
                        <div className="p-8">
                          <h3 className="text-3xl font-black tracking-tighter uppercase italic text-white/70 group-hover:text-orange-500 transition-colors mb-3 leading-none">
                            新建项目
                          </h3>
                          <div className="text-[13px] font-mono uppercase tracking-[0.2em] text-white/40">
                            空白工程 // Start
                          </div>
                        </div>
                      </motion.button>
                    ) : (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        onClick={() => void openProject(p)}
                        onDelete={() => void deleteProject(p)}
                        onUploadCover={p.filePath ? () => requestProjectCoverUpload(p) : undefined}
                        coverUploadBusy={coverUploadBusyId === p.id}
                        onCoverFileDrop={
                          p.filePath
                            ? async (file) => {
                                setCoverUploadBusyId(p.id)
                                try {
                                  await saveProjectCoverToDisk(p, file)
                                } finally {
                                  setCoverUploadBusyId(null)
                                }
                              }
                            : undefined
                        }
                      />
                    ),
                  )
                ) : (
                  <div className="col-span-full text-white/40 text-[12px] font-mono leading-relaxed tracking-wide">
                    未找到项目。请在「设置 → 本地存储」里配置“工程目录”，或检查目录下是否有工程 JSON 文件。
                  </div>
                )}
              </div>

              {pagedArchive.totalPages > 1 ? (
                <div className="mt-16 flex items-center justify-center gap-3 pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => setProjectPage((p) => Math.max(0, p - 1))}
                    disabled={pagedArchive.page <= 0}
                    className="w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-35 disabled:pointer-events-none transition-all"
                    aria-label="上一页"
                  >
                    ←
                  </button>
                  {Array.from({ length: pagedArchive.totalPages }).map((_, idx) => {
                    const n = String(idx + 1).padStart(2, '0')
                    const active = idx === pagedArchive.page
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setProjectPage(idx)}
                        className={`w-12 h-12 rounded-full border transition-all font-black tracking-widest ${
                          active
                            ? 'bg-orange-600 border-orange-500/40 text-white shadow-xl shadow-orange-600/20'
                            : 'bg-white/5 border-white/10 text-white/55 hover:text-white hover:bg-white/10'
                        }`}
                        aria-label={`第 ${idx + 1} 页`}
                      >
                        {n}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => setProjectPage((p) => Math.min(pagedArchive.totalPages - 1, p + 1))}
                    disabled={pagedArchive.page >= pagedArchive.totalPages - 1}
                    className="w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-35 disabled:pointer-events-none transition-all"
                    aria-label="下一页"
                  >
                    →
                  </button>
                </div>
              ) : null}
            </motion.div>
          ) : view === 'templates' ? (
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
                {templateCategoryOptions.map((category) => (
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
                {pagedTemplates.items.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    busy={templateInvokeBusyId === t.id}
                    onInvoke={openTemplateAsProject}
                    coverUploadBusy={presetTemplateCoverBusyId === t.id}
                    onUploadCover={
                      isDesktopCoverIo() &&
                      String(loadLocalDiskPathsSettings().systemPromptCoverPath || '').trim()
                        ? () => requestPresetTemplateCoverUpload(t)
                        : undefined
                    }
                  />
                ))}
              </div>

              {pagedTemplates.totalPages > 1 ? (
                <div className="mt-16 flex items-center justify-center gap-3 pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => setTemplatePage((p) => Math.max(0, p - 1))}
                    disabled={pagedTemplates.page <= 0}
                    className="w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-35 disabled:pointer-events-none transition-all"
                    aria-label="上一页"
                  >
                    ←
                  </button>
                  {Array.from({ length: pagedTemplates.totalPages }).map((_, idx) => {
                    const n = String(idx + 1).padStart(2, '0')
                    const active = idx === pagedTemplates.page
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setTemplatePage(idx)}
                        className={`w-12 h-12 rounded-full border transition-all font-black tracking-widest ${
                          active
                            ? 'bg-orange-600 border-orange-500/40 text-white shadow-xl shadow-orange-600/20'
                            : 'bg-white/5 border-white/10 text-white/55 hover:text-white hover:bg-white/10'
                        }`}
                        aria-label={`第 ${idx + 1} 页`}
                      >
                        {n}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => setTemplatePage((p) => Math.min(pagedTemplates.totalPages - 1, p + 1))}
                    disabled={pagedTemplates.page >= pagedTemplates.totalPages - 1}
                    className="w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-35 disabled:pointer-events-none transition-all"
                    aria-label="下一页"
                  >
                    →
                  </button>
                </div>
              ) : null}
            </motion.div>
          ) : view === 'inspiration' ? (
            <motion.div
              key="inspiration"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-6xl mx-auto"
            >
              <InspirationMarketGrid
                onOpenDetail={(itemId) => {
                  setInspirationDetailId(itemId)
                  setView('inspiration-detail')
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
      </div>
    </>
  )
}

export default App
