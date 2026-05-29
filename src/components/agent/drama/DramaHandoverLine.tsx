import { DRAMA_AGENT_PERSONAS, type DramaAgentPersonaId } from '../../../lib/dramaProduction/dramaAgentPersonas'

type Props = {
  from: DramaAgentPersonaId
  to: DramaAgentPersonaId
}

/**
 * Agent 邀请加入群聊系统消息（图八 / 图十一）。
 */
export function DramaHandoverLine({ from, to }: Props) {
  const fromP = DRAMA_AGENT_PERSONAS[from]
  const toP = DRAMA_AGENT_PERSONAS[to]
  return (
    <p className="drama-agent-handover">
      <span>{fromP.emoji}</span>
      <span>{fromP.name}</span>
      <span className="drama-agent-handover__invite">邀请</span>
      <span>{toP.emoji}</span>
      <span>{toP.name}</span>
      <span className="drama-agent-handover__join">加入了群聊</span>
    </p>
  )
}
