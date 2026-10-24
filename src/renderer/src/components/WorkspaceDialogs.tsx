import { useMemo, useState } from 'react'
import { AlertDialog, Dialog } from 'radix-ui'
import * as actions from '../canvas/actions'
import { buildTree, descendantIds, flattenTree } from '../lib/tree'
import { useWorkspaceStore, type ItemRef } from '../store/workspaceStore'
import { BoardIcon, FolderIcon } from './icons'

const overlay = 'fixed inset-0 z-40 bg-black/30'
const panel =
  'fixed top-1/2 left-1/2 z-50 w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-xl'
const button = 'rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas'

export function WorkspaceDialogs() {
  const dialog = useWorkspaceStore((s) => s.dialog)
  const setDialog = useWorkspaceStore((s) => s.setDialog)
  const close = (open: boolean) => !open && setDialog(null)

  return (
    <>
      <Dialog.Root open={dialog?.kind === 'move'} onOpenChange={close}>
        {dialog?.kind === 'move' && <MoveDialog target={dialog.target} />}
      </Dialog.Root>
      <AlertDialog.Root open={dialog?.kind === 'delete'} onOpenChange={close}>
        {dialog?.kind === 'delete' && <DeleteDialog target={dialog.target} />}
      </AlertDialog.Root>
    </>
  )
}

function useItemName(target: ItemRef): string {
  return useWorkspaceStore((s) =>
    target.type === 'board'
      ? (s.tree?.boards.find((b) => b.id === target.id)?.title ?? '')
      : (s.tree?.folders.find((f) => f.id === target.id)?.name ?? '')
  )
}

function MoveDialog({ target }: { target: ItemRef }) {
  const tree = useWorkspaceStore((s) => s.tree)
  const { moveFolder } = useWorkspaceStore.getState()
  const name = useItemName(target)
  const [destination, setDestination] = useState<string | null | undefined>(undefined)

  const { options, currentParent } = useMemo(() => {
    if (!tree) return { options: [], currentParent: undefined }
    if (target.type === 'board') {
      const excluded = descendantIds(tree.boards, (b) => b.parentBoardId, target.id)
      excluded.add(target.id)
      const flat = flattenTree(buildTree(tree.boards, (b) => b.parentBoardId))
      return {
        options: flat
          .filter((n) => !excluded.has(n.item.id))
          .map((n) => ({ id: n.item.id as string | null, label: n.item.title, depth: n.depth })),
        currentParent: tree.boards.find((b) => b.id === target.id)?.parentBoardId
      }
    }
    const excluded = descendantIds(tree.folders, (f) => f.parentId, target.id)
    excluded.add(target.id)
    const flat = flattenTree(buildTree(tree.folders, (f) => f.parentId))
    return {
      options: [
        { id: null as string | null, label: 'Library (top level)', depth: 0 },
        ...flat
          .filter((n) => !excluded.has(n.item.id))
          .map((n) => ({ id: n.item.id as string | null, label: n.item.name, depth: n.depth + 1 }))
      ],
      currentParent: tree.folders.find((f) => f.id === target.id)?.parentId
    }
  }, [tree, target])

  const confirm = () => {
    if (destination === undefined) return
    if (target.type === 'board' && destination) void actions.moveBoard(target.id, destination)
    if (target.type === 'folder') void moveFolder(target.id, destination)
  }

  const Icon = target.type === 'board' ? BoardIcon : FolderIcon
  return (
    <Dialog.Portal>
      <Dialog.Overlay className={overlay} />
      <Dialog.Content className={panel} aria-describedby={undefined}>
        <Dialog.Title className="text-base font-medium">Move “{name}” to…</Dialog.Title>
        <ul
          role="listbox"
          aria-label="Destination"
          className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-line py-1 text-sm"
        >
          {options.map((option) => {
            const isCurrent = option.id === currentParent
            const selected = option.id === destination
            return (
              <li key={option.id ?? 'root'}>
                <button
                  role="option"
                  aria-selected={selected}
                  disabled={isCurrent}
                  onClick={() => setDestination(option.id)}
                  onDoubleClick={() => !isCurrent && confirm()}
                  style={{ paddingLeft: 12 + option.depth * 16 }}
                  className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset disabled:opacity-40 ${
                    selected ? 'bg-accent/10 text-accent' : 'hover:bg-canvas'
                  }`}
                >
                  <Icon width={14} height={14} className="shrink-0" />
                  <span className="truncate">{option.label}</span>
                  {isCurrent && <span className="ml-auto text-xs">(current)</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Dialog.Close className={button}>Cancel</Dialog.Close>
          <button
            onClick={confirm}
            disabled={destination === undefined}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Move
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  )
}

function DeleteDialog({ target }: { target: ItemRef }) {
  const tree = useWorkspaceStore((s) => s.tree)
  const { deleteFolder } = useWorkspaceStore.getState()
  const name = useItemName(target)

  const nestedCount = useMemo(() => {
    if (!tree) return 0
    return target.type === 'board'
      ? descendantIds(tree.boards, (b) => b.parentBoardId, target.id).size
      : descendantIds(tree.folders, (f) => f.parentId, target.id).size
  }, [tree, target])

  const noun = target.type === 'board' ? 'board' : 'folder'
  return (
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={overlay} />
      <AlertDialog.Content className={panel}>
        <AlertDialog.Title className="text-base font-medium">
          Move “{name}” to the trash?
        </AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-sm text-muted">
          {nestedCount > 0
            ? `This also moves the ${nestedCount} ${noun}${nestedCount === 1 ? '' : 's'} inside it. `
            : ''}
          You can undo this with Ctrl+Z. Trashed items stay in the project file; a Trash view for
          restoring them later is coming in a future update.
        </AlertDialog.Description>
        <div className="mt-5 flex justify-end gap-2">
          <AlertDialog.Cancel className={button}>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action
            onClick={() =>
              void (target.type === 'board'
                ? actions.deleteBoard(target.id)
                : deleteFolder(target.id))
            }
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Move to trash
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  )
}
