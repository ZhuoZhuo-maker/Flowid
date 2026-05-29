type Props = {
  title: string
  primaryLabel: string
  secondaryLabel?: string
  disabled?: boolean
  onPick: (option: string) => void
}

/**
 * 通用满意度双按钮（剧本 / 角色 / 场景等阶段复用）。
 */
export function DramaSatisfactionPrompt({
  title,
  primaryLabel,
  secondaryLabel = '我要修改',
  disabled,
  onPick,
}: Props) {
  return (
    <div className="drama-satisfaction">
      <p className="drama-satisfaction__title">{title}</p>
      <button
        type="button"
        className="drama-satisfaction__btn drama-satisfaction__btn--primary"
        disabled={disabled}
        onClick={() => onPick(primaryLabel)}
      >
        {primaryLabel}
      </button>
      {secondaryLabel ? (
        <button
          type="button"
          className="drama-satisfaction__btn"
          disabled={disabled}
          onClick={() => onPick(secondaryLabel)}
        >
          {secondaryLabel}
        </button>
      ) : null}
    </div>
  )
}
