import { create } from 'zustand'
import type { ConnectionData } from '@shared/connections'
import type { Point, Viewport } from '@shared/types'
import type { Guide } from '../canvas/arrange'
import type { Rect, Size } from '../canvas/geometry'
import { History } from '../canvas/history'

/** Grid spacing in world units (used for the visible grid and snap-to-grid). */
export const GRID_SIZE = 20

/** A drag of selected objects in progress. */
export interface DragState {
  ids: string[]
  dx: number
  dy: number
  guides: Guide[]
  /** Board card under the pointer: dropping nests the dragged objects into it. */
  dropCardId?: string
  /** Board under the pointer in the sidebar or breadcrumb. */
  dropBoardId?: string
  /** Image stack under the pointer. */
  dropStackId?: string
}

export interface StackDrop {
  stackId: string
  objectIds: string[]
  dx: number
  dy: number
  origins: { id: string; x: number; y: number }[]
}

interface CanvasState {
  /** This window's camera for the open board (§2: each window zooms and scrolls independently). */
  viewport: Viewport
  viewSize: Size
  selection: Set<string>
  /** Objects marked with Ctrl+X, shown faded until pasted (Explorer-style cut). */
  cut: Set<string>
  drag: DragState | null
  marquee: Rect | null
  showGrid: boolean
  snapToGrid: boolean
  /** Bumped by undo/redo so buttons re-render their enabled state. */
  historyVersion: number
  /** Image shown in the full-size viewer, if open. */
  viewerObjectId: string | null
  /** PDF card open in the reader in this window. */
  pdfReaderId: string | null
  /** Generic file card whose details are open. */
  fileDetailsId: string | null
  /** Image opened from search or the library, with no board card. */
  viewerAssetId: string | null
  /** PDF opened from search, with no board card. */
  pdfAsset: { assetId: string; page: number; query: string } | null
  /** Generic file opened from search, with no board card. */
  fileAssetId: string | null
  /** Bumped when a PDF cover may have appeared, so the card refetches it. */
  coverEpoch: number
  stackEditorId: string | null
  stackViewer: { objectId: string; mode: 'gallery' | 'focus'; slideId: string } | null
  cropTarget: { objectId: string; slideId?: string } | null
  stackDrop: StackDrop | null
  stackPreview: { objectId: string; slideId: string } | null
  tool: 'select' | 'connect' | 'comment'
  toolPinned: boolean
  /** A comment that has been placed but not posted yet. */
  commentDraft: {
    x: number
    y: number
    targetId: string | null
    slideId: string | null
    scope: 'free' | 'object' | 'stack' | 'slide'
  } | null
  pdfPage: number
  showComments: boolean
  showProperties: boolean
  /** Rubber-band for a connection that has not been released yet. */
  connectPreview: { start: Point; end: Point; endTargetId: string | null } | null
  /** Escape during a connection drag. The mouseup must not create the line. */
  discardConnect: boolean
  destinationPicker: boolean
  /** Where a chosen destination should be written. A plain open creates a card. */
  linkTarget:
    | { kind: 'card' }
    | { kind: 'object'; id: string }
    | { kind: 'label'; id: string }
    | { kind: 'link'; id: string }
    | { kind: 'note' }
    | null
  /** Live geometry while an endpoint, bend, or label is dragged. */
  connectionDraft: { id: string; data: ConnectionData } | null
  labelEdit: string | null
  lineChoices: { ids: string[]; x: number; y: number } | null

  setViewport: (viewport: Viewport) => void
  setViewSize: (size: Size) => void
  setSelection: (ids: Iterable<string>) => void
  setCut: (ids: Iterable<string>) => void
  setDrag: (drag: DragState | null) => void
  setMarquee: (rect: Rect | null) => void
  toggleGrid: () => void
  toggleSnap: () => void
  bumpHistory: () => void
  setViewerObjectId: (id: string | null) => void
  setPdfReaderId: (id: string | null) => void
  setFileDetailsId: (id: string | null) => void
  setViewerAssetId: (id: string | null) => void
  setPdfAsset: (pdf: { assetId: string; page: number; query: string } | null) => void
  setFileAssetId: (id: string | null) => void
  bumpCovers: () => void
  setStackEditorId: (id: string | null) => void
  setStackViewer: (viewer: CanvasState['stackViewer']) => void
  setCropTarget: (target: CanvasState['cropTarget']) => void
  setStackDrop: (drop: StackDrop | null) => void
  setStackPreview: (preview: CanvasState['stackPreview']) => void
  setTool: (tool: CanvasState['tool'], pinned?: boolean) => void
  setCommentDraft: (draft: CanvasState['commentDraft']) => void
  setPdfReader: (id: string | null, page?: number) => void
  setShowComments: (open: boolean) => void
  setShowProperties: (open: boolean) => void
  setConnectPreview: (preview: CanvasState['connectPreview']) => void
  setDiscardConnect: (discard: boolean) => void
  setDestinationPicker: (open: boolean) => void
  setLinkTarget: (target: CanvasState['linkTarget']) => void
  setConnectionDraft: (draft: CanvasState['connectionDraft']) => void
  setLabelEdit: (id: string | null) => void
  setLineChoices: (choices: CanvasState['lineChoices']) => void
}

const PREFS_KEY = 'cw.canvasPrefs'

function readPrefs(): { showGrid: boolean; snapToGrid: boolean } {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { showGrid: parsed.showGrid ?? true, snapToGrid: parsed.snapToGrid ?? false }
  } catch {
    return { showGrid: true, snapToGrid: false }
  }
}

function savePrefs(prefs: { showGrid: boolean; snapToGrid: boolean }): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: preferences just aren't remembered.
  }
}

/** Undo/redo for this window (§20). */
export const history = new History()

export const useCanvasStore = create<CanvasState>((set, get) => ({
  viewport: { x: 0, y: 0, zoom: 1 },
  viewSize: { width: 0, height: 0 },
  selection: new Set(),
  cut: new Set(),
  drag: null,
  marquee: null,
  ...readPrefs(),
  historyVersion: 0,
  viewerObjectId: null,
  pdfReaderId: null,
  fileDetailsId: null,
  viewerAssetId: null,
  pdfAsset: null,
  fileAssetId: null,
  coverEpoch: 0,
  stackEditorId: null,
  stackViewer: null,
  cropTarget: null,
  stackDrop: null,
  stackPreview: null,
  tool: 'select',
  toolPinned: false,
  commentDraft: null,
  pdfPage: 1,
  showComments: false,
  showProperties: false,
  connectPreview: null,
  discardConnect: false,
  destinationPicker: false,
  linkTarget: null,
  connectionDraft: null,
  labelEdit: null,
  lineChoices: null,

  setViewport: (viewport) => set({ viewport }),
  setViewSize: (viewSize) => set({ viewSize }),
  setSelection: (ids) => set({ selection: new Set(ids) }),
  setCut: (ids) => set({ cut: new Set(ids) }),
  setDrag: (drag) => set({ drag }),
  setMarquee: (marquee) => set({ marquee }),
  toggleGrid: () => {
    set({ showGrid: !get().showGrid })
    savePrefs({ showGrid: get().showGrid, snapToGrid: get().snapToGrid })
  },
  toggleSnap: () => {
    set({ snapToGrid: !get().snapToGrid })
    savePrefs({ showGrid: get().showGrid, snapToGrid: get().snapToGrid })
  },
  bumpHistory: () => set({ historyVersion: get().historyVersion + 1 }),
  setViewerObjectId: (viewerObjectId) => set({ viewerObjectId }),
  setPdfReaderId: (pdfReaderId) => set({ pdfReaderId, pdfPage: 1 }),
  setFileDetailsId: (fileDetailsId) => set({ fileDetailsId }),
  setViewerAssetId: (viewerAssetId) => set({ viewerAssetId }),
  setPdfAsset: (pdfAsset) => set({ pdfAsset }),
  setFileAssetId: (fileAssetId) => set({ fileAssetId }),
  bumpCovers: () => set({ coverEpoch: get().coverEpoch + 1 }),
  setStackEditorId: (stackEditorId) => set({ stackEditorId }),
  setStackViewer: (stackViewer) => set({ stackViewer }),
  setCropTarget: (cropTarget) => set({ cropTarget }),
  setStackDrop: (stackDrop) => set({ stackDrop }),
  setStackPreview: (stackPreview) => set({ stackPreview }),
  setTool: (tool, pinned) =>
    set({
      tool,
      toolPinned: pinned ?? get().toolPinned,
      commentDraft: tool === 'comment' ? get().commentDraft : null,
      connectPreview: tool === 'connect' ? get().connectPreview : null,
      discardConnect:
        tool === 'connect' ? false : get().connectPreview != null ? true : get().discardConnect
    }),
  setCommentDraft: (commentDraft) => set({ commentDraft }),
  setPdfReader: (pdfReaderId, page = 1) => set({ pdfReaderId, pdfPage: page, pdfAsset: null }),
  setShowComments: (showComments) => set({ showComments }),
  setShowProperties: (showProperties) => set({ showProperties }),
  setConnectPreview: (connectPreview) => set({ connectPreview }),
  setDiscardConnect: (discardConnect) => set({ discardConnect }),
  setDestinationPicker: (destinationPicker) =>
    set({
      destinationPicker,
      linkTarget: destinationPicker ? (get().linkTarget ?? { kind: 'card' }) : null
    }),
  setLinkTarget: (linkTarget) => set({ linkTarget, destinationPicker: linkTarget != null }),
  setConnectionDraft: (connectionDraft) => set({ connectionDraft }),
  setLabelEdit: (labelEdit) => set({ labelEdit }),
  setLineChoices: (lineChoices) => set({ lineChoices })
}))
