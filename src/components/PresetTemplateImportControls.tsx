import { useRef, useState } from 'react'
import { importPresetTemplateZipFile } from '../lib/importPresetTemplatePackage'

type Props = {
  /** 紧凑样式（画布左侧栏） */
  compact?: boolean
  canvasDayMode?: boolean
  onImported?: (info: { catalogId: string; name: string }) => void
  onError?: (message: string) => void
}

/**
 * 导入 `.flowid-preset.zip` 到本机「我的预设」。
 */
export function PresetTemplateImportControls({
  compact = false,
  canvasDayMode = false,
  onImported,
  onError,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onPickFile = async (file: File | null | undefined) => {
    if (!file || busy) return
    setBusy(true)
    try {
      const r = await importPresetTemplateZipFile(file)
      onImported?.(r)
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e || '导入失败')
      onError?.(msg)
      window.alert(`导入预设失败：${msg}`)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const btnClass = compact
    ? canvasDayMode
      ? 'w-full rounded-lg border border-[#E8E8E8] bg-[#FAFAFA] px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#525252] hover:bg-[#F0F0F0] disabled:opacity-50'
      : 'w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 hover:bg-white/10 disabled:opacity-50'
    : 'rounded-full border border-white/15 bg-white/10 px-5 py-2 text-[12px] font-black uppercase tracking-widest text-white/85 hover:bg-white/15 disabled:opacity-50'

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => void onPickFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className={btnClass}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? '导入中…' : compact ? '导入预设包' : '导入预设包 (.zip)'}
      </button>
    </>
  )
}
