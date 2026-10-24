import type { ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import * as actions from './actions'
import { contextPoint } from './CanvasView'

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

  if (selectionSize === 0) {
    return (
      <>
        <Item onSelect={() => void actions.createBoardOnCanvas(contextPoint.current ?? undefined)}>
          New board here
        </Item>
        <Item
          shortcut="Ctrl+V"
          onSelect={() => void actions.paste(contextPoint.current ?? undefined)}
        >
          Paste here
        </Item>
        <Separator />
        <Item shortcut="Ctrl+A" onSelect={actions.selectAll}>
          Select all
        </Item>
        <Item shortcut="Shift+1" onSelect={actions.fitAll}>
          Zoom to fit
        </Item>
        <Item shortcut="Ctrl+'" onSelect={toggleGrid}>
          {showGrid ? 'Hide grid' : 'Show grid'}
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

  return (
    <>
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
    </>
  )
}
