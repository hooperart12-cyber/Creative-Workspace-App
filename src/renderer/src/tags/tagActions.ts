import type { TagAssignment, TagTarget } from '@shared/types'
import { record } from '../canvas/actions'
import { reportError } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export function searchForTag(tagId: string, additive = false): void {
  window.dispatchEvent(new CustomEvent('cw-tag-search', { detail: { tagId, additive } }))
  useWorkspaceStore.getState().openSearch()
}

export async function assignTag(tagId: string, target: TagTarget): Promise<void> {
  const row = await window.api.invoke('tags:assign', tagId, target)
  if (!row.created) return
  let id = row.id
  record({
    label: 'Add tag',
    undo: () => window.api.invoke('tags:revertAdd', [id]),
    redo: async () => {
      id = (await window.api.invoke('tags:assign', tagId, target)).id
    }
  })
}

export async function unassignTag(tagId: string, target: TagTarget): Promise<void> {
  const removed = await window.api.invoke('tags:unassign', tagId, target)
  if (!removed) return
  record({
    label: 'Remove tag',
    undo: () => window.api.invoke('tags:revertRemove', [removed]),
    redo: () => window.api.invoke('tags:unassign', tagId, target).then(() => undefined)
  })
}

export async function addTags(tagIds: string[], targets: TagTarget[]): Promise<void> {
  const added = await window.api.invoke('tags:addMany', tagIds, targets)
  if (added.length === 0) return
  let rows = added
  record({
    label: 'Add tags',
    undo: () =>
      window.api.invoke(
        'tags:revertAdd',
        rows.map((row) => row.id)
      ),
    redo: async () => {
      rows = await window.api.invoke('tags:addMany', tagIds, targets)
    }
  })
}

export async function removeTags(tagIds: string[], targets: TagTarget[]): Promise<void> {
  const removed = await window.api.invoke('tags:removeMany', tagIds, targets)
  if (removed.length === 0) return
  record({
    label: 'Remove tags',
    undo: () => window.api.invoke('tags:revertRemove', removed),
    redo: () => window.api.invoke('tags:removeMany', tagIds, targets).then(() => undefined)
  })
}

export async function replaceTags(tagIds: string[], targets: TagTarget[]): Promise<void> {
  let replaced = await window.api.invoke('tags:replaceDirect', tagIds, targets)
  record({
    label: 'Replace tags',
    undo: () =>
      window.api.invoke(
        'tags:revertReplace',
        targets,
        replaced.after.map((row: TagAssignment) => row.id),
        replaced.before
      ),
    redo: async () => {
      replaced = await window.api.invoke('tags:replaceDirect', tagIds, targets)
    }
  })
}

export async function createOneOff(name: string, target: TagTarget): Promise<void> {
  const tag = await window.api.invoke('tags:createOneOff', name, target)
  record({
    label: 'Add one-off tag',
    undo: () => window.api.invoke('tags:removeOneOff', tag.id),
    redo: () => window.api.invoke('tags:createOneOff', name, target).then(() => undefined)
  })
}

export function reportTagError(error: unknown): void {
  reportError(error)
}
