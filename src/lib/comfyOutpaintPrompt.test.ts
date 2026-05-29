import { describe, expect, it } from 'vitest'
import { parseOutpaintPadFromPrompt, resolveOutpaintPadsFromNode } from './comfyOutpaintPrompt'

describe('parseOutpaintPadFromPrompt', () => {
  it('解析宽/高合计并剥离指令', () => {
    const r = parseOutpaintPadFromPrompt('宽200 高100\n在城堡两侧延伸天空')
    expect(r.hadDirectives).toBe(true)
    expect(r.pads.left).toBe(100)
    expect(r.pads.right).toBe(100)
    expect(r.pads.top).toBe(50)
    expect(r.pads.bottom).toBe(50)
    expect(r.cleanedPrompt).toBe('在城堡两侧延伸天空')
  })

  it('解析四向独立边距', () => {
    const r = parseOutpaintPadFromPrompt('左300 右500 上0 下200 补全地面')
    expect(r.pads).toMatchObject({ left: 300, right: 500, top: 0, bottom: 200 })
    expect(r.cleanedPrompt).toBe('补全地面')
  })

  it('无指令时保留默认', () => {
    const r = parseOutpaintPadFromPrompt('仅描述扩图内容')
    expect(r.hadDirectives).toBe(false)
    expect(r.pads.left).toBe(400)
    expect(r.cleanedPrompt).toBe('仅描述扩图内容')
  })
})

describe('resolveOutpaintPadsFromNode', () => {
  it('读取面板四向边距', () => {
    expect(
      resolveOutpaintPadsFromNode({
        comfyOutpaintLeft: 100,
        comfyOutpaintTop: 0,
        comfyOutpaintRight: 200,
        comfyOutpaintBottom: 50,
      }),
    ).toMatchObject({ left: 100, top: 0, right: 200, bottom: 50 })
  })
})
