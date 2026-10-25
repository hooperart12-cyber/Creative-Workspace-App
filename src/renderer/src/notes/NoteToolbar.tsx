import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { isSafeLink } from '@shared/notes'
import { useNoteStore, type SaveStatus } from './noteStore'
import { openLink, resolveConflict, resolveDeleted, saveNoteNow, setMode } from './session'

/** Keeps the text's selection when a toolbar button is pressed. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

export const HIGHLIGHTS = ['#fff1a8', '#c9f2c7', '#c8e4ff', '#f8d0e6', '#ffd9b3', '#e2e2e2']

/** What the toolbar shows as active for the current selection. */
function useFormatState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      block: e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : 'p',
      canUndo: e.can().undo(),
      canRedo: e.can().redo()
    })
  })
}

export function ToolButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
  wide
}: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={keepFocus}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`flex h-8 ${wide ? 'px-2' : 'w-8'} items-center justify-center rounded-md text-sm text-ink hover:bg-canvas disabled:opacity-30 aria-pressed:bg-accent/10 aria-pressed:text-accent`}
    >
      {children}
    </button>
  )
}

export function ToolDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />
}

/** The quick formatting buttons (inline toolbar and expanded editor share them). */
export function FormatButtons({ editor, expanded }: { editor: Editor; expanded?: boolean }) {
  const state = useFormatState(editor)
  const panelOpen = useNoteStore((s) => s.panelOpen)
  const readOnly = useNoteStore((s) => s.editing?.readOnly ?? false)
  const chain = () => editor.chain().focus()
  const disabled = readOnly

  return (
    <>
      <select
        aria-label="Text style"
        title="Text style"
        disabled={disabled}
        value={state.block}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') chain().setParagraph().run()
          else
            chain()
              .setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 })
              .run()
        }}
        className="h-8 rounded-md border-0 bg-transparent px-1 text-sm hover:bg-canvas"
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <ToolDivider />
      <ToolButton
        label="Bold"
        shortcut="Ctrl+B"
        active={state.bold}
        disabled={disabled}
        onClick={() => chain().toggleBold().run()}
      >
        <b>B</b>
      </ToolButton>
      <ToolButton
        label="Italic"
        shortcut="Ctrl+I"
        active={state.italic}
        disabled={disabled}
        onClick={() => chain().toggleItalic().run()}
      >
        <i className="font-serif">I</i>
      </ToolButton>
      <ToolButton
        label="Underline"
        shortcut="Ctrl+U"
        active={state.underline}
        disabled={disabled}
        onClick={() => chain().toggleUnderline().run()}
      >
        <u>U</u>
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        shortcut="Ctrl+Shift+S"
        active={state.strike}
        disabled={disabled}
        onClick={() => chain().toggleStrike().run()}
      >
        <s>S</s>
      </ToolButton>
      <ToolButton
        label={state.highlight ? 'Remove highlight' : 'Highlight'}
        shortcut="Ctrl+Shift+H"
        active={state.highlight}
        disabled={disabled}
        onClick={() =>
          state.highlight
            ? chain().unsetHighlight().run()
            : chain().setHighlight({ color: HIGHLIGHTS[0] }).run()
        }
      >
        <span className="rounded-sm px-0.5" style={{ background: HIGHLIGHTS[0] }}>
          A
        </span>
      </ToolButton>
      <ToolDivider />
      <ToolButton
        label="Bulleted list"
        shortcut="Ctrl+Shift+8"
        active={state.bullet}
        disabled={disabled}
        onClick={() => chain().toggleBulletList().run()}
      >
        <BulletIcon />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        shortcut="Ctrl+Shift+7"
        active={state.ordered}
        disabled={disabled}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <NumberIcon />
      </ToolButton>
      <ToolButton
        label={state.link ? 'Edit link' : 'Add link'}
        shortcut="Ctrl+K"
        active={state.link}
        disabled={disabled}
        onClick={() => useNoteStore.setState({ linkEditorOpen: true })}
      >
        <LinkIcon />
      </ToolButton>
      <ToolDivider />
      {expanded && (
        <>
          <ToolButton
            label="Undo typing"
            shortcut="Ctrl+Z"
            disabled={disabled || !state.canUndo}
            onClick={() => chain().undo().run()}
          >
            ↶
          </ToolButton>
          <ToolButton
            label="Redo typing"
            shortcut="Ctrl+Shift+Z"
            disabled={disabled || !state.canRedo}
            onClick={() => chain().redo().run()}
          >
            ↷
          </ToolButton>
          <ToolDivider />
        </>
      )}
      <ToolButton
        label="More formatting"
        active={panelOpen}
        wide
        onClick={() => useNoteStore.getState().setPanelOpen(!panelOpen)}
      >
        Aa…
      </ToolButton>
      {!expanded && (
        <ToolButton label="Expand note" shortcut="Ctrl+Shift+E" onClick={() => setMode('expanded')}>
          <ExpandIcon />
        </ToolButton>
      )}
    </>
  )
}

/** "Saving… / Saved / Couldn't save" for the note being edited. */
export function SaveStatusBadge() {
  const status = useNoteStore((s) => s.editing?.status)
  const readOnly = useNoteStore((s) => s.editing?.readOnly)
  if (!status) return null
  if (readOnly) return <span className="px-2 text-xs whitespace-nowrap text-muted">Read only</span>
  const text: Record<SaveStatus, string> = {
    saved: 'Saved',
    unsaved: 'Saving…',
    saving: 'Saving…',
    error: 'Couldn’t save'
  }
  return (
    <span
      role="status"
      data-testid="note-save-status"
      data-status={status}
      className={`px-2 text-xs whitespace-nowrap ${status === 'error' ? 'text-red-700' : 'text-muted'}`}
    >
      {text[status]}
    </span>
  )
}

/** Adds or edits the link on the selected text (Ctrl+K). Only web and email links. */
export function LinkEditor({ editor }: { editor: Editor }) {
  const current = (editor.getAttributes('link').href as string | undefined) ?? ''
  const [value, setValue] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const close = () => {
    useNoteStore.setState({ linkEditorOpen: false })
    editor.commands.focus()
  }
  useEffect(() => input.current?.focus(), [])

  const apply = () => {
    const href = normalizeLink(value)
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return close()
    }
    if (!isSafeLink(href)) {
      setError('Only web (https://…) and email (mailto:…) links can be added.')
      return
    }
    const chain = editor.chain().focus().extendMarkRange('link')
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain
        .insertContent({
          type: 'text',
          text: value.trim(),
          marks: [{ type: 'link', attrs: { href } }]
        })
        .run()
    } else {
      chain.setLink({ href }).run()
    }
    close()
  }

  return (
    <form
      data-note-popover
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
        }
      }}
      className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-2 shadow-sm"
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          placeholder="https://example.com"
          aria-label="Link address"
          className="w-64 rounded-md border border-line px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="rounded-md bg-accent px-2.5 py-1 text-sm text-white">
          {current ? 'Update' : 'Add'}
        </button>
        {current && (
          <>
            <button
              type="button"
              onClick={() => openLink(current)}
              className="rounded-md px-2 py-1 text-sm hover:bg-canvas"
              title="Open in your browser"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                close()
              }}
              className="rounded-md px-2 py-1 text-sm hover:bg-canvas"
            >
              Remove
            </button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted">
          Links open with Ctrl+click, so a normal click never opens one by accident.
        </p>
      )}
    </form>
  )
}

/** Adds https:// or mailto: when the user typed a bare address. Empty means "remove". */
export function normalizeLink(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return `mailto:${value}`
  return `https://${value}`
}

/** Save problems and other windows' changes, with the choices the user has. */
export function NoteNotices() {
  const editing = useNoteStore((s) => s.editing)
  if (!editing) return null
  if (editing.conflict) {
    return (
      <Notice text="Someone changed this note in another window while you were typing.">
        <NoticeButton onClick={() => void resolveConflict('mine')}>Keep mine</NoticeButton>
        <NoticeButton onClick={() => void resolveConflict('theirs')}>Use theirs</NoticeButton>
        <NoticeButton onClick={() => void resolveConflict('copy')}>Keep both</NoticeButton>
      </Notice>
    )
  }
  if (editing.deleted) {
    return (
      <Notice text="This note was moved to the trash while you were typing.">
        <NoticeButton onClick={() => void resolveDeleted('keep')}>
          Keep my text as a new note
        </NoticeButton>
        <NoticeButton onClick={() => void resolveDeleted('discard')}>Discard</NoticeButton>
      </Notice>
    )
  }
  if (editing.readOnly) {
    return (
      <Notice text="Another window is editing this note now. Everything you typed here was saved." />
    )
  }
  if (editing.status === 'error') {
    return (
      <Notice
        text={`Your latest changes aren’t saved yet${editing.error ? ` (${editing.error})` : ''}. Trying again…`}
      >
        <NoticeButton onClick={() => void saveNoteNow()}>Try now</NoticeButton>
      </Notice>
    )
  }
  return null
}

function Notice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div
      role="alert"
      data-testid="note-notice"
      className="flex max-w-[34rem] flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-ink shadow-sm"
    >
      <span className="min-w-0 flex-1">{text}</span>
      {children}
    </div>
  )
}

function NoticeButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={keepFocus}
      onClick={onClick}
      className="rounded-md border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap hover:bg-canvas"
    >
      {children}
    </button>
  )
}

const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

function BulletIcon() {
  return (
    <svg {...svg}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  )
}

function NumberIcon() {
  return (
    <svg {...svg}>
      <path d="M10 6h10M10 12h10M10 18h10M4 4h1v4M4 8h2M4 14.5a1.5 1.5 0 0 1 3 0c0 1-3 2-3 3.5h3" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg {...svg}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg {...svg}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}
