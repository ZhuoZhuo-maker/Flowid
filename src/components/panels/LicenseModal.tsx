import { LicenseActivationPanel } from './LicenseActivationPanel'

type LicenseModalProps = {
  open: boolean
  onClose: () => void
}

/** 独立浮层授权弹窗（可选）；首页顶栏已改为打开设置内的「授权码」。 */
export function LicenseModal({ open, onClose }: LicenseModalProps) {
  if (!open) return null
  return (
    <div className="workflow-settings-backdrop" onMouseDown={onClose}>
      <LicenseActivationPanel active layout="modal" onClose={onClose} />
    </div>
  )
}
