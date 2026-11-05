/** Opens an internal destination in this window only. */
import { destinationFromHref, type Destination } from '@shared/destinations'
import { fitViewport } from '../canvas/geometry'
import { objectBounds } from '../canvas/geometry'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export async function navigateTo(destination: Destination): Promise<void> {
  if (destination.kind === 'url') {
    await window.api.invoke('links:open', destination.href)
    return
  }
  if (destination.kind === 'collection' || destination.kind === 'page') return
  const workspace = useWorkspaceStore.getState()
  if (workspace.board?.id !== destination.boardId) await workspace.openBoard(destination.boardId)
  const board = useWorkspaceStore.getState().board
  const canvas = useCanvasStore.getState()
  if (destination.kind === 'camera') {
    canvas.setViewport({ x: destination.x, y: destination.y, zoom: destination.zoom })
    return
  }
  if (destination.kind === 'board') return
  const object = board?.objects.find((item) => item.id === destination.objectId)
  if (!object) return
  canvas.setSelection([object.id])
  const fitted = fitViewport(objectBounds(object), canvas.viewSize)
  canvas.setViewport(fitted)
  if (destination.kind === 'pdf') canvas.setPdfReader(object.id, destination.page)
  if (destination.kind === 'stack' || destination.kind === 'slide') {
    const slideId = destination.kind === 'slide' ? destination.slideId : object.slides?.[0]?.id
    if (slideId) {
      canvas.setStackPreview({ objectId: object.id, slideId })
      canvas.setStackViewer({ objectId: object.id, mode: 'focus', slideId })
    }
  }
}

export function openHref(href: string): void {
  const destination = destinationFromHref(href)
  if (destination) {
    void navigateTo(destination)
    return
  }
  void window.api.invoke('links:open', href)
}
