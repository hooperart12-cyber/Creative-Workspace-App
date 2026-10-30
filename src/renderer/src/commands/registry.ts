import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import * as actions from '../canvas/actions'
import { createNote, editSelectedNote } from '../notes/noteActions'
import { isEditingNote } from '../notes/noteStore'
import { openTagManager } from '../tags/TagManager'
import { openIntegrity } from '../relations/relationActions'

export interface AppCommand {
  id: string
  title: string
  group:
    | 'Canvas'
    | 'Navigation'
    | 'Text editing'
    | 'PDF reader'
    | 'Asset library'
    | 'Project'
    | 'Search'
    | 'Tags'
  shortcut?: string
  run: () => void
  when?: () => boolean
}

const mod = 'Ctrl'

/** The shortcut list, the command palette, and the shortcut sheet all read this. */
export function commands(): AppCommand[] {
  const canvas = useCanvasStore.getState()
  const workspace = useWorkspaceStore.getState()
  return [
    {
      id: 'palette',
      title: 'Command palette',
      group: 'Search',
      shortcut: `${mod}+K`,
      run: () => document.dispatchEvent(new CustomEvent('cw-palette'))
    },
    {
      id: 'tags',
      title: 'Tag manager',
      group: 'Tags',
      run: () => openTagManager()
    },
    {
      id: 'search',
      title: 'Search the project',
      group: 'Search',
      shortcut: `${mod}+Shift+F`,
      run: () => workspace.openSearch()
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      group: 'Search',
      shortcut: `${mod}+/`,
      run: () => document.dispatchEvent(new CustomEvent('cw-shortcuts'))
    },
    {
      id: 'backup',
      title: 'Backup and recovery',
      group: 'Project',
      run: () => document.dispatchEvent(new CustomEvent('cw-backup'))
    },
    {
      id: 'library',
      title: 'Open library',
      group: 'Asset library',
      run: () => workspace.openLibrary(null)
    },
    {
      id: 'trash',
      title: 'Open trash',
      group: 'Asset library',
      run: () => workspace.openTrash()
    },
    {
      id: 'canvas',
      title: 'Back to the canvas',
      group: 'Navigation',
      run: () => workspace.showCanvas()
    },
    {
      id: 'undo',
      title: 'Undo',
      group: 'Canvas',
      shortcut: `${mod}+Z`,
      run: () => void actions.undo()
    },
    {
      id: 'redo',
      title: 'Redo',
      group: 'Canvas',
      shortcut: `${mod}+Shift+Z`,
      run: () => void actions.redo()
    },
    {
      id: 'connect',
      title: 'Connection tool',
      group: 'Canvas',
      shortcut: 'L',
      when: () => workspace.surface === 'canvas',
      run: () => useCanvasStore.getState().setTool('connect', false)
    },
    {
      id: 'comment',
      title: 'Comment tool',
      group: 'Canvas',
      shortcut: 'C',
      when: () => workspace.surface === 'canvas',
      run: () => useCanvasStore.getState().setTool('comment', false)
    },
    {
      id: 'link-card',
      title: 'Create link',
      group: 'Canvas',
      shortcut: `${mod}+Shift+K`,
      when: () => workspace.surface === 'canvas',
      run: () => useCanvasStore.getState().setDestinationPicker(true)
    },
    {
      id: 'comments-panel',
      title: 'Comments',
      group: 'Canvas',
      when: () => workspace.surface === 'canvas',
      run: () => useCanvasStore.getState().setShowComments(true)
    },
    {
      id: 'properties',
      title: 'Properties',
      group: 'Canvas',
      when: () => workspace.surface === 'canvas',
      run: () => useCanvasStore.getState().setShowProperties(true)
    },
    {
      id: 'integrity',
      title: 'Project integrity',
      group: 'Canvas',
      when: () => workspace.surface === 'canvas',
      run: () => void openIntegrity()
    },
    {
      id: 'note',
      title: 'New text note',
      group: 'Text editing',
      shortcut: 'T',
      when: () => workspace.surface === 'canvas' && !isEditingNote(),
      run: () => void createNote()
    },
    {
      id: 'edit-note',
      title: 'Edit selected note',
      group: 'Text editing',
      shortcut: 'Enter',
      when: () => canvas.selection.size === 1,
      run: () => editSelectedNote('inline')
    },
    {
      id: 'select-all',
      title: 'Select all',
      group: 'Canvas',
      shortcut: `${mod}+A`,
      when: () => workspace.surface === 'canvas',
      run: () => actions.selectAll()
    },
    {
      id: 'copy',
      title: 'Copy',
      group: 'Canvas',
      shortcut: `${mod}+C`,
      when: () => workspace.surface === 'canvas',
      run: () => void actions.copySelection('copy')
    },
    {
      id: 'paste',
      title: 'Paste',
      group: 'Canvas',
      shortcut: `${mod}+V`,
      when: () => workspace.surface === 'canvas',
      run: () => void actions.paste()
    },
    {
      id: 'duplicate',
      title: 'Duplicate',
      group: 'Canvas',
      shortcut: `${mod}+D`,
      when: () => workspace.surface === 'canvas',
      run: () => void actions.duplicateSelection()
    },
    {
      id: 'group',
      title: 'Group selection',
      group: 'Canvas',
      shortcut: `${mod}+G`,
      when: () => workspace.surface === 'canvas',
      run: () => void actions.groupSelection()
    },
    {
      id: 'fit',
      title: 'Zoom to fit',
      group: 'Navigation',
      shortcut: 'Shift+1',
      when: () => workspace.surface === 'canvas',
      run: () => actions.fitAll()
    },
    {
      id: 'sidebar',
      title: 'Toggle sidebar',
      group: 'Navigation',
      shortcut: `${mod}+\\`,
      run: () => workspace.toggleSidebar()
    }
  ]
}

export function availableCommands(): AppCommand[] {
  return commands().filter((command) => command.when?.() !== false)
}
