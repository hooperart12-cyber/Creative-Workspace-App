import { readNote, type NoteAppearance, type RichNode } from '@shared/notes'
import type { CanvasObject } from '@shared/types'
import { layoutNote } from './layout'

/**
 * Height an auto-height note needs for its text at a width (canvas units). Falls back to the
 * stored height if the note can't be measured.
 */
export function noteContentHeight(
  object: CanvasObject,
  overrides: { doc?: RichNode; width?: number; appearance?: NoteAppearance } = {}
): number {
  const read = readNote(object.data)
  if (!read.ok) return object.height
  try {
    return layoutNote(
      overrides.doc ?? read.note.content.doc,
      overrides.width ?? object.width,
      overrides.appearance ?? read.note.appearance
    ).height
  } catch {
    return object.height
  }
}

/** True for notes whose height follows their text. */
export function isAutoHeightNote(object: CanvasObject): boolean {
  if (object.type !== 'text') return false
  const read = readNote(object.data)
  return !read.ok || read.note.sizing === 'auto'
}
