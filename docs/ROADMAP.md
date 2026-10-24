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
- [ ] End-to-end UI tests: Playwright driving the real Electron app, automating the TESTING.md checklists, run in CI
- [ ] Renderer store tests (navigation history, rename flow, cross-window refresh)
- [ ] Coverage report with a minimum threshold for main-process logic

## M2 — Canvas Navigation & Manipulation (§4) — *Figma-style*
- [ ] Pan: Space+drag, middle-mouse drag, scroll/trackpad, arrow keys
- [ ] Zoom: Ctrl/Cmd+scroll to cursor, +/- keys, zoom % indicator, Shift+1 fit-all, Shift+2 fit-selection, Ctrl+0 to 100%
- [ ] Select: click, Shift+click, marquee drag-select, Ctrl+A
- [ ] Move by dragging and with arrow keys (Shift = 10 px)
- [ ] Resize and rotate via Konva Transformer (aspect lock for images; rotate snaps 15° with Shift)
- [ ] Copy / cut / paste / duplicate (Ctrl+D) / delete
- [ ] Group / ungroup (Ctrl+G / Ctrl+Shift+G); grouped objects move together
- [ ] Lock / unlock objects
- [ ] Layer order: bring forward/back, to front/back (Ctrl+] / Ctrl+[ …)
- [ ] Align (left/center/right/top/middle/bottom), distribute horizontally/vertically, match width/height
- [ ] Optional grid display + snap-to-grid toggle (display never moves objects)
- [ ] Smart alignment guides when dragging (edges/centers of nearby objects)
- [ ] Undo / redo command stack (Ctrl+Z / Ctrl+Shift+Z)
- [ ] Viewport culling + per-board viewport memory
- [ ] Persist all object changes (debounced autosave)

## M3 — Object Types: Images → Text → PDF (§5, §7)
- [ ] Import images via drag-drop from Explorer/Finder, paste from browser/clipboard, file picker
- [ ] JPG/JPEG + PNG: copied into the asset store, thumbnails generated with `sharp`, transparency preserved
- [ ] Image object: proportional resize only, rotate, no cropping/distortion
- [ ] Full-size image viewer: zoom, pan, fit-to-window, download original
- [ ] Text note object: place, resize, rotate, basic formatting, font size, text/background color
- [ ] Nested board card: custom cover image (moved from M1; needs image import)
- [ ] PDF import → document card with first-page cover
- [ ] PDF viewer (pdf.js): page navigation, thumbnails, text search, outline/TOC jump, download original
- [ ] Generic file card for unsupported types + "attach preview image"
- [ ] *Deprioritized (after the above):* checklists, headers/dividers, containers

## M4 — Project Asset Library (§8, §18)
- [ ] Library panel: grid/list view of assets with thumbnails and metadata
- [ ] Library folders (DB-only, nested); move assets between folders without breaking references
- [ ] Search and filter by name, type, and folder
- [ ] Drag an asset from the library onto a board (one asset → many appearances)
- [ ] Mass import: multi-select, drag-drop, **whole folder with structure preserved**, choose destination folder
- [ ] Import directly to the library without placing on a board
- [ ] Deduplicate identical files by hash
- [ ] "Still referenced on N boards" warning before deleting an asset
- [ ] Storage usage: per-asset size, project total, large-file warnings
- [ ] Trash view: restore or permanently delete objects and assets

## M5 — Reliability & Productivity Polish (§19–21)
- [ ] Visible save status indicator
- [ ] Rolling DB backups in `backups/` + "Export project as .zip"
- [ ] Command palette (Ctrl+K / Ctrl+P) via cmdk
- [ ] Project-wide search (FTS5): board names, notes, file names, PDF text
- [ ] Keyboard shortcut reference sheet
- [ ] Windows installer build tested on a real PC

---

## Later (post-MVP), in suggested order
1. Tags and tag search (§12): schema is already in place
2. Image stacks (§9)
3. Connections/arrows, comments, link cards (§5)
4. Page collections, planner, reader mode (§10)
5. Linked TOC, named anchors, pinned panel (§13, §14)
6. Annotations and revisions (§11)
7. Board snapshots (§20)
8. More formats: WebP, TIFF, PSD, .procreate, .clip, DOCX (§7, §6)
9. Custom fonts, covers everywhere (§17)
10. **Cloud hybrid + collaboration (§15)**: Supabase + Cloudflare R2 (ADR-006)
11. Plot roadmaps (§16, optional)
