import { useMemo, useState } from 'react'

type Props = {
  disabled?: boolean
  onConfirm: (summary: string) => void
}

const TIERS = [
  { id: 'pro' as const, title: 'Pro', subtitle: '满血版' },
  { id: 'fast' as const, title: 'Fast', subtitle: '更快速、更便宜' },
]

const RESOLUTIONS = ['720p', '480p'] as const

const PLAN_OPTIONS = [
  {
    id: 'multi-ref' as const,
    title: '多图参考',
    desc: '直接生成视频，更快、更便宜、更流畅。',
    gradient: 'linear-gradient(135deg,#7c3aed,#db2777)',
  },
  {
    id: 'grid' as const,
    title: '宫格图',
    desc: '从分镜图开始，更可控，更专业。',
    gradient: 'linear-gradient(135deg,#0891b2,#6366f1)',
  },
]

/**
 * 分镜方案确认卡：Pro/Fast + 720p/480p + 多图参考/宫格（对齐参考截图）。
 */
export function DramaStoryboardPlanCard({ disabled, onConfirm }: Props) {
  const [tier, setTier] = useState<'pro' | 'fast'>('fast')
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>('480p')
  const [planId, setPlanId] = useState<(typeof PLAN_OPTIONS)[number]['id']>('multi-ref')

  const plan = useMemo(() => PLAN_OPTIONS.find((p) => p.id === planId) ?? PLAN_OPTIONS[0], [planId])
  const modelLabel = tier === 'pro' ? 'Seedance 2.0 Pro' : 'seedance2.0fast'

  return (
    <div className="drama-storyboard-plan">
      <p className="drama-storyboard-plan__lead">在开始为你制作分镜视频之前，想跟你确认一下分镜方案</p>
      <div className="drama-storyboard-plan__tiers">
        {TIERS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`drama-storyboard-plan__tier${tier === t.id ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => setTier(t.id)}
          >
            <strong>{t.title}</strong>
            <span>{t.subtitle}</span>
          </button>
        ))}
      </div>
      <div className="drama-storyboard-plan__models">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            type="button"
            className={`drama-storyboard-plan__model${resolution === r ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => setResolution(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <p className="drama-storyboard-plan__section-label">分镜方案：</p>
      <div className="drama-storyboard-plan__options">
        {PLAN_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`drama-storyboard-plan__option${planId === opt.id ? ' is-active' : ''}`}
            disabled={disabled}
            onClick={() => setPlanId(opt.id)}
          >
            <div className="drama-storyboard-plan__option-thumb" style={{ backgroundImage: opt.gradient }} aria-hidden />
            <div>
              <strong>{opt.title}</strong>
              <p>{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="drama-storyboard-plan__confirm"
        disabled={disabled}
        onClick={() =>
          onConfirm(
            `【用户选择】确认分镜方案：${modelLabel} · ${resolution} · ${plan.title} · ${tier === 'pro' ? 'Pro满血版' : 'Fast'}`,
          )
        }
      >
        确认并继续
      </button>
    </div>
  )
}
