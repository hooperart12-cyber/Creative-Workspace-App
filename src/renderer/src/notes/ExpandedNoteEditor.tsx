import { Dialog } from 'radix-ui'
import { EditorContent } from '@tiptap/react'
import { readNote } from '@shared/notes'
import { NoteFormatPanel } from './NoteFormatPanel'
import { noteBoxCss } from './NoteNode'
import { useNoteStore } from './noteStore'
import { FormatButtons, LinkEditor, NoteNotices, SaveStatusBadge } from './NoteToolbar'
import { endEditing, placePendingCaret, setMode, useEditedObject, useNoteEditor } from './session'

/** Comfortable reading width for the expanded editor (wider notes keep their own width). */
const PAGE_WIDTH = 720

/**
 * "Expand note" (§6): the same note, with the same editor and typing history, in a large
 * window with every formatting control. Esc or "Back to canvas" saves and closes it;
 * Ctrl+Shift+E goes back to editing on the canvas.
 */
export function ExpandedNoteEditor() {
  const editing = useNoteStore((s) => s.editing)
  const panelOpen = useNoteStore((s) => s.panelOpen)
  const linkEditorOpen = useNoteStore((s) => s.linkEditorOpen)
  const editor = useNoteEditor()
  const object = useEditedObject()
  const open = editing?.mode === 'expanded' && !!editor && !!object
  const read = object ? readNote(object.data) : null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && void endEditing()}>
      {open && read?.ok && (
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content
            data-note-ui
            data-testid="note-expanded"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              if (!placePendingCaret()) editor.view.focus()
            }}
            // Esc saves and closes (the editor's own Esc handling does the same).
            onEscapeKeyDown={(e) => {
              e.preventDefault()
              if (!useNoteStore.getState().linkEditorOpen) void endEditing()
            }}
            // Clicking the dimmed canvas behind finishes editing, like clicking outside a note.
            onPointerDownOutside={(e) => e.preventDefault()}
            className="fixed inset-6 z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl outline-none"
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
              <button
                type="button"
                onClick={() => void endEditing()}
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas"
                title="Save and go back to the canvas (Esc)"
              >
                ← Back to canvas
              </button>
              <Dialog.Title className="sr-only">Edit note</Dialog.Title>
              <div
                role="toolbar"
                aria-label="Text formatting"
                className="flex flex-wrap items-center gap-0.5"
              >
                <FormatButtons editor={editor} expanded />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMode('inline')}
                  className="rounded-md px-2 py-1.5 text-sm hover:bg-canvas"
                  title="Keep editing on the canvas (Ctrl+Shift+E)"
                >
                  Edit on canvas
                </button>
              </div>
              <span className="ml-auto">
                <SaveStatusBadge />
              </span>
            </header>
            {(linkEditorOpen ||
              editing?.conflict ||
              editing?.deleted ||
              editing?.readOnly ||
              editing?.status === 'error') && (
              <div className="flex flex-col items-center gap-1.5 px-3 pt-3">
                {linkEditorOpen && <LinkEditor editor={editor} />}
                <NoteNotices />
              </div>
            )}
            <div className="flex min-h-0 flex-1">
              <div
                className="min-w-0 flex-1 overflow-y-auto px-6 py-8"
                onMouseDown={(e) => {
                  // Clicks in the margin put the cursor in the text.
                  if (e.target === e.currentTarget) {
                    e.preventDefault()
                    editor.commands.focus()
                  }
                }}
              >
                <div
                  className="cw-note mx-auto min-h-full"
                  style={{
                    ...noteBoxCss({ ...read.note.appearance, mode: 'card' }),
                    width: Math.max(PAGE_WIDTH, object.width),
                    maxWidth: '100%',
                    cursor: 'text'
                  }}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) {
                      e.preventDefault()
                      editor.commands.focus('end')
                    }
                  }}
                >
                  <EditorContent editor={editor} />
                </div>
              </div>
              {panelOpen && (
                <div className="flex border-l border-line p-3">
                  <NoteFormatPanel editor={editor} object={object} />
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}
