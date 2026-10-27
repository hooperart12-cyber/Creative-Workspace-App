# Roadmap & Progress Tracker

This is the living progress tracker. **Tick boxes as work is completed** and keep it in sync with [`REQUIREMENTS.md`](REQUIREMENTS.md) and [`DECISIONS.md`](DECISIONS.md).

**Process:** at the start of each milestone, write a short plan, confirm it with the project owner, then build. UX references: **Milanote** for organization, **Figma** for canvas interaction.

---

## Phase 0 — Planning ✅
- [x] Read and analyze the feature inventory (v1.0 PDF)
- [x] Answer §23 decisions → `DECISIONS.md`
- [x] Convert requirements to Markdown → `REQUIREMENTS.md`
- [x] Define MVP scope and build order
- [x] Create handoff prompt → `HANDOFF.md`

## M0 — Scaffold ✅
- [x] Scaffold electron-vite React + TypeScript app at the repo root
- [x] Add Tailwind, Zustand, ESLint + Prettier, Vitest (Radix UI deferred to first use in M1)
- [x] Main ↔ renderer **typed IPC** layer (preload with `contextBridge`, `contextIsolation: true`)
- [x] better-sqlite3 + Drizzle: schema v1 + migrations (UUIDs, timestamps, soft delete per ADR-004)
- [x] Create / open / list recent projects (`.cwproj` folder layout per ADR-005)
- [x] Multi-window: "Open in new window"; main process broadcasts `changed` events to all windows
- [x] `npm run dev` documented in README + `docs/SETUP.md`; `npm run build:win` configured (installer built by CI on Windows)
- [x] CI: GitHub Action that runs typecheck, lint, format check and tests on Windows + macOS, and uploads a Windows installer

## M1 — Projects, Boards & Folders (§3) — *Milanote-style* ✅
- [x] Project home: main board created automatically
- [x] Create nested board as a card on its parent (stored as a `board_objects` card so the M2 canvas can render it); shown in a temporary grid until M2
- [x] Double-click a board card to open it; breadcrumb trail shows the path; Back/Forward/Up (Alt+←/→/↑, mouse buttons)
- [x] Unlimited nesting depth; prevent cycles
- [x] Left sidebar: boards tree + library folders tree (nested), collapsible (Ctrl/Cmd+\)
- [x] Rename (inline, F2, context menu), move ("Move to…" dialog), and delete (to trash, with confirmation) for boards and folders
- [x] Open a board in a new window (§2); windows stay in sync and fall back gracefully if their board is deleted elsewhere
- [x] Decision recorded: boards and folders are separate hierarchies (ADR-011, pending team discussion)

## Testing infrastructure (ongoing)
- [x] Manual test guide with per-milestone checklists (`docs/TESTING.md`), bug/feedback issue templates, PR template
- [x] End-to-end UI tests: Playwright driving the real Electron app (`e2e/`), run in CI on Windows + macOS (expand as features land)
- [ ] Renderer store tests (navigation history, rename flow, cross-window refresh)
- [ ] Coverage report with a minimum threshold for main-process logic

## M2 — Canvas Navigation & Manipulation (§4) — *Figma-style* ✅
- [x] react-konva canvas replaces the temporary grid; renders `board_objects` by position/size, with viewport culling
- [x] Pan: wheel/trackpad scroll (Shift = horizontal), Space+drag, middle-mouse drag, arrow keys
- [x] Zoom: Ctrl/Cmd+wheel or pinch toward the cursor, +/−, Shift+1 fit all, Shift+2 fit selection, Ctrl+0 to 100%, zoom % control
- [x] Each board remembers its camera; each window has its own
- [x] Select: click, Shift+click, marquee, Ctrl+A, Esc
- [x] Move by dragging and with arrow keys (Shift = 10 px)
- [x] Resize via handles (minimum size); rotation deferred to images/notes in M3
- [x] Copy / cut / paste / duplicate (deep copy of boards; cut = move on paste; works across boards and windows)
- [x] Group / ungroup; grouped objects select and move together
- [x] Lock / unlock
- [x] Layer order: forward/backward, front/back
- [x] Align (6 ways), distribute, match width/height (floating bar for 2+ selected)
- [x] Optional dot grid + snap-to-grid toggle (display never moves objects)
- [x] Smart alignment guides when dragging (Alt disables snapping)
- [x] Undo / redo for every canvas and board edit (Ctrl+Z / Ctrl+Shift+Z, toolbar buttons)
- [x] **Drag & drop:** Board tile from toolbar onto the canvas; drop cards onto a board card, breadcrumb item or sidebar row to move them inside; drag boards/folders within the sidebar
- [x] Right-click menus for canvas and cards with shortcut hints
- [x] Persist all object changes; changes sync to other windows
- [x] Custom app menu without page zoom (so Ctrl+=/− zoom the canvas, not the window)

## M3 — Object Types: Images → Text → PDF (§5, §7)

M3 is built in three parts, each with its own branch and PR.

### M3A — Images ✅ (ADR-013)
- [x] Import images by dropping files from Explorer/Finder or a browser, pasting (screenshots, images copied in a browser, files copied in Explorer), the **Image** tool, or "Add images here…"
- [x] JPG/JPEG, PNG and WebP: originals copied byte-for-byte into the asset store (never modified), deduplicated by hash, thumbnails (256/1024 px WebP) generated with `sharp`, transparency preserved
- [x] Clear message listing files that couldn't be imported (generic file cards come in M3C)
- [x] Image object: proportional resize only (no maximum size), rotation (Shift = 15° steps), no cropping or distortion; align and match size keep proportions
- [x] Zoom-dependent image quality (thumbnail → original), asynchronous decoding and an image memory budget so large images don't freeze the UI
- [x] Full-size image viewer: zoom, pan, fit-to-window, 100%, previous/next image, download original
- [x] Image context menu: view full size, save original as…, reset to original size, reset rotation
- [x] Undo/redo and multi-window sync for everything above; packaged builds include `sharp`

### M3B — Rich text notes ✅ (ADR-014)
- [x] Text note object: create with **T**, the **Text** tool, "New text here" or a double-click on empty canvas; move, resize (text reflows, never stretches), rotate, layers, copy/duplicate, delete/restore, group, align, undo/redo
- [x] Card or floating text, background, opacity, border, corners, shadow, padding, reset appearance; auto height or fixed height with scrolling and "Fit to content"
- [x] Inline editing on the canvas (double-click; click outside or Esc to finish) and an expanded editor for long text
- [x] Formatting: bold, italic, underline, strikethrough, colour, highlight, font (4 bundled + system fonts), size, headings, lists, alignment, line and paragraph spacing, clear formatting; quick toolbar and advanced panel
- [x] Safe links (Ctrl/Cmd+click opens), cleaned paste, Ctrl+Shift+V plain paste; images stay on the canvas, not inside notes
- [x] Keyboard isolation while typing, separate typing undo, autosave with a per-note status, damaged notes shown as placeholders
- [x] Multiple windows: one editor at a time with "Edit here instead", revision-checked saves and a conflict bar (no silent overwrites)
- Board covers moved to **Later** (item 10)

### M3C — Documents and other files ✅ (ADR-015)
- [x] PDF import → document card with first-page cover
- [x] PDF viewer (pdf.js): page navigation, continuous / single / two-page reading, thumbnails, text search, outline jump, download original, open in a new window
- [x] Generic file card for other types, compact or preview, with "attach preview image"; originals saved or opened only as a separate copy
- [ ] *Deprioritized (after the above):* checklists, headers/dividers, containers

## M4 — Project Asset Library (§8, §18) ✅ (ADR-016)
- [x] Library panel: grid/list view of assets with thumbnails and metadata
- [x] Library folders (DB-only, nested); move assets between folders without breaking references
- [x] Search and filter by name, type, and folder
- [x] Drag an asset from the library onto a board (one asset → many appearances)
- [x] Mass import: multi-select, drag-drop, **whole folder with structure preserved**, choose destination folder
- [x] Import directly to the library without placing on a board
- [x] Deduplicate identical files by hash
- [x] "Still referenced on N boards" warning before deleting an asset
- [x] Storage usage: per-asset size, project total, large-file warnings
- [x] Trash view: restore or permanently delete objects and assets

## M5 — Reliability & Productivity Polish (§19–21)
- [x] Visible save status indicator (text notes already have one, M3B)
- [x] Recovery points outside the project, including stored files, plus “Export project as .zip” (ADR-017; the in-project `backups/` folder stays empty)
- [x] Command palette (Ctrl/Cmd+K) via cmdk
- [x] Project-wide search (FTS5): board names, notes, file names, PDF text
- [x] Keyboard shortcut reference sheet (Ctrl/Cmd+/)
- [ ] Windows installer build tested on a real PC (CI builds the installer; this box is the manual install)

## M6 — Tags and advanced search (§12) ✅
- [x] Reusable tags and one-off tags, with archive, Tag Trash, restore, and permanent delete (ADR-018)
- [x] Separate tags for an original file, a library entry, a board appearance, a board card, and a linked board
- [x] Tag Manager, canvas pills (hidden, hover, or always visible), and bulk add, remove, and replace
- [x] Tag filters inside project search, before pagination, including PDF pages tied to one matching item
- [x] Undo refuses to reverse a newer assignment from another window
- [ ] Windows installer build tested on a real PC (same manual step as M5)

---

## Later (post-MVP), in suggested order
1. Image stacks (§9)
3. Connections/arrows, comments, link cards (§5)
4. Page collections, planner, reader mode (§10)
5. Linked TOC, named anchors, pinned panel (§13, §14)
6. Annotations and revisions (§11)
7. Board snapshots (§20)
8. More formats: TIFF, PSD, .procreate, .clip, DOCX (§7, §6)
9. Drop images straight into a nested board card; paste image URLs from the web
10. Custom fonts, covers everywhere (§17), including custom cover images for nested board cards (moved from M1, M3A and M3B)
    - Notes: images, tables and checklists inside notes; right-to-left text
11. **Cloud hybrid + collaboration (§15)**: Supabase + Cloudflare R2 (ADR-006)
12. Plot roadmaps (§16, optional)
