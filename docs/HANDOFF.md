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

**Last updated:** 2026-11-05
**Branches:** M0–M5 are on `main` (PR #10 merge `169a7b5`). M6 is `feat/m6-tags-search` ([PR #11](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/11) → `main`). M7 is `feat/m7-image-stacks` ([PR #12](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/12)). M8 is `feat/m8-connections-links-comments` ([PR #13](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/13)). M9 is `feat/m9-page-collections`, stacked on M8. Do not merge, retarget, or rebase #11, #12, or #13.
**Phase:** M9 Phase 1 persistence is in (ADR-021). Planner, Reader, Review, import, and export are not. M8 hand checks 8.14–8.21 and the Windows installer are still undone. Board covers stay Later.
**Stack integration:** `feat/m3a-images` commits `62fec97` and `73993d4` (network-link paste safety, imports outside the edit queue, and the `file:////server` check) were merged into `feat/m3b-text-notes` and then into M3C, M4, and M5. The original commits are unchanged. Image and file pickers use `importThenPlace`.

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
- Tests before M5: 131 unit tests; 34 Playwright end-to-end tests (canvas, images, 18 for notes, 2 for documents). M5 adds backup, journal, search, and reliability end-to-end tests.
- `docs/TESTING.md` has checklists for M4, M3C, M3B and M3A.
- M4 library, see ADR-016:
  - Migration `0003_library_entries` copies each old asset into one `library_entries` row, then rebuilds `assets` without `folder_id`. Foreign keys are off only while migrations run, because SQLite cannot change that pragma inside the migration transaction.
  - `LibraryRepository` (`src/main/project/library.ts`): list, details, move, rename, trash, restore, folder dissolve, purge, storage.
  - Import: `importPaths` / `importTree` in `assets.ts`. Skip or another entry is chosen before the copy. A canvas drop still creates one active entry and does not restore a trashed one.
  - Renderer: `LibraryView.tsx`, `TrashView.tsx`, sidebar file rows, import dialog. The canvas stays mounted while the library is open. Undo of library move, rename, trash, and restore uses the same per-window stack.

**Done this session (M5, ADR-017)**
- Migration `0004_reliability`: `project_state.change_revision` triggers, FTS5 `search_text` (unicode61) and `search_names` (trigram), PDF job queue.
- `src/main/project/backup.ts`, `restore.ts`, `projectZip.ts`, `journal.ts`, `search.ts`, `backupService.ts`. Pre-migration point before `migrate()`. Restore assigns a new `project_meta.id`.
- Renderer: save indicator, Backup dialog, command palette, shortcut sheet, Search, PDF indexer, draft dialog. Note session writes `recovery/` and clears a draft only after a successful save.

**Done this session (M7, ADR-019)**
- Branch `feat/m7-image-stacks`, based on M6 `19ce163`. [PR #12](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/12) targets `feat/m6-tags-search` and is not merged.
- Migration `0006_image_stacks`: `stack_slides`, and a rebuild of `tags` / `taggings` that copies every row and allows a `slide` target. Cleanup triggers are recreated after the rename.
- `StackRepository` (`src/main/project/stacks.ts`): combine, copy, add, remove, extract, reorder, cover, displayed slide, unstack, crop, and revision-checked undo.
- Canvas stack, stack editor, gallery/focus viewer, crop rectangle, drop prompt (Move is the default), and search groups that can preview a slide.

**Done earlier (M6, ADR-018)**
- Migration `0005_tags` rebuilds `tags` and `taggings` and copies every existing row. `boards.tag_visibility` is a new column. Hard-delete triggers remove assignments and one-off tags only.
- `TagRepository` (`src/main/project/tags.ts`): reusable and one-off tags, archive, Tag Trash, restore-with-rename, merge, promote, and assignment ids for undo.
- Search filters tags in SQL before pagination. A PDF page hit names the asset, entry, or appearance that matched. Tag-only search does not emit a page per page.
- Renderer: Tag manager, Tag Trash, canvas pills, library and canvas tagging, search chips. Undo refuses when another window changed that assignment.

**In progress (M8, ADR-020)**
- Branch `feat/m8-connections-links-comments`. [PR #13](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/13) targets `feat/m7-image-stacks`. Do not merge [PR #11](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/11), [PR #12](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/12), or PR #13.
- Migration `0007_connections_links_comments`. Connections, link cards, and comments are board objects. Geometry, detach/reattach, and copy remapping are in `src/shared/connections.ts`, `src/shared/destinations.ts`, `src/shared/comments.ts`, and `src/main/project/relationRepair.ts`.
- The canvas can draw a connection (L, or the dot on a selected card), drag its ends (Alt pins, Shift attaches to a group), bend a curve or elbow, label it, and copy its stroke style. Comments (C), the Comments panel, Choose destination (Ctrl+Shift+K), pasted public URLs, a dropped URL (Attach or Create card), Generate preview, attached object links, and note links to a project destination work.
- Export this board writes a PNG or a one-page PDF from the canvas layer, and a zip package of that board. Comments are omitted from the package unless Include comments and replies is on. A link to something outside the package keeps its id. Project integrity lists it when that id is not in the destination project. Slide comments follow combine, extract, remove, and separate.
- Playwright covers the connection end, bend, label, and overlap checks. It does not open the save dialog. The Windows installer has not been installed by hand.

**In progress (M9, ADR-021)**
- Branch `feat/m9-page-collections`, from M8 `5563b9d`. Not merged. No pull request yet.
- Migration `0008_page_collections`. Collections, folders, templates, pages, versions, stage state, flat contents, page links, and page comments are their own tables. A page can be tagged. The tag tables are rebuilt and existing rows are copied.
- `CollectionRepository` (`src/main/project/collections.ts`) and `src/shared/collections.ts`. Status of D01–D42 is in `docs/M9_IMPLEMENTATION_TRACKER.md`. There is no sidebar, Planner, Reader, or Review UI.

**Next steps**
1. Phase 2: Collections sidebar, creation, canvas cards, and the base Planner. Do not start a second canvas.
2. Hand-check TESTING 8.14–8.21, then the Windows installer (5.13–5.14 and 7.17).
3. Leave M6, M7, M8, and M9 unmerged. Do not retarget PR #11, #12, or #13.

**Known issues / open questions**
- Undo history is per window and not saved across restarts (by design for now).
- Windows installer not code-signed; no app icon yet.
- Dropping files onto a board card doesn't import into that board. Library import does not place cards.
- Permanent delete and Empty Trash cannot be undone. A file stays on disk while any entry, card, cover, preview, or retained recovery point still points at it, including items in Trash.
- Recovery does not include canvas drags or keystrokes that never reached the note journal. Replace-in-place restore is not implemented. OCR, folder tags, bulk rename, shortcut remapping, and cloud backup are out of scope. Project tags and tag search shipped in M6. PDF text indexing is resumable; image-only and locked PDFs match by name only. The sidebar still lists 40 files. Undo stays per window. Tag manager actions (rename, recolor, merge, archive, trash) are not on the canvas undo stack.
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
