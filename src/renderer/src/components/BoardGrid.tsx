import type { BoardCard } from '@shared/types'
import { useWorkspaceStore } from '../store/workspaceStore'
import { EditableTitle } from './EditableTitle'
import { BoardIcon, Plus } from './icons'
import { ItemMenu } from './ItemMenu'

/**
 * Temporary board view: nested-board cards in a grid.
 * Milestone M2 replaces this with the infinite canvas, using the same card data.
 */
export function BoardGrid() {
  const board = useWorkspaceStore((s) => s.board)
  const selectedCardId = useWorkspaceStore((s) => s.selectedCardId)
  const { createBoard, openBoard, selectCard, setRenaming, setDialog } =
    useWorkspaceStore.getState()

  if (!board) return null
  // Reading order of the card positions (the canvas will use x/y directly).
  const cards = [...board.cards].sort((a, b) => a.y - b.y || a.x - b.x)

  const onKeyDown = (e: React.KeyboardEvent) => {
    const selected = cards.find((c) => c.boardId === selectedCardId)
    if (!selected) return
    if (e.key === 'Enter') void openBoard(selected.boardId)
    if (e.key === 'F2') setRenaming({ type: 'board', id: selected.boardId, source: 'board' })
    if (e.key === 'Delete' || e.key === 'Backspace') {
      setDialog({ kind: 'delete', target: { type: 'board', id: selected.boardId } })
    }
  }

  return (
    <div
      className="flex-1 overflow-auto p-8 outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={() => selectCard(null)}
    >
      <ul
        aria-label={`Boards on ${board.title}`}
        className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6"
      >
        {cards.map((card) => (
          <Card key={card.objectId} card={card} selected={card.boardId === selectedCardId} />
        ))}
        <li>
          <button
            onClick={(e) => {
              e.stopPropagation()
              void createBoard(board.id)
            }}
            className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-muted hover:border-accent hover:text-accent"
          >
            <Plus width={20} height={20} />
            <span className="text-sm font-medium">New board</span>
          </button>
        </li>
      </ul>
      {cards.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          This board is empty. Add a board to start organizing. Images, notes and the free-form
          canvas arrive in upcoming milestones.
        </p>
      )}
    </div>
  )
}

function Card({ card, selected }: { card: BoardCard; selected: boolean }) {
  const renaming = useWorkspaceStore(
    (s) =>
      s.renaming?.type === 'board' &&
      s.renaming.id === card.boardId &&
      s.renaming.source === 'board'
  )
  const { openBoard, selectCard, renameBoard, setRenaming } = useWorkspaceStore.getState()

  return (
    <ItemMenu target={{ type: 'board', id: card.boardId }} source="board">
      <li
        aria-label={card.title}
        aria-selected={selected}
        onClick={(e) => {
          e.stopPropagation()
          selectCard(card.boardId)
        }}
        onContextMenu={() => selectCard(card.boardId)}
        onDoubleClick={() => void openBoard(card.boardId)}
        className="cursor-default select-none"
      >
        <div
          className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border bg-surface shadow-sm transition-shadow hover:shadow-md ${
            selected ? 'border-accent ring-2 ring-accent/30' : 'border-line'
          }`}
        >
          <BoardIcon width={28} height={28} className="text-accent/70" />
          <span className="text-xs text-muted">
            {card.childBoardCount === 0
              ? 'Empty'
              : `${card.childBoardCount} board${card.childBoardCount === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="mt-2 px-1 text-sm font-medium">
          {renaming ? (
            <EditableTitle
              value={card.title}
              ariaLabel="Board name"
              onCommit={(v) => void renameBoard(card.boardId, v)}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="block truncate">{card.title}</span>
          )}
        </div>
      </li>
    </ItemMenu>
  )
}
