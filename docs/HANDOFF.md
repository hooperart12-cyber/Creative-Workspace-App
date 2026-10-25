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

**Last updated:** 2026-10-24
**Branch:** `feat/m3a-images` (PR open → merge into `main` after the project owner's review; don't merge automatically)
**Phase:** M3A (Images) complete; M3B (text notes, board covers) and M3C (PDFs, file cards) not started.

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
- Tests: 98 unit tests; 11 Playwright end-to-end tests (6 canvas + 5 images). The image tests include a real screenshot paste and, on Windows, a File Explorer file paste (via PowerShell `Set-Clipboard -Path`).
- `docs/TESTING.md` has an M3A checklist (30 steps).
- Packaged build verified: `sharp` loads from `app.asar.unpacked` and imports and thumbnails work.

**In progress**
- Nothing.

**Next steps**
1. Project owner reviews the M3A PR and runs the M3A checklist (pasting from their own browser and screenshot tool is the key check), then merges.
2. Discuss ADR-011 (separate vs. unified tree) with the team before M4.
3. Start **M3B** (text notes, board covers). Plan first. Likely pieces:
   - text notes with a DOM overlay editor; rotation already works through `canRotate` in `canvas/objectTypes.ts`
   - double-click on empty canvas creates a text note (Milanote)
   - board cover: pick an image asset for `boards.cover_asset_id` and draw it in `BoardCardNode` via `useImage` and `assetUrl`
4. Then **M3C**: PDF cards and viewer (pdf.js), generic file cards. Reuse `AssetRepository` (relax the image-only check per type) and the viewer pattern.

**Known issues / open questions**
- Trashed items can only be restored with undo (in the same session) until the Trash view (M4).
- Undo history is per window and not saved across restarts (by design for now).
- Windows installer not code-signed; no app icon yet.
- Images go to the library's top level and onto the open board only; there's no library panel until M4. Dropping images onto a board card doesn't import into that board yet.
- Copying objects in the app replaces the system clipboard text with a short note (by design, ADR-013).
- Unused thumbnails and originals of permanently deleted assets aren't cleaned up yet (needs the M4 Trash view).
- **Dev-only:** after hot-reloading `useCanvasShortcuts.ts`, Space+drag may stop working until the page reloads (duplicate module state). Not an issue in builds.
- **Testing tips:**
  - Drive the canvas with real input events; positions come from `window.__cw` (see `e2e/app.ts`).
  - The floating toolbar covers the canvas's top-left corner: to focus the canvas, click its middle (or another empty spot) and check `toBeFocused()`.
  - Edits in `actions.ts` run one at a time through a queue (`canvas/queue.ts`), and so do undo/redo steps. Don't call one queued action from inside another (it would wait for itself).
  - CI machines can paint late; the canvas measures itself before the first paint, so tests may interact as soon as the canvas exists.
  - New windows are listed first in DevTools `/json/list`.
  - Windows without OS focus don't fire blur, so use `Emulation.setFocusEmulationEnabled`.

**How to run**
- See `docs/SETUP.md`. Short version: `npm install`, `npm run dev`. Tests: `npm test`, `npm run test:e2e`.
