import type { ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import * as actions from './actions'
import { contextPoint } from './CanvasView'
import { isViewable } from './objectTypes'
import { parseComment } from '@shared/comments'
import { parseConnection } from '@shared/connections'
import { parseDestination } from '@shared/destinations'
import { readNote } from '@shared/notes'
import type { CanvasObject } from '@shared/types'
import { isAutoHeightNote } from '../notes/measure'
import {
  createNote,
  fitNotesToContent,
  isNote,
  resetNoteAppearance,
  updateNoteStyle
} from '../notes/noteActions'
import { showInLibrary } from '../library/libraryActions'
import { openTagEditor } from '../tags/TagManager'
import { beginEditing } from '../notes/session'
import {
  copyConnectionStyle,
  pasteConnectionStyle,
  saveComment
} from '../relations/relationActions'
import { navigateTo } from '../relations/navigate'

const noteMode = (o: CanvasObject) => {
  const read = readNote(o.data)
  return read.ok ? read.note.appearance.mode : 'card'
}

/** Shortcut labels use ⌘/⌥ on macOS and Ctrl/Alt elsewhere (both modifiers work everywhere). */
const isMac = navigator.platform.toLowerCase().includes('mac')
const keyLabel = (shortcut: string): string =>
  isMac
    ? shortcut
        .replace(/Ctrl\+/g, '⌘')
        .replace(/Shift\+/g, '⇧')
        .replace(/Alt\+/g, '⌥')
    : shortcut

const itemClass =
  'flex cursor-default select-none items-center justify-between gap-6 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-canvas data-[disabled]:opacity-40'

function Item({
  children,
  shortcut,
  onSelect,
  disabled,
  danger
}: {
  children: ReactNode
  shortcut?: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={`${itemClass} ${danger ? 'text-red-700' : ''}`}
    >
      <span>{children}</span>
      {shortcut && <span className="text-xs text-muted">{keyLabel(shortcut)}</span>}
    </ContextMenu.Item>
  )
}

const Separator = () => <ContextMenu.Separator className="my-1 h-px bg-line" />

/** Right-click menu for the canvas: acts on the selection, or on the empty spot clicked. */
export function CanvasMenu({ children }: { children: ReactNode }) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 min-w-56 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <MenuItems />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function MenuItems() {
  const selectionSize = useCanvasStore((s) => s.selection.size)
  const openBoard = useWorkspaceStore((s) => s.openBoard)
  const setRenaming = useWorkspaceStore((s) => s.setRenaming)
  const setDialog = useWorkspaceStore((s) => s.setDialog)
  const toggleGrid = useCanvasStore((s) => s.toggleGrid)
  const showGrid = useCanvasStore((s) => s.showGrid)
  const openNewWindow = useProjectStore((s) => s.openNewWindow)
  const setViewerObjectId = useCanvasStore((s) => s.setViewerObjectId)

  if (selectionSize === 0) {
    return (
      <>
        <Item onSelect={() => void actions.createBoardOnCanvas(contextPoint.current ?? undefined)}>
          New board here
        </Item>
        <Item shortcut="T" onSelect={() => void createNote(contextPoint.current ?? undefined)}>
          New text here
        </Item>
        <Item onSelect={() => void actions.addImagesFromPicker(contextPoint.current ?? undefined)}>
          Add images here…
        </Item>
        <Item
          onSelect={() =>
            void import('../stacks/stackActions').then(({ createEmptyStack }) =>
              createEmptyStack(contextPoint.current ?? { x: 0, y: 0 })
            )
          }
        >
          New image stack
        </Item>
        <Item onSelect={() => void actions.addFilesFromPicker(contextPoint.current ?? undefined)}>
          Add files here…
        </Item>
        <Item
          shortcut="Ctrl+V"
          onSelect={() => void actions.paste(contextPoint.current ?? undefined)}
        >
          Paste here
        </Item>
        <Item
          onSelect={() => {
            const at = contextPoint.current ?? { x: 0, y: 0 }
            useCanvasStore.getState().setCommentDraft({
              x: at.x,
              y: at.y,
              targetId: null,
              slideId: null,
              scope: 'free'
            })
          }}
        >
          Add comment
        </Item>
        <Separator />
        <Item shortcut="Ctrl+A" onSelect={actions.selectAll}>
          Select all
        </Item>
        <Item
          onSelect={() =>
            openTagEditor({
              title: 'Tag this board',
              targets: [{ type: 'board', id: useWorkspaceStore.getState().board?.id ?? '' }]
            })
          }
        >
          Tag this board
        </Item>
        <Item shortcut="Shift+1" onSelect={actions.fitAll}>
          Zoom to fit
        </Item>
        <Item shortcut="Ctrl+'" onSelect={toggleGrid}>
          {showGrid ? 'Hide grid' : 'Show grid'}
        </Item>
        <Separator />
        <Item onSelect={() => useCanvasStore.getState().setShareDialog(true)}>
          Export this board…
        </Item>
      </>
    )
  }

  const selected = actions.selectedObjects()
  const single = selected.length === 1 ? selected[0] : undefined
  const boardId = single?.linkedBoardId ?? undefined
  const anyGrouped = selected.some((o) => o.groupId)
  const allLocked = selected.every((o) => o.locked)
  const unlocked = selected.filter((o) => !o.locked)
  const viewable = single && isViewable(single) ? single : undefined
  const unlockedImages = unlocked.filter((o) => o.type === 'image' && o.asset?.width)
  const rotated = unlocked.filter((o) => o.rotation !== 0)
  const notes = unlocked.filter(isNote)
  const noteIds = notes.map((o) => o.id)
  const fixedNotes = notes.filter((o) => !isAutoHeightNote(o))
  const allFloating = notes.length > 0 && notes.every((o) => noteMode(o) === 'floating')

  const fileCards = selected.filter(
    (object) => object.assetId && object.type !== 'text' && object.type !== 'board'
  )
  const originalIds = [
    ...new Set(fileCards.flatMap((object) => (object.assetId ? [object.assetId] : [])))
  ]

  return (
    <>
      {single?.type === 'board' && single.linkedBoardId && (
        <>
          <Item
            onSelect={() =>
              openTagEditor({
                title: 'Tag this board card',
                targets: [{ type: 'object', id: single.id }]
              })
            }
          >
            Tag this board card
          </Item>
          <Item
            onSelect={() =>
              openTagEditor({
                title: 'Tag linked board',
                targets: [{ type: 'board', id: single.linkedBoardId! }]
              })
            }
          >
            Tag linked board
          </Item>
          <Separator />
        </>
      )}
      {!(single?.type === 'board' && single.linkedBoardId) && (
        <Item
          onSelect={() =>
            openTagEditor({
              title: 'Tag selected items',
              targets: selected.map((object) => ({ type: 'object' as const, id: object.id }))
            })
          }
        >
          Tag selected items
        </Item>
      )}
      {originalIds.length > 0 && (
        <Item
          onSelect={() =>
            openTagEditor({
              title: `On the original (${fileCards.length} card${fileCards.length === 1 ? '' : 's'})`,
              targets: originalIds.map((id) => ({ type: 'asset' as const, id }))
            })
          }
        >
          On the original
        </Item>
      )}
      {single?.type === 'text' && !single.locked && (
        <>
          <Item shortcut="Enter" onSelect={() => void beginEditing(single.id)}>
            Edit text
          </Item>
          <Item
            shortcut="Ctrl+Shift+E"
            onSelect={() => void beginEditing(single.id, { mode: 'expanded' })}
          >
            Expand note
          </Item>
          <Separator />
        </>
      )}
      {notes.length > 0 && (
        <>
          <Item
            onSelect={() =>
              void updateNoteStyle(
                noteIds,
                { appearance: { mode: allFloating ? 'card' : 'floating' } },
                allFloating ? 'Show as card' : 'Show as floating text'
              )
            }
          >
            {allFloating ? 'Show as card' : 'Show as floating text'}
          </Item>
          {fixedNotes.length > 0 && (
            <Item onSelect={() => void fitNotesToContent(fixedNotes.map((o) => o.id))}>
              Fit to content
            </Item>
          )}
          <Item onSelect={() => void resetNoteAppearance(noteIds)}>Reset appearance</Item>
          <Separator />
        </>
      )}
      {single?.type === 'document' && single.asset && (
        <>
          <Item
            shortcut="Enter"
            onSelect={() => useCanvasStore.getState().setPdfReaderId(single.id)}
          >
            Open PDF
          </Item>
          <Item onSelect={() => void actions.saveOriginal(single)}>Save original as…</Item>
          <Item
            onSelect={() => void window.api.invoke('window:openReader', { objectId: single.id })}
          >
            Open in new window
          </Item>
          <Separator />
        </>
      )}
      {single?.type === 'file' && single.asset && (
        <>
          <Item
            shortcut="Enter"
            onSelect={() => useCanvasStore.getState().setFileDetailsId(single.id)}
          >
            File details
          </Item>
          <Item onSelect={() => void actions.saveOriginal(single)}>Save original as…</Item>
          <Separator />
        </>
      )}
      {single?.assetId && (
        <Item onSelect={() => void showInLibrary(single.assetId!)}>Show in library</Item>
      )}
      {single?.type === 'stack' && (
        <>
          <Item onSelect={() => useCanvasStore.getState().setStackEditorId(single.id)}>
            Edit stack
          </Item>
          <Item
            onSelect={() => {
              const slideId =
                (typeof single.data.displayedSlideId === 'string' &&
                  single.data.displayedSlideId) ||
                single.slides?.[0]?.id
              if (slideId) {
                useCanvasStore.getState().setStackViewer({
                  objectId: single.id,
                  mode: 'gallery',
                  slideId
                })
              }
            }}
          >
            Open stack
          </Item>
          <Item
            onSelect={() => {
              const slideId =
                (typeof single.data.displayedSlideId === 'string' &&
                  single.data.displayedSlideId) ||
                single.slides?.[0]?.id
              if (slideId) useCanvasStore.getState().setCropTarget({ objectId: single.id, slideId })
            }}
          >
            Crop displayed image
          </Item>
          <Separator />
        </>
      )}
      {single?.type === 'image' && (
        <Item onSelect={() => useCanvasStore.getState().setCropTarget({ objectId: single.id })}>
          Crop
        </Item>
      )}
      {unlockedImages.length >= 2 && (
        <>
          <Item
            onSelect={() =>
              void import('../stacks/stackActions').then(({ createStack }) =>
                createStack(
                  unlockedImages.map((o) => o.id),
                  'combine'
                )
              )
            }
          >
            Combine into stack
          </Item>
          <Item
            onSelect={() =>
              void import('../stacks/stackActions').then(({ createStack }) =>
                createStack(
                  unlockedImages.map((o) => o.id),
                  'copy'
                )
              )
            }
          >
            Create stack copy
          </Item>
        </>
      )}
      {viewable && (
        <>
          <Item shortcut="Enter" onSelect={() => setViewerObjectId(viewable.id)}>
            View full size
          </Item>
          <Item onSelect={() => void actions.saveOriginal(viewable)}>Save original as…</Item>
          <Separator />
        </>
      )}
      {(unlockedImages.length > 0 || rotated.length > 0) && (
        <>
          {unlockedImages.length > 0 && (
            <Item onSelect={() => void actions.resetImageSize(unlockedImages.map((o) => o.id))}>
              Reset to original size
            </Item>
          )}
          {rotated.length > 0 && (
            <Item onSelect={() => void actions.resetRotation(rotated.map((o) => o.id))}>
              Reset rotation
            </Item>
          )}
          <Separator />
        </>
      )}
      {boardId && (
        <>
          <Item shortcut="Enter" onSelect={() => void openBoard(boardId)}>
            Open
          </Item>
          <Item onSelect={() => void openNewWindow(boardId)}>Open in new window</Item>
          <Item
            shortcut="F2"
            onSelect={() => setRenaming({ type: 'board', id: boardId, source: 'board' })}
          >
            Rename
          </Item>
          <Separator />
        </>
      )}
      <Item shortcut="Ctrl+X" onSelect={() => void actions.copySelection('cut')}>
        Cut
      </Item>
      <Item shortcut="Ctrl+C" onSelect={() => void actions.copySelection('copy')}>
        Copy
      </Item>
      <Item shortcut="Ctrl+D" onSelect={() => void actions.duplicateSelection()}>
        Duplicate
      </Item>
      <Item onSelect={() => void actions.duplicateWithComments()}>Duplicate with comments</Item>
      {single?.type === 'connection' && !single.locked && (
        <>
          <Separator />
          <Item onSelect={() => useCanvasStore.getState().setLabelEdit(single.id)}>Edit label</Item>
          <Item
            onSelect={() => {
              const link = parseConnection(single.data)?.labelLink
              if (link) void navigateTo(link)
            }}
            disabled={!parseConnection(single.data)?.labelLink}
          >
            Open label link
          </Item>
          <Item onSelect={() => copyConnectionStyle(single)}>Copy style</Item>
          <Item
            onSelect={() =>
              void pasteConnectionStyle(selected.filter((object) => object.type === 'connection'))
            }
          >
            Paste style
          </Item>
        </>
      )}
      {single && single.type !== 'connection' && !single.locked && (
        <Item
          onSelect={() =>
            useCanvasStore.getState().setLinkTarget({ kind: 'object', id: single.id })
          }
        >
          Attach link
        </Item>
      )}
      {single && parseDestination(single.data.navLink) && (
        <Item onSelect={() => void navigateTo(parseDestination(single.data.navLink)!)}>
          Open attached link
        </Item>
      )}
      {single?.type === 'comment' && !single.locked && parseComment(single.data) && (
        <>
          <Item
            onSelect={() => {
              const data = parseComment(single.data)
              if (!data) return
              void saveComment(
                single,
                { ...data, presentation: data.presentation === 'pin' ? 'card' : 'pin' },
                ...[]
              )
            }}
          >
            {parseComment(single.data)?.presentation === 'pin' ? 'Show as card' : 'Show as pin'}
          </Item>
          <Item
            onSelect={() => {
              const data = parseComment(single.data)
              if (!data) return
              void saveComment(single, {
                ...data,
                status: data.status === 'resolved' ? 'open' : 'resolved'
              })
            }}
          >
            {parseComment(single.data)?.status === 'resolved' ? 'Reopen' : 'Resolve'}
          </Item>
        </>
      )}
      {single && single.type !== 'comment' && single.type !== 'connection' && (
        <Item
          onSelect={() => {
            const at = contextPoint.current ?? { x: single.x + single.width / 2, y: single.y }
            const displayed =
              single.type === 'stack'
                ? (typeof single.data.displayedSlideId === 'string' &&
                    single.data.displayedSlideId) ||
                  single.slides?.[0]?.id ||
                  null
                : null
            useCanvasStore.getState().setCommentDraft({
              x: at.x,
              y: at.y,
              targetId: single.id,
              slideId: single.type === 'stack' ? null : displayed,
              scope: single.type === 'stack' ? 'stack' : 'object'
            })
          }}
        >
          {single.type === 'stack' ? 'Comment on stack' : 'Add comment'}
        </Item>
      )}
      <Separator />
      {selected.length > 1 && (
        <Item shortcut="Ctrl+G" onSelect={() => void actions.groupSelection()}>
          Group
        </Item>
      )}
      {anyGrouped && (
        <Item shortcut="Ctrl+Shift+G" onSelect={() => void actions.ungroupSelection()}>
          Ungroup
        </Item>
      )}
      <Item shortcut="Ctrl+Shift+L" onSelect={() => void actions.toggleLockSelection()}>
        {allLocked ? 'Unlock' : 'Lock'}
      </Item>
      <Separator />
      <Item shortcut="Ctrl+Shift+]" onSelect={() => void actions.reorderSelection('front')}>
        Bring to front
      </Item>
      <Item shortcut="Ctrl+]" onSelect={() => void actions.reorderSelection('forward')}>
        Bring forward
      </Item>
      <Item shortcut="Ctrl+[" onSelect={() => void actions.reorderSelection('backward')}>
        Send backward
      </Item>
      <Item shortcut="Ctrl+Shift+[" onSelect={() => void actions.reorderSelection('back')}>
        Send to back
      </Item>
      <Separator />
      {boardId && (
        <Item onSelect={() => setDialog({ kind: 'move', target: { type: 'board', id: boardId } })}>
          Move to…
        </Item>
      )}
      <Item
        danger
        shortcut="Del"
        disabled={unlocked.length === 0}
        onSelect={() => void actions.deleteObjects(unlocked.map((o) => o.id))}
      >
        Move to trash
      </Item>
      <Separator />
      <Item onSelect={() => useCanvasStore.getState().setShareDialog(true)}>
        Export this board…
      </Item>
    </>
  )
}
