import { describe, expect, it } from 'vitest'
import { bundledPresetAssetRelPath } from './bundledPresetAssetPath'

describe('exportPresetTemplatePackage', () => {
  it('bundledPresetAssetRelPath 与随包目录约定一致', () => {
    expect(bundledPresetAssetRelPath('tid-1', 'abc', '.png')).toBe(
      'flowid-bundled/presets/assets/tid-1/abc.png',
    )
  })
})
