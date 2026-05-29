import { describe, expect, it, vi } from 'vitest'
import { hydratePresetSnapshotBundledMedia, isBundledPresetMediaPath } from './presetTemplateMediaBundle'

vi.mock('./localGalleryBundle', () => ({
  isLocalGalleryBundleEnabled: () => true,
  resolveBundledGalleryUrl: (p: string) => `https://app.test/${p}`,
}))

describe('presetTemplateMediaBundle', () => {
  it('识别随包媒体路径', () => {
    expect(isBundledPresetMediaPath('flowid-bundled/presets/assets/tid/abc.png')).toBe(true)
    expect(isBundledPresetMediaPath('blob:http://x')).toBe(false)
  })

  it('hydrate 将相对路径转为绝对 URL', () => {
    const out = hydratePresetSnapshotBundledMedia({
      version: 1,
      name: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'n1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: {
            kind: 'image',
            title: 't',
            src: 'flowid-bundled/presets/assets/tid/a.png',
            prompt: '',
            referenceImageSources: ['flowid-bundled/presets/assets/tid/b.jpg'],
            referenceImageAssetIds: [''],
          },
        },
      ],
      edges: [],
    })
    const d = out.nodes[0]!.data as { src: string; referenceImageSources: string[] }
    expect(d.src).toBe('https://app.test/flowid-bundled/presets/assets/tid/a.png')
    expect(d.referenceImageSources[0]).toContain('flowid-bundled/presets/assets/tid/b.jpg')
  })
})
