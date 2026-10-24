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
**Branch:** `feat/m1-boards-folders` (PR open → merge into `main`)
**Phase:** M1 (Projects, Boards & Folders) complete; M2 (Canvas) not started.

**Done**
- M0 scaffold (PR #2): Electron + React 19 + TS 6 + Tailwind 4, SQLite per project, multi-window, CI.
- M1:
  - `BoardRepository` / `FolderRepository` in `src/main/project/` (nesting, breadcrumb, move with cycle checks, soft-delete cascade, main board protected; the main board's title follows the project name).
  - Each nested board is also a `board` card in `board_objects`, auto-placed on a 4-column grid (`CARD_GRID`). M2 should render these cards on the canvas.
  - UI: sidebar (Boards + Library folders trees), breadcrumb with Back/Forward/Up, temporary card grid (`BoardGrid.tsx`), right-click menus (Radix), Move/Delete dialogs.
  - Per-window navigation state in `workspaceStore`; current board kept in the URL hash (reload keeps it; "Open in new window" passes it).
  - 25 unit tests.
- ADR-011: boards and folders are separate hierarchies, **pending team discussion**.

**In progress**
- Nothing.

**Next steps**
1. Merge the M1 PR once CI is green.
2. Discuss ADR-011 (separate vs. unified tree) with the team before M4.
3. Start **M2 — Canvas** (see ROADMAP). Write a plan first and confirm it with the project owner. Replace `BoardGrid` with a react-konva canvas that renders `board_objects` using their x/y/width/height, and persist moves/resizes.

**Known issues / open questions**
- Trashed boards and folders can't be restored from the UI yet (Trash view is planned for M4); they remain in the database with `deleted_at` set.
- The Windows installer is not code-signed (SmartScreen warning on first run).
- No app icon yet.
- **Testing tip:** when driving the app over DevTools (`--remoteDebuggingPort`), a window without OS focus won't fire blur events. Use `Emulation.setFocusEmulationEnabled`. The newest window is listed first in `/json/list`.

**How to run**
- See `docs/SETUP.md`. Short version: `npm install`, then `npm run dev`. Tests: `npm test`.
