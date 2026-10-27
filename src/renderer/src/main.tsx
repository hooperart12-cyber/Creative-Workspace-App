import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useCanvasStore } from './store/canvasStore'
import { useWorkspaceStore } from './store/workspaceStore'
import { useNoteStore } from './notes/noteStore'
import { currentEditor } from './notes/session'
import { preloadNoteFonts } from './notes/fonts'
import { lastLayout } from './notes/layout'
import './styles.css'

void preloadNoteFonts()

// Read-only hook for automated UI tests: the canvas draws to <canvas>, so tests need
// the app state to know where things are on screen.
Object.assign(window, {
  __cw: {
    workspace: useWorkspaceStore,
    canvas: useCanvasStore,
    notes: useNoteStore,
    noteEditor: currentEditor,
    noteLayout: lastLayout
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
