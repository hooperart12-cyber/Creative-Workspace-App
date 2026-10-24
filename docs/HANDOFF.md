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
- The tech stack is decided (docs/DECISIONS.md): Electron + electron-vite + React 18 +
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
**Branch:** `feat/m2-canvas` (PR open → merge into `main`; it includes the testing-guide commits from PR #4)
**Phase:** M2 (Canvas) complete; M3 (Images, text notes, PDFs) not started.

**Done**
- M0 scaffold, M1 boards/folders (PRs #2, #3), testing guide (PR #4).
- M2 canvas (react-konva), see ADR-012:
  - Figma-style pan/zoom, per-board camera memory, selection (click/shift/marquee), move, resize.
  - Smart guides + optional snap-to-grid.
  - Group, lock, layer order, align/distribute/match size.
  - Copy/cut/paste/duplicate (deep board copies), undo/redo for every edit.
  - Drag-and-drop: toolbar tile onto the canvas; cards onto board cards, breadcrumb items or sidebar rows to nest; sidebar tree drag for boards and folders.
- Backend: `ObjectRepository` (`src/main/project/objects.ts`) for batch updates, trash/restore, move-to-board and copy. `BoardRepository` gained restore, duplicate, setViewport and cardIdOf. Deletion timestamps are strictly increasing (`deletionTime()`).
- Tests: 64 unit tests; 6 Playwright end-to-end tests (`e2e/`) run in CI on Windows + macOS.
- `docs/TESTING.md` has an M2 checklist (33 steps); the M1 checklist was updated for the canvas.

**In progress**
- Nothing.

**Next steps**
1. Merge the M2 PR once CI is green. The project owner should run the M2 checklist; how the canvas *feels* is the key feedback.
2. Discuss ADR-011 (separate vs. unified tree) with the team before M4.
3. Start **M3 — Images, text notes, PDFs** (see ROADMAP). Plan first. Likely pieces:
   - an asset import pipeline (copy + SHA-256 + `sharp` thumbnails, ADR-005)
   - image objects with aspect-locked resize and rotation (enable the Transformer's `rotateEnabled` / `keepRatio` per type)
   - text notes (DOM overlay editor)
   - PDF cards and viewer (pdf.js)
   - double-click on empty canvas creates a text note (Milanote)
   - add a renderer for each new `type` alongside `BoardCardNode`

**Known issues / open questions**
- Trashed items can only be restored with undo (in the same session) until the Trash view (M4).
- Undo history is per window and not saved across restarts (by design for now).
- Windows installer not code-signed; no app icon yet.
- **Dev-only:** after hot-reloading `useCanvasShortcuts.ts`, Space+drag may stop working until the page reloads (duplicate module state). Not an issue in builds.
- **Testing tips:**
  - Drive the canvas with real input events; positions come from `window.__cw` (see `e2e/app.ts`).
  - New windows are listed first in DevTools `/json/list`.
  - Windows without OS focus don't fire blur, so use `Emulation.setFocusEmulationEnabled`.

**How to run**
- See `docs/SETUP.md`. Short version: `npm install`, `npm run dev`. Tests: `npm test`, `npm run test:e2e`.
