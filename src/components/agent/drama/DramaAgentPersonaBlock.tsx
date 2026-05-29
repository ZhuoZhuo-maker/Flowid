import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import {
  DRAMA_AGENT_PERSONAS,
  resolveDramaPersona,
  type DramaAgentPersona,
  type DramaAgentPersonaId,
} from '../../../lib/dramaProduction/dramaAgentPersonas'

export type DramaPersonaStatus = 'idle' | 'planning' | 'done' | 'working'

type Props = {
  personaId?: DramaAgentPersonaId
  expertRole?: string
  status?: DramaPersonaStatus
  /** 正文（支持多行 / bullet） */
  body?: string
  collapsible?: boolean
  defaultOpen?: boolean
  /** 是否显示角色插图占位 */
  showMascot?: boolean
}

/**
 * Agent 人设消息块（艺术总监 / 编剧 / 角色设计师）。
 */
export function DramaAgentPersonaBlock({
  personaId,
  expertRole,
  status = 'done',
  body,
  collapsible,
  defaultOpen = true,
  showMascot,
}: Props) {
  const persona: DramaAgentPersona = personaId
    ? DRAMA_AGENT_PERSONAS[personaId]
    : resolveDramaPersona(expertRole)
  const [open, setOpen] = useState(defaultOpen)

  const statusLabel =
    status === 'planning'
      ? persona.statusPlanning
      : status === 'working'
        ? persona.statusWorking
        : status === 'idle'
          ? persona.statusIdle
          : persona.statusDone

  const lines = (body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return (
    <article className={`drama-agent-persona ${persona.toneClass}`}>
      <header className="drama-agent-persona__head">
        <span className="drama-agent-persona__avatar" aria-hidden>
          {persona.emoji}
        </span>
        <div className="drama-agent-persona__meta">
          <h3>{persona.name}</h3>
          <p className="drama-agent-persona__status">{statusLabel}</p>
        </div>
        {collapsible ? (
          <button type="button" className="drama-agent-persona__toggle" onClick={() => setOpen((v) => !v)} aria-label="展开或折叠">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : null}
      </header>
      {open && lines.length ? (
        <div className="drama-agent-persona__body">
          <ul>
            {lines.map((line) => (
              <li key={line}>{line.replace(/^[-·•]\s*/, '')}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {showMascot ? <div className="drama-agent-persona__mascot" aria-hidden /> : null}
    </article>
  )
}
