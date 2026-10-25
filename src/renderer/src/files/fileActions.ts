import { fileAppearance, isDangerousExtension, type FileAppearance } from '@shared/files'
import type { CanvasObject } from '@shared/types'
import { record } from '../canvas/actions'
import { reportError, showNotice } from '../store/projectStore'

const api = () => window.api

/** Switches a file card between compact and preview. The file and its preview stay. */
export async function setFileAppearance(
  object: CanvasObject,
  appearance: FileAppearance
): Promise<void> {
  const previous = fileAppearance(object.data)
  if (previous === appearance) return
  const apply = (value: FileAppearance) =>
    api().invoke('objects:setFileAppearance', object.id, value)
  await apply(appearance)
  record({
    label: appearance === 'preview' ? 'Show preview' : 'Show compact',
    undo: () => apply(previous),
    redo: () => apply(appearance)
  })
}

/** Points the file at a preview image, or clears it. The image stays in the library. */
export async function setFilePreview(
  assetId: string,
  previewAssetId: string | null,
  previous: string | null
): Promise<void> {
  if (previewAssetId === previous) return
  const apply = (id: string | null) => api().invoke('assets:setPreview', assetId, id)
  await apply(previewAssetId)
  record({
    label: previewAssetId ? 'Attach preview' : 'Remove preview',
    undo: () => apply(previous),
    redo: () => apply(previewAssetId)
  })
}

export async function attachPreview(object: CanvasObject): Promise<void> {
  if (!object.asset) return
  const paths = await api()
    .invoke('dialog:pickImages')
    .catch((error: unknown) => {
      reportError(error)
      return [] as string[]
    })
  if (paths.length === 0) return
  const result = await api().invoke('assets:importFiles', paths, { imagesOnly: true })
  const image = result.imported[0]
  if (!image) {
    showNotice(result.skipped[0]?.reason ?? 'Choose a JPG, PNG or WebP image.', 8000)
    return
  }
  await setFilePreview(object.asset.id, image.id, object.asset.previewAssetId)
}

/** Writes a copy outside the project and opens that copy. Edits there do not come back. */
export async function openWorkingCopy(object: CanvasObject): Promise<void> {
  if (!object.asset) return
  if (isDangerousExtension(object.asset.ext)) return
  const path = await api()
    .invoke('assets:openCopy', object.asset.id)
    .catch((error: unknown) => {
      reportError(error)
      return null
    })
  if (!path) return
  showNotice(
    'Opened a copy. Edits in another app stay in that copy — they don’t update this project.',
    12000
  )
}
