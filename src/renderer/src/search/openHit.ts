import type { BoardAppearance, SearchHit } from '@shared/types'
import { fitViewport } from '../canvas/geometry'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'

/** The canvas clears its selection when it first gets a size. Select after that. */
async function afterCanvasLayout(): Promise<void> {
  const started = Date.now()
  await new Promise<void>((resolve) => {
    const check = () => {
      if (useCanvasStore.getState().viewSize.width > 0 || Date.now() - started > 1000) {
        requestAnimationFrame(() => resolve())
        return
      }
      requestAnimationFrame(check)
    }
    check()
  })
}

export async function openSearchHit(hit: SearchHit, query: string): Promise<void> {
  const workspace = useWorkspaceStore.getState()
  const canvas = useCanvasStore.getState()
  if (hit.kind === 'board') {
    await workspace.openBoard(hit.sourceId)
    return
  }
  if (hit.kind === 'folder') {
    workspace.openLibrary(hit.sourceId)
    return
  }
  if (hit.kind === 'object' && hit.objectId && hit.boardId) {
    await openAppearance({
      objectId: hit.objectId,
      boardId: hit.boardId,
      boardTitle: hit.title,
      path: hit.location,
      x: 0,
      y: 0
    })
    return
  }
  if (
    hit.kind === 'entry' &&
    hit.entryId &&
    (hit.matchedTags?.length ?? 0) > 0 &&
    hit.page == null
  ) {
    const details = await window.api.invoke('library:details', hit.entryId)
    workspace.openLibrary(details.entry.folderId, hit.entryId)
    return
  }
  if (hit.kind === 'note') {
    const object = await window.api.invoke('objects:read', hit.sourceId)
    if (!object) return
    await workspace.openBoard(object.boardId)
    await afterCanvasLayout()
    const view = useCanvasStore.getState()
    view.setSelection([object.id])
    view.setViewport(
      fitViewport(
        { x: object.x, y: object.y, width: object.width, height: object.height },
        view.viewSize
      )
    )
    return
  }
  if (!hit.assetId) return
  const asset = await window.api.invoke('assets:get', hit.assetId)
  if (hit.kind === 'pdf-page' || asset.mime === 'application/pdf') {
    if (hit.kind === 'pdf-page' && hit.objectId && hit.boardId) {
      await openAppearance({
        objectId: hit.objectId,
        boardId: hit.boardId,
        boardTitle: hit.title,
        path: hit.location,
        x: 0,
        y: 0
      })
    }
    useCanvasStore.getState().setPdfAsset({ assetId: asset.id, page: hit.page ?? 1, query })
    return
  }
  if (asset.mime.startsWith('image/')) {
    canvas.setViewerAssetId(asset.id)
    return
  }
  canvas.setFileAssetId(asset.id)
}

export async function openAppearance(appearance: BoardAppearance): Promise<void> {
  const object = await window.api.invoke('objects:read', appearance.objectId)
  await useWorkspaceStore.getState().openBoard(appearance.boardId)
  await afterCanvasLayout()
  const canvas = useCanvasStore.getState()
  canvas.setSelection([appearance.objectId])
  if (!object) return
  canvas.setViewport(
    fitViewport(
      { x: object.x, y: object.y, width: object.width, height: object.height },
      canvas.viewSize
    )
  )
}
