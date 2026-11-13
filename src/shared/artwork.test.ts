import { describe, expect, it } from 'vitest'
import {
  classifyArtwork,
  cropFromFractions,
  fractionsInContainedImage,
  planFolderMatch
} from './artwork'
import { bulkDecision } from './collectionBulk'
import { stageKnownAssets } from './collectionImport'

describe('artwork states and crops', () => {
  it('keeps blank, missing, damaged, and a failed load apart', () => {
    expect(
      classifyArtwork({
        hasVersion: false,
        assetPresent: false,
        mime: null,
        width: null,
        height: null
      })
    ).toBe('blank')
    expect(
      classifyArtwork({
        hasVersion: true,
        assetPresent: false,
        mime: 'image/png',
        width: 1,
        height: 1
      })
    ).toBe('missing')
    expect(
      classifyArtwork({
        hasVersion: true,
        assetPresent: true,
        mime: 'application/pdf',
        width: null,
        height: null
      })
    ).toBe('unsupported')
    expect(
      classifyArtwork({
        hasVersion: true,
        assetPresent: true,
        mime: 'image/png',
        width: 0,
        height: 4
      })
    ).toBe('damaged')
    expect(
      classifyArtwork({
        hasVersion: true,
        assetPresent: true,
        mime: 'image/png',
        width: 4,
        height: 4,
        externalChanged: true
      })
    ).toBe('changed-external')
    expect(
      classifyArtwork({
        hasVersion: true,
        assetPresent: true,
        mime: 'image/png',
        width: 4,
        height: 4,
        loadFailed: true
      })
    ).toBe('transient')
  })

  it('turns a drag into pixels inside the image', () => {
    expect(
      cropFromFractions({ width: 100, height: 50 }, { x: 0.1, y: 0.2, w: 0.5, h: 0.4 })
    ).toEqual({
      x: 10,
      y: 10,
      w: 50,
      h: 20
    })
  })

  it('measures a drag against the shown image, not the empty bands beside it', () => {
    const frame = { width: 200, height: 100 }
    const image = { width: 40, height: 40 }
    expect(fractionsInContainedImage(frame, image, { x: 0.25, y: 0.1, w: 0.25, h: 0.5 })).toEqual({
      x: 0,
      y: 0.1,
      w: 0.5,
      h: 0.5
    })
    expect(fractionsInContainedImage(frame, image, { x: 0, y: 0, w: 1, h: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1
    })
  })

  it('matches a folder by file name and does not reuse one file twice', () => {
    expect(
      planFolderMatch(
        [
          { versionId: 'a', fileName: 'Page 2.png' },
          { versionId: 'b', fileName: 'Page 2.png' }
        ],
        [{ name: 'Page 2.png', filePath: '/art/Page 2.png' }]
      )
    ).toEqual([{ versionId: 'a', filePath: '/art/Page 2.png', fileName: 'Page 2.png' }])
  })

  it('stages a library file and a slide without copying them yet', () => {
    const staged = stageKnownAssets([
      { name: 'Page 2.png', assetId: 'asset' },
      { name: 'Page 10.png', assetId: 'slide-asset', sourceSlideId: 'slide' }
    ])
    expect(staged.map((item) => item.name)).toEqual(['Page 2.png', 'Page 10.png'])
    expect(staged[1]).toMatchObject({
      assetId: 'slide-asset',
      sourceSlideId: 'slide',
      filePath: null
    })
  })

  it('previews a tag add and a stage change without touching notes', () => {
    const page = {
      id: 'page',
      notes: 'keep',
      overallStatus: 'not_started',
      role: 'story',
      tagIds: [],
      stages: [{ stageId: 'inks', state: 'not_started' }]
    }
    expect(bulkDecision(page, { kind: 'add-tag', tagId: 'tag' })).toEqual({
      kind: 'tag',
      tagId: 'tag',
      added: true
    })
    expect(bulkDecision(page, { kind: 'set-stage', stageId: 'inks', state: 'done' }).kind).toBe(
      'stage'
    )
  })
})
