function flowidMarkPngUrl(): string {
  return `${import.meta.env.BASE_URL}flowid-mark.png`.replace(/([^:]\/)\/+/g, '$1')
}

export function FlowidMark({ className = 'w-6 h-6' }: { className?: string }) {
  return <img src={flowidMarkPngUrl()} alt="" className={`shrink-0 ${className}`} draggable={false} />
}
