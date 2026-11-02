/** Draws the open board to a PNG or PDF, and shares one board as an editable package. */
import type Konva from 'konva'
import {
  contentFrame,
  exportCommentView,
  exportConnectionDisplay,
  pictureBoxes,
  picturePixelRatio,
  type ExportCapture
} from '@shared/boardExport'
import { waitForShownImages } from './imageCache'
import { reportError } from '../store/projectStore'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'

export const exportLayer: { current: Konva.Layer | null } = { current: null }

function frameOf(capture: ExportCapture) {
  const board = useWorkspaceStore.getState().board
  if (!board) return contentFrame([])
  const connections = exportConnectionDisplay(board.connectionDisplay, capture.connections)
  const comments = exportCommentView(board.commentView, capture.comments)
  return contentFrame(pictureBoxes(board.objects, connections, comments))
}

async function frames(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
}

/** Captures the board after the canvas has redrawn without handles or the current crop of the view. */
export async function captureBoardPng(capture: ExportCapture): Promise<string> {
  const layer = exportLayer.current
  const board = useWorkspaceStore.getState().board
  if (!layer || !board) throw new Error('Open a board before exporting a picture.')
  useCanvasStore.getState().setExportCapture(capture)
  try {
    await frames()
    await waitForShownImages()
    await frames()
    const frame = frameOf(capture)
    const ratio = picturePixelRatio(frame.width, frame.height)
    return layer.toDataURL({
      x: frame.x,
      y: frame.y,
      width: Math.ceil(frame.width),
      height: Math.ceil(frame.height),
      pixelRatio: ratio,
      mimeType: 'image/png'
    })
  } finally {
    useCanvasStore.getState().setExportCapture(null)
  }
}

export async function exportPicture(format: 'png' | 'pdf', capture: ExportCapture): Promise<void> {
  const destination = await window.api.invoke('dialog:pickSavePicture', format)
  if (!destination) return
  try {
    const url = await captureBoardPng(capture)
    const png = url.slice(url.indexOf(',') + 1)
    await window.api.invoke('board:writePicture', png, destination, format)
  } catch (error) {
    reportError(error)
  }
}

export async function exportPackage(includeComments: boolean): Promise<void> {
  const boardId = useWorkspaceStore.getState().board?.id
  if (!boardId) return
  const destination = await window.api.invoke('dialog:pickSaveBoardPackage')
  if (!destination) return
  try {
    await window.api.invoke('board:exportPackage', boardId, destination, includeComments)
  } catch (error) {
    reportError(error)
  }
}

export async function importPackage(): Promise<void> {
  const parentBoardId = useWorkspaceStore.getState().board?.id
  if (!parentBoardId) return
  const zipPath = await window.api.invoke('dialog:pickBoardPackage')
  if (!zipPath) return
  try {
    const saved = await window.api.invoke('board:importPackage', zipPath, parentBoardId)
    await useWorkspaceStore.getState().refresh()
    await useWorkspaceStore.getState().openBoard(saved.boardId)
  } catch (error) {
    reportError(error)
  }
}
