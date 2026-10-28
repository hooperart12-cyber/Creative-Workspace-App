import type { ImageCrop } from '@shared/crop'
import type { Point, StackResult, StackUndo } from '@shared/types'
import type { StackSettings } from '@shared/stacks'
import { record } from '../canvas/actions'
import { useWorkspaceStore } from '../store/workspaceStore'

const api = () => window.api

function remember(label: string, first: StackResult, redo: () => Promise<StackResult>): void {
  let undo: StackUndo = first.undo
  record({
    label,
    undo: () => api().invoke('stacks:undo', undo),
    redo: async () => {
      undo = (await redo()).undo
    }
  })
}

export async function createEmptyStack(at: Point): Promise<void> {
  const boardId = useWorkspaceStore.getState().board?.id
  if (!boardId) return
  const result = await api().invoke('stacks:createEmpty', boardId, at)
  remember('New image stack', result, () => api().invoke('stacks:createEmpty', boardId, at))
}

export async function createStack(objectIds: string[], mode: 'combine' | 'copy'): Promise<void> {
  const result = await api().invoke('stacks:createFromObjects', objectIds, mode)
  remember(mode === 'combine' ? 'Combine into stack' : 'Create stack copy', result, () =>
    api().invoke('stacks:createFromObjects', objectIds, mode)
  )
}

export async function placeAsStack(assetIds: string[], at: Point): Promise<void> {
  const boardId = useWorkspaceStore.getState().board?.id
  if (!boardId) return
  const result = await api().invoke('stacks:createFromAssets', boardId, assetIds, at)
  remember('Place as stack', result, () =>
    api().invoke('stacks:createFromAssets', boardId, assetIds, at)
  )
}

export async function addToStack(input: {
  stackId: string
  expectedRevision: number
  assetIds?: string[]
  objectIds?: string[]
  mode: 'move' | 'copy'
}): Promise<void> {
  const result = await api().invoke('stacks:add', input)
  remember('Add to stack', result, () =>
    api().invoke('stacks:add', {
      ...input,
      expectedRevision:
        result.undo.op === 'content' ? result.undo.before.revision : input.expectedRevision
    })
  )
}

export async function removeSlide(
  stackId: string,
  slideId: string,
  expectedRevision: number
): Promise<void> {
  const result = await api().invoke('stacks:remove', stackId, slideId, expectedRevision)
  remember('Remove from stack', result, () =>
    api().invoke('stacks:remove', stackId, slideId, revisionBefore(result))
  )
}

export async function extractSlide(
  stackId: string,
  slideId: string,
  expectedRevision: number
): Promise<void> {
  const result = await api().invoke('stacks:extract', stackId, slideId, expectedRevision)
  remember('Extract to canvas', result, () =>
    api().invoke('stacks:extract', stackId, slideId, revisionBefore(result))
  )
}

export async function reorderSlides(
  stackId: string,
  slideIds: string[],
  expectedRevision: number
): Promise<void> {
  const result = await api().invoke('stacks:reorder', stackId, slideIds, expectedRevision)
  remember('Reorder stack', result, () =>
    api().invoke('stacks:reorder', stackId, slideIds, revisionBefore(result))
  )
}

export async function setCover(
  stackId: string,
  slideId: string,
  expectedRevision: number
): Promise<void> {
  const result = await api().invoke('stacks:setCover', stackId, slideId, expectedRevision)
  remember('Set stack cover', result, () =>
    api().invoke('stacks:setCover', stackId, slideId, revisionBefore(result))
  )
}

export async function showSlide(
  stackId: string,
  slideId: string | null,
  expectedShown: string | null
): Promise<void> {
  await api().invoke('stacks:setDisplayed', stackId, slideId, expectedShown)
  record({
    label: 'Show stack image',
    undo: () => api().invoke('stacks:setDisplayed', stackId, expectedShown, slideId),
    redo: () => api().invoke('stacks:setDisplayed', stackId, slideId, expectedShown)
  })
}

export async function updateStack(
  stackId: string,
  patch: { sizing?: StackSettings['sizing']; rememberLast?: boolean; name?: string | null },
  expectedRevision: number
): Promise<void> {
  const result = await api().invoke('stacks:updateSettings', stackId, patch, expectedRevision)
  remember('Stack settings', result, () =>
    api().invoke('stacks:updateSettings', stackId, patch, revisionBefore(result))
  )
}

export async function unstack(
  stackId: string,
  mode: 'separate' | 'restore',
  expectedRevision: number
): Promise<void> {
  const result = await api().invoke('stacks:unstack', stackId, mode, expectedRevision)
  remember(mode === 'restore' ? 'Restore original layout' : 'Separate stack', result, () =>
    api().invoke('stacks:unstack', stackId, mode, revisionBefore(result))
  )
}

export async function cropSlide(
  stackId: string,
  slideId: string,
  crop: ImageCrop | null,
  expectedRevision: number
): Promise<void> {
  const result = await api().invoke('stacks:setSlideCrop', stackId, slideId, crop, expectedRevision)
  remember('Crop image', result, () =>
    api().invoke('stacks:setSlideCrop', stackId, slideId, crop, revisionBefore(result))
  )
}

export async function cropImage(
  objectId: string,
  crop: ImageCrop | null,
  expectedRevision: number
): Promise<void> {
  let packet = await api().invoke('stacks:setImageCrop', objectId, crop, expectedRevision)
  record({
    label: 'Crop image',
    undo: () => api().invoke('stacks:undoImageCrop', packet.undo),
    redo: async () => {
      packet = await api().invoke('stacks:setImageCrop', objectId, crop, packet.undo.revision - 1)
    }
  })
}

function revisionBefore(result: StackResult): number {
  return result.undo.op === 'content' || result.undo.op === 'create'
    ? result.undo.revision - 1
    : result.revision
}
