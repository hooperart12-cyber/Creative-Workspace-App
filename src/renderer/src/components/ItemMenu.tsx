import type { ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { useProjectStore } from '../store/projectStore'
import * as actions from '../canvas/actions'
import { useWorkspaceStore, type ItemRef, type ItemSource } from '../store/workspaceStore'

const itemClass =
  'flex cursor-default select-none items-center rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-canvas data-[disabled]:opacity-40'

function Item({
  children,
  onSelect,
  danger
}: {
  children: ReactNode
  onSelect: () => void
  danger?: boolean
}) {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      className={`${itemClass} ${danger ? 'text-red-700' : ''}`}
    >
      {children}
    </ContextMenu.Item>
  )
}

/** Right-click menu for a board (sidebar row or card) or a library folder. */
export function ItemMenu({
  target,
  source,
  children
}: {
  target: ItemRef
  source: ItemSource
  children: ReactNode
}) {
  const isMain = useWorkspaceStore((s) => s.tree?.mainBoardId === target.id)
  const openBoard = useWorkspaceStore((s) => s.openBoard)
  const currentBoardId = useWorkspaceStore((s) => s.board?.id)
  const createFolder = useWorkspaceStore((s) => s.createFolder)
  const setRenaming = useWorkspaceStore((s) => s.setRenaming)
  const setDialog = useWorkspaceStore((s) => s.setDialog)
  const openNewWindow = useProjectStore((s) => s.openNewWindow)

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          // Keep focus on the rename field instead of returning it to the trigger.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {target.type === 'board' ? (
            <>
              <Item onSelect={() => void openBoard(target.id)}>Open</Item>
              <Item onSelect={() => void openNewWindow(target.id)}>Open in new window</Item>
              <ContextMenu.Separator className="my-1 h-px bg-line" />
              <Item
                onSelect={() =>
                  void (target.id === currentBoardId
                    ? actions.createBoardOnCanvas()
                    : actions.createBoard(target.id))
                }
              >
                New board inside
              </Item>
              <Item onSelect={() => setRenaming({ ...target, source })}>Rename</Item>
              {!isMain && (
                <>
                  <Item onSelect={() => setDialog({ kind: 'move', target })}>Move to…</Item>
                  <ContextMenu.Separator className="my-1 h-px bg-line" />
                  <Item danger onSelect={() => setDialog({ kind: 'delete', target })}>
                    Move to trash
                  </Item>
                </>
              )}
            </>
          ) : (
            <>
              <Item onSelect={() => useWorkspaceStore.getState().openLibrary(target.id)}>
                Open in library
              </Item>
              <Item onSelect={() => void createFolder(target.id)}>New folder inside</Item>
              <Item onSelect={() => setRenaming({ ...target, source })}>Rename</Item>
              <Item onSelect={() => setDialog({ kind: 'move', target })}>Move to…</Item>
              <ContextMenu.Separator className="my-1 h-px bg-line" />
              <Item danger onSelect={() => setDialog({ kind: 'delete', target })}>
                Move to trash
              </Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
