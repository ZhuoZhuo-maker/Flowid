import { Check } from 'lucide-react'

type Props = {
  styleLabel: string
  characterCount?: number
  characterNames?: string[]
}

/**
 * 场景风格推荐卡（图一：呢喃活力动感卡漫 + 已用角色头像）。
 */
export function DramaSceneStyleRecommendCard({
  styleLabel,
  characterCount = 6,
  characterNames = ['林宇', '班长', '李明', '女同学', '老师', '张伟'],
}: Props) {
  return (
    <div className="drama-scene-style-card">
      <div className="drama-scene-style-card__head">
        <Check size={14} strokeWidth={2.5} aria-hidden />
        <span>查找并推荐风格</span>
      </div>
      <div className="drama-scene-style-card__body">
        <div className="drama-scene-style-card__thumb" aria-hidden />
        <div className="drama-scene-style-card__meta">
          <strong>风格：{styleLabel}</strong>
          <p>已用于 {characterCount} 个角色</p>
          <div className="drama-scene-style-card__avatars">
            {characterNames.slice(0, characterCount).map((name) => (
              <span key={name} title={name} aria-label={name} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
