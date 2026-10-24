import { useEffect } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import * as actions from './actions'

let spaceHeld = false

/** True while Space is held (Space + drag pans the canvas). */
export const isSpaceHeld = (): boolean => spaceHeld

/** Typing in a field, using a menu or a dialog: leave the keys alone. */
function keysBelongElsewhere(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null
  if (
    target?.closest(
      'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], [role="alertdialog"]'
    )
  ) {
    return true
  }
  return useWorkspaceStore.getState().dialog !== null
}

/**
 * Canvas keyboard shortcuts (§19), following Figma conventions. Ctrl and Cmd both work.
 * Handled keys call preventDefault so app-menu accelerators don't also fire.
 */
export function useCanvasShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (keysBelongElsewhere(e)) return
      const canvas = useCanvasStore.getState()
      const workspace = useWorkspaceStore.getState()
      const mod = e.ctrlKey || e.metaKey
      // Plain keys (Space, Enter, Delete, arrows) on a focused button or tree row belong to it.
      const onControl = (e.target as HTMLElement | null)?.closest('button, a, [role="treeitem"]')
      if (onControl && !mod) return
      const selected = actions.selectedObjects()
      const handled = (fn: () => void) => {
        e.preventDefault()
        fn()
      }

      if (e.code === 'Space' && !mod) {
        if (!spaceHeld) {
          spaceHeld = true
          document.body.style.cursor = 'grab'
        }
        return e.preventDefault()
      }

      if (mod) {
        if (e.code === 'KeyZ')
          return handled(() => void (e.shiftKey ? actions.redo() : actions.undo()))
        if (e.code === 'KeyY') return handled(() => void actions.redo())
        if (e.code === 'KeyA') return handled(actions.selectAll)
        if (e.code === 'KeyC') return handled(() => void actions.copySelection('copy'))
        if (e.code === 'KeyX') return handled(() => void actions.copySelection('cut'))
        if (e.code === 'KeyV') return handled(() => void actions.paste())
        if (e.code === 'KeyD') return handled(() => void actions.duplicateSelection())
        if (e.code === 'KeyG') {
          return handled(
            () => void (e.shiftKey ? actions.ungroupSelection() : actions.groupSelection())
          )
        }
        if (e.code === 'KeyL' && e.shiftKey)
          return handled(() => void actions.toggleLockSelection())
        if (e.code === 'BracketRight') {
          return handled(() => void actions.reorderSelection(e.shiftKey ? 'front' : 'forward'))
        }
        if (e.code === 'BracketLeft') {
          return handled(() => void actions.reorderSelection(e.shiftKey ? 'back' : 'backward'))
        }
        if (e.code === 'Digit0') return handled(actions.zoomToActualSize)
        if (e.code === 'Equal' || e.code === 'NumpadAdd')
          return handled(() => actions.zoomStepAtCenter(1))
        if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          return handled(() => actions.zoomStepAtCenter(-1))
        }
        if (e.code === 'Quote') return handled(canvas.toggleGrid)
        return
      }

      if (e.altKey) return // Alt+arrows navigate boards (handled by the project view)

      if (e.shiftKey && e.code === 'Digit1') return handled(actions.fitAll)
      if (e.shiftKey && e.code === 'Digit2') return handled(actions.fitSelection)
      if (e.key === '+' || e.key === '=') return handled(() => actions.zoomStepAtCenter(1))
      if (e.key === '-') return handled(() => actions.zoomStepAtCenter(-1))

      if (e.key === 'Escape') {
        return handled(() => {
          canvas.setSelection([])
          if (canvas.cut.size) {
            canvas.setCut([])
            void window.api.invoke('clipboard:set', null)
          }
        })
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = selected.filter((o) => !o.locked).map((o) => o.id)
        return handled(() => void actions.deleteObjects(ids))
      }

      const single = selected.length === 1 ? selected[0] : undefined
      if (e.key === 'Enter' && single?.linkedBoardId) {
        return handled(() => void workspace.openBoard(single.linkedBoardId!))
      }
      if (e.key === 'F2' && single?.linkedBoardId) {
        return handled(() =>
          workspace.setRenaming({ type: 'board', id: single.linkedBoardId!, source: 'board' })
        )
      }

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }
      const arrow = arrows[e.key]
      if (arrow) {
        const step = e.shiftKey ? 10 : 1
        const movable = selected.filter((o) => !o.locked)
        if (movable.length) {
          // Nudge the selection.
          return handled(
            () =>
              void actions.applyPatches(
                movable.map((o) => ({
                  id: o.id,
                  x: o.x + arrow[0] * step,
                  y: o.y + arrow[1] * step
                })),
                'Nudge'
              )
          )
        }
        // Nothing selected: pan the view.
        const vp = canvas.viewport
        const pan = e.shiftKey ? 200 : 50
        return handled(() =>
          canvas.setViewport({ ...vp, x: vp.x - arrow[0] * pan, y: vp.y - arrow[1] * pan })
        )
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false
        document.body.style.cursor = ''
      }
    }
    const onBlur = () => {
      spaceHeld = false
      document.body.style.cursor = ''
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
