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
**Branch:** `docs/planning`
**Phase:** Phase 0 (Planning) complete; M0 (Scaffold) not started.

**Done**
- Requirements converted from PDF to `docs/REQUIREMENTS.md` (original archived in `docs/archive/`).
- All §23 architecture decisions recorded in `docs/DECISIONS.md` (ADR-001 to ADR-009).
- MVP scope and milestones defined in `docs/ROADMAP.md`.

**In progress**
- Nothing.

**Next steps**
1. Merge the `docs/planning` PR.
2. Start **M0 — Scaffold** (see ROADMAP). Write a plan first and confirm it with the project owner.

**Known issues / open questions**
- The `random` file at the repo root looks like a placeholder; confirm with the owner before deleting.
- Detailed UI styling is not yet decided (to be settled during M1).

**How to run**
- No application code yet. After M0: `npm install` then `npm run dev`.
