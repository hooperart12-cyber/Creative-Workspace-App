import { useEffect, useLayoutEffect, useRef } from 'react'
import { EditorContent } from '@tiptap/react'
import { readNote } from '@shared/notes'
import { worldToScreen } from '../canvas/geometry'
import { COLORS } from '../canvas/BoardCardNode'
import { useCanvasStore } from '../store/canvasStore'
import { noteBoxCss } from './NoteNode'
import { useNoteStore } from './noteStore'
import { endEditing, placePendingCaret, useEditedObject, useNoteEditor } from './session'

/**
 * The inline editor (§4): the note's real editor placed exactly over its canvas drawing.
 * One CSS transform matches the canvas camera — move to the note, rotate about its top-left
 * corner (as Konva does), scale by the zoom — and the editor is the note's width in canvas
 * units, so it wraps text exactly like the canvas drawing it replaces.
 */
export function NoteEditorOverlay() {
  const editing = useNoteStore((s) => s.editing)
  const editor = useNoteEditor()
  const object = useEditedObject()
  const viewport = useCanvasStore((s) => s.viewport)
  const scroll = useNoteStore((s) => (editing ? (s.scroll[editing.objectId] ?? 0) : 0))
  const box = useRef<HTMLDivElement>(null)

  const inline = !!editing && editing.mode === 'inline' && !!object && !!editor
  const read = object ? readNote(object.data) : null
  const fixed = read?.ok === true && read.note.sizing === 'fixed'

  // Fixed-height notes scroll inside: start where the canvas drawing was scrolled to. Then the
  // cursor goes where the note was double-clicked.
  useLayoutEffect(() => {
    if (inline && fixed && box.current) box.current.scrollTop = scroll
    if (inline) placePendingCaret()
    // Only when the editor appears; afterwards the editor's own scrolling leads.
  }, [inline, fixed, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // The wheel scrolls a fixed-height note's text; otherwise it moves the canvas as usual.
  useEffect(() => {
    const el = box.current
    if (!el || !inline) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      if (el.scrollHeight > el.clientHeight + 1) e.stopPropagation()
    }
    // Right-click inside the text: don't open the canvas menu.
    const onContextMenu = (e: MouseEvent) => e.stopPropagation()
    el.addEventListener('wheel', onWheel)
    el.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContextMenu)
    }
  }, [inline])

  // Clicking anywhere outside the note (or its toolbars) finishes editing.
  useEffect(() => {
    if (!editing) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (target?.closest('[data-note-ui]')) return
      void endEditing()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [editing?.objectId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!inline || !read?.ok || !object) return null
  const screen = worldToScreen(object, viewport)
  const zoom = viewport.zoom

  return (
    <div
      ref={box}
      data-note-ui
      data-testid="note-editor"
      className="cw-note cw-note-scroll absolute top-0 left-0 z-[5]"
      style={{
        ...noteBoxCss(read.note.appearance),
        width: object.width,
        height: fixed ? object.height : undefined,
        overflowY: fixed ? 'auto' : 'visible',
        transform: `translate(${screen.x}px, ${screen.y}px) rotate(${object.rotation}deg) scale(${zoom})`,
        transformOrigin: '0 0',
        outline: `${2 / zoom}px solid ${COLORS.accent}`,
        outlineOffset: `${2 / zoom}px`,
        cursor: 'text'
      }}
      onScroll={(e) => useNoteStore.getState().setScroll(object.id, e.currentTarget.scrollTop)}
      onMouseDown={(e) => {
        // Clicks in the padding put the cursor in the text.
        if (e.target === e.currentTarget) {
          e.preventDefault()
          editor.commands.focus()
        }
      }}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
