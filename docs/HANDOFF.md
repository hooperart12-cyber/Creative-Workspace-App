# Agent Handoff

Use this file to pass work between AI coding sessions (or developers) without losing context.

- **Incoming agent:** paste the prompt below into the new session, or tell the agent to read this file first.
- **Outgoing agent:** before your context or tokens run out, update **Current state** at the bottom, commit it, and push.

---

## Handoff prompt (copy everything in this block)

```text
You are continuing development of the Creative Workspace App
(GitHub: hooperart12-cyber/Creative-Workspace-App), a PC desktop creative workspace
for artists and writers, inspired by Milanote (organization) and Figma (canvas feel).

BEFORE WRITING ANY CODE:
1. Read, in order: README.md, docs/HANDOFF.md ("Current state" section),
   docs/ROADMAP.md, docs/DECISIONS.md, and the relevant sections of docs/REQUIREMENTS.md.
2. Run `git log --oneline -20` and `git status` to see recent work.
3. PLAN FIRST: write a short plan for the next unchecked items in docs/ROADMAP.md
   and get the project owner's confirmation before you start coding.

RULES:
- The tech stack is decided (docs/DECISIONS.md): Electron + electron-vite + React 19 +
  TypeScript, Zustand, Tailwind + Radix UI, react-konva for the canvas, SQLite per project
  (better-sqlite3 + Drizzle ORM), pdf.js, sharp. Do not change the stack without adding a
  new ADR to docs/DECISIONS.md and asking the project owner.
- Architecture: the Electron main process is the local "backend" and owns all database and
  file access. The React renderer talks to it only through the typed IPC/preload API.
  Keep every write in the main-process repository layer (needed for future cloud sync).
- Schema rules: UUID primary keys, created_at/updated_at, soft delete via deleted_at.
- NEVER modify original asset files. Imports are copied into <project>/assets/ and named
  by their SHA-256 hash. Library folders exist only in the database.
- Priorities: §3 nested boards/folders → §4 canvas manipulation/navigation → §5 images
  (then text notes, then PDF) → §7 JPG/PNG/PDF → §8 asset library.
  Deprioritized: checklists, headers/dividers, containers, non-standard file formats.
- UX defaults: when the spec doesn't say, follow Milanote for boards and organization,
  and Figma for canvas interaction and shortcuts.
- Keep docs current in the same commit/PR as the code: tick boxes in docs/ROADMAP.md,
  record new decisions in docs/DECISIONS.md, update status badges in docs/REQUIREMENTS.md.
- Testing: every feature PR adds unit tests for its logic, adds/updates its manual
  checklist in docs/TESTING.md, and includes a "How to test" section in the PR.
- Work on feature branches and open PRs; don't push directly to main.
- Verify your work: run typecheck, lint and tests, and launch the app (`npm run dev`)
  to check the feature actually works before calling it done.
- When your context is nearly used up: stop starting new work, update the
  "Current state" section of docs/HANDOFF.md, commit, push, and tell the project owner.
```

---

## Current state

> Outgoing agent: replace this section each session. Keep it short and factual.

**Last updated:** 2026-10-25
**Branches:** `feat/m3a-images` (PR #6 → `main`), `feat/m3b-text-notes` (PR #7 → `feat/m3a-images`), `feat/m3c-documents` (PR #8 → `feat/m3b-text-notes`), `feat/m4-asset-library` (PR into `feat/m3c-documents`). Do not merge any of them automatically. Merge M3A, then M3B, then M3C, then M4, retargeting each onto `main` after the one below it merges.
**Phase:** M4 (the asset library) is implemented on `feat/m4-asset-library`. M3A–M3C are still awaiting review. Board covers stay Later. Next milestone is M5.

**Done**
- M0 scaffold, M1 boards/folders, testing guide, M2 canvas (PR #5, ADR-012).
- M3A images, see ADR-013:
  - **Main process:**
    - `AssetRepository` (`src/main/project/assets.ts`): streamed copy + SHA-256, content check with `sharp`, dedupe, thumbnails (256/1024 WebP), export of originals. `ImportOptions.folderId` is ready for M4.
    - `cw-asset://` protocol (`src/main/assetProtocol.ts`).
    - `ObjectRepository.createImages` and proportions enforced in `update`.
    - Clipboard: a note on the system clipboard tells the app's own copies apart from external ones (`clipboard:importExternal` reads screenshots, browser images and Explorer files).
  - **Renderer:**
    - `ImageNode` with zoom-dependent quality and a shared decoded-image cache (`imageCache.ts`).
    - Per-selection Transformer: corner-only proportional resize, rotation with Shift = 15°.
    - Rotated bounds (`src/shared/geometry.ts`) used across the canvas maths.
    - Import flows in `actions.ts`: drop, paste, picker, one undo step, notice for skipped files.
    - `ImageViewer.tsx`.
  - The image tests include a real screenshot paste and, on Windows, a File Explorer file paste (via PowerShell `Set-Clipboard -Path`).
  - Packaged build verified: `sharp` loads from `app.asar.unpacked` and imports and thumbnails work.
- M3B rich text notes, see ADR-014:
  - **Shared:** `src/shared/notes.ts`: document schema, sanitiser (the allow-list), `readNote`, `plainTextOf`, `isSafeLink`, size limits.
  - **Main process:**
    - `NoteRepository` (`src/main/project/notes.ts`): create, revision-checked `saveContent`, `updateStyle`. The `revision` column comes from migration `0001_note_revision`.
    - `NoteLeases` (`noteLeases.ts`): who is editing which note. `ipc.ts` handles `notes:*`, `links:open`, take-over (waits up to 3 s for `notes:handedOver`) and window-close flushing (`window:flushRequest`, up to 4 s).
  - **Renderer** (`src/renderer/src/notes/`):
    - `session.ts` is the heart: one Tiptap editor per window, autosave, retries, conflicts, leases, the undo step at the end of editing.
    - `layout.ts` / `measure.ts`: hidden-DOM layout read back as lines and runs. `NoteNode.tsx` paints them in Konva.
    - `NoteEditorOverlay.tsx` (inline), `ExpandedNoteEditor.tsx`, `NoteChrome.tsx` (toolbar position, notices), `NoteToolbar.tsx`, `NoteFormatPanel.tsx`.
    - `extensions.ts` (Tiptap setup, shortcuts), `paste.ts` (DOMPurify), `fonts.ts` (bundled fonts plus the Local Font Access API), `noteActions.ts` (style changes as canvas steps).
- M3C PDFs and generic files, see ADR-015:
  - **Main process:** `describeFile` in `assets.ts` classifies each import (image, readable PDF, or generic file). Migration `0002_pdf_page_count`. `assets:readRange` serves PDF bytes. `assets:saveCover`, `assets:recordPdfInfo`, `assets:setPreview`, `assets:openCopy`. Dangerous extensions cannot be launched (`src/shared/files.ts`).
  - **Renderer:** `DocumentNode` / `FileNode`, `PdfReader.tsx` (pdf.js, range transport, virtualized pages), `pdfCover.ts`, `FileDetails.tsx`. A reader window is `window:openReader` with `#pdf=<objectId>`.
- Tests: 131 unit tests; 34 Playwright end-to-end tests (canvas, images, 18 for notes, 2 for documents).
- `docs/TESTING.md` has checklists for M4, M3C, M3B and M3A.
- M4 library, see ADR-016:
  - Migration `0003_library_entries` copies each old asset into one `library_entries` row, then rebuilds `assets` without `folder_id`. Foreign keys are off only while migrations run, because SQLite cannot change that pragma inside the migration transaction.
  - `LibraryRepository` (`src/main/project/library.ts`): list, details, move, rename, trash, restore, folder dissolve, purge, storage.
  - Import: `importPaths` / `importTree` in `assets.ts`. Skip or another entry is chosen before the copy. A canvas drop still creates one active entry and does not restore a trashed one.
  - Renderer: `LibraryView.tsx`, `TrashView.tsx`, sidebar file rows, import dialog. The canvas stays mounted while the library is open. Undo of library move, rename, trash, and restore uses the same per-window stack.

**In progress**
- Nothing in the working tree once the M4 PR is open.

**Next steps**
1. Project owner reviews the M3A PR and runs the M3A checklist, then merges.
2. After M3A merges, retarget the M3B PR to `main`, review it, then merge.
3. After M3B merges, retarget the M3C PR to `main`, run the M3C checklist (a long PDF and **Open a copy** are the key checks), then merge.
4. Retarget the M4 PR onto `main` after M3C merges, and run the M4 checklist (a large folder and Empty Trash are the key checks).
5. Later: M5, then board covers (`boards.cover_asset_id` drawn in `BoardCardNode`).

**Known issues / open questions**
- Undo history is per window and not saved across restarts (by design for now).
- Windows installer not code-signed; no app icon yet.
- Dropping files onto a board card doesn't import into that board. Library import does not place cards.
- Permanent delete and Empty Trash cannot be undone. A file stays on disk while any entry, card, cover, or preview still points at it, including items in Trash.
- Copying objects in the app replaces the system clipboard text with a short note (by design, ADR-013).
- Notes: known display approximations and other limits are listed at the end of ADR-014. A note moved to another board by another window while you're editing shows the "moved to the trash" choices.
- PDFs: the reader asks the main process for byte ranges because `fetch` of `cw-asset://` fails in Chromium. Limits are at the end of ADR-015. PDF and file cards do not rotate. A password is remembered only until that reader window closes.
- Notes rely on two private details: Konva's `stage._lastClicks` (reset after a drag so the drag's mouse-up doesn't pair with the next click as a double-click), and ProseMirror's view for placing the cursor. Recheck both when upgrading Konva or Tiptap.
- **Dev-only:** after hot-reloading `useCanvasShortcuts.ts`, Space+drag may stop working until the page reloads (duplicate module state). Not an issue in builds.
- **Testing tips:**
  - Drive the canvas with real input events; positions come from `window.__cw` (see `e2e/app.ts`).
  - The floating toolbar covers the canvas's top-left corner: to focus the canvas, click its middle (or another empty spot) and check `toBeFocused()`.
  - Edits in `actions.ts` run one at a time through a queue (`canvas/queue.ts`), and so do undo/redo steps. Don't call one queued action from inside another (it would wait for itself).
  - CI machines can paint late; the canvas measures itself before the first paint, so tests may interact as soon as the canvas exists. Konva's hit map (what a click lands on) is refreshed before every press for the same reason (`CanvasView`), so clicks follow the board's data, not the last painted frame. Both are covered by e2e tests that delay `ResizeObserver` / `requestAnimationFrame`.
  - "Download original" copies to a hidden `.part` file next to the destination and renames it when complete; wait for the file to exist rather than polling its contents.
  - New windows are listed first in DevTools `/json/list`.
  - Windows without OS focus don't fire blur, so use `Emulation.setFocusEmulationEnabled`.
  - Notes: Chromium reports selection changes about a frame late, so after a click or arrow key in a note, wait until the editor's selection matches the page (`synced` / `moveCursor` in `e2e/notes.spec.ts`) before typing. With two windows, call `page.bringToFront()` before typing in a window; cursor keys are unreliable in a background window.

**How to run**
- See `docs/SETUP.md`. Short version: `npm install`, `npm run dev`. Tests: `npm test`, `npm run test:e2e`.
