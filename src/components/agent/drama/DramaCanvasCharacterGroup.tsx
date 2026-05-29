import { Crown, Flame, Plus } from 'lucide-react'
import type { DramaCharacter, DramaLocation } from '../../../lib/dramaProduction/types'
import { dramaImageDisplayUrl } from '../../../lib/dramaProduction/dramaImageDisplay'
import { DramaResizableStage } from './DramaResizableStage'

type Props = {
  scriptBody: string
  characters: DramaCharacter[]
  imagesReady: number
  visualStyle?: string | null
  variant?: 'flow' | 'studio'
}

export function characterHasImage(c: DramaCharacter): boolean {
  return Boolean(c.imageSrc?.trim())
}

export function characterHasDesignImage(c: DramaCharacter): boolean {
  return Boolean(c.designImageSrc?.trim())
}

function DramaCharImage({ label, src }: { label: string; src?: string }) {
  const url = dramaImageDisplayUrl(src)
  if (url) {
    return (
      <img
        className="drama-canvas-flow__char-img drama-canvas-flow__char-img--photo"
        src={url}
        alt={label}
        loading="lazy"
        draggable={false}
      />
    )
  }
  return <div className="drama-canvas-flow__char-img" aria-label={`${label} 待生成`} />
}

export function DramaCanvasCharacterGroup({
  scriptBody,
  characters,
  visualStyle,
  variant = 'flow',
}: Props) {
  const preview = scriptBody.trim().slice(0, 400)

  return (
    <DramaResizableStage defaultScale={1}>
      <div className={`drama-canvas-flow${variant === 'studio' ? ' drama-canvas-flow--studio-chars' : ''}`}>
        {variant === 'flow' ? (
          <>
            <article className="drama-canvas-flow__script-node" data-drama-node-draggable>
              <h3>场景1：高二三班教室</h3>
              <p>{preview || '剧本内容将显示在此…'}</p>
              <span className="drama-canvas-flow__tag drama-canvas-flow__tag--ok">已确认</span>
            </article>
            <div className="drama-canvas-flow__connector" aria-hidden />
          </>
        ) : null}

        <article className="drama-canvas-flow__group" data-drama-node-draggable>
          <header className="drama-canvas-flow__group-head">
            <Crown size={16} className="drama-canvas-flow__group-icon" aria-hidden />
            <span>角色设计师</span>
            {visualStyle ? <em>{visualStyle}</em> : null}
          </header>
          <div className="drama-canvas-flow__char-grid">
            {characters.map((c) => {
              const hasDesign = characterHasDesignImage(c)
              const hasConcept = characterHasImage(c)
              return (
                <div key={c.id} className="drama-canvas-flow__char-card drama-canvas-flow__char-card--dual">
                  <div className="drama-canvas-flow__char-text">
                    <strong>{c.name}</strong>
                    <p>{[c.personality, c.background].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="drama-canvas-flow__char-images">
                    <div className="drama-canvas-flow__char-img-wrap">
                      <span className="drama-canvas-flow__char-img-label">设计图</span>
                      <DramaCharImage label={`${c.name} 设计图`} src={c.designImageSrc} />
                    </div>
                    <div className="drama-canvas-flow__char-img-wrap">
                      <span className="drama-canvas-flow__char-img-label">概念图</span>
                      <DramaCharImage label={`${c.name} 概念图`} src={c.imageSrc} />
                    </div>
                  </div>
                  <button type="button" className="drama-canvas-flow__gen-btn">
                    {hasConcept ? '角色详情' : hasDesign ? '生成概念图' : '生成角色图'}
                    {!hasConcept ? <Plus size={12} /> : null}
                  </button>
                </div>
              )
            })}
          </div>
        </article>
      </div>
    </DramaResizableStage>
  )
}

type SceneProps = {
  location: DramaLocation
  visualStyle?: string | null
  mainImageReady?: boolean
  multiViewReady?: boolean
}

export function DramaCanvasSceneNode({
  location,
  visualStyle,
  mainImageReady,
  multiViewReady,
}: SceneProps) {
  const mainUrl = dramaImageDisplayUrl(location.mainImageSrc)
  const showMain = Boolean(mainUrl || mainImageReady)
  const showGrid = Boolean(multiViewReady || (location.multiViewSrcs?.length ?? 0) >= 4)

  return (
    <DramaResizableStage defaultScale={1}>
      <div className="drama-canvas-flow drama-canvas-flow--scene">
        <article className={`drama-canvas-flow__scene-node${mainUrl ? ' has-main-image' : ''}`}>
          <header className="drama-canvas-flow__scene-head">
            <Flame size={16} aria-hidden />
            <span>场景设计师</span>
          </header>
          <div className="drama-canvas-flow__scene-layout">
            <div className="drama-canvas-flow__scene-copy">
              <h3>{location.name}</h3>
              <p>{location.description}</p>
              {visualStyle ? <span className="drama-canvas-flow__tag">风格：{visualStyle}</span> : null}
              {mainUrl ? (
                <button type="button" className="drama-canvas-flow__modify-btn">
                  一键修改
                </button>
              ) : (
                <button type="button" className="drama-canvas-flow__asset-btn">
                  <Plus size={14} />
                  加到资产库
                  <span className="drama-canvas-flow__asset-count">0</span>
                </button>
              )}
            </div>
            {showMain ? (
              <div className="drama-canvas-flow__scene-visual">
                {mainUrl ? (
                  <img
                    className="drama-canvas-flow__scene-main-img drama-canvas-flow__scene-main-img--photo"
                    src={mainUrl}
                    alt={`${location.name} 主图`}
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="drama-canvas-flow__scene-main-img is-pending" aria-label="场景图生成中" />
                )}
                {showGrid ? (
                  <div className="drama-canvas-flow__scene-multiview">
                    {[0, 1, 2, 3].map((i) => {
                      const u = dramaImageDisplayUrl(location.multiViewSrcs?.[i])
                      return u ? (
                        <img
                          key={i}
                          className="drama-canvas-flow__scene-multiview-cell drama-canvas-flow__scene-multiview-cell--photo"
                          src={u}
                          alt=""
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div key={i} className="drama-canvas-flow__scene-multiview-cell" aria-hidden />
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>
      </div>
    </DramaResizableStage>
  )
}
