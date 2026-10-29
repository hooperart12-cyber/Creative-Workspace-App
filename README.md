# Creative Workspace App

A PC desktop creative workspace, inspired by Milanote (boards and organization) and Figma (canvas feel), for artists, illustrators, comic and manga creators, writers, and other visual storytellers.

It combines infinite visual canvases, interconnected boards, notes, reference images, document viewing, artwork management, and project organization in one flexible environment. The goal is to support the whole creative process, from brainstorming and research through planning, review, and organizing finished work, without forcing a rigid workflow.

> **Status:** M7 (image stacks and crops) is complete on its own branch. M8 (connections, links, and comments) is in progress on `feat/m8-connections-links-comments` and is not finished. Original files stay unchanged. M6 and M7 are not merged.
> This README summarizes the full feature vision. The complete, **living** specification is [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md). The original PDF (v1.0) is archived at [`docs/archive/`](docs/archive/Creative%20Workspace%20App%20v1.0.pdf).

## Project Docs

| Document | What it's for |
|---|---|
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Living requirements: the full feature inventory with MVP/Later status per section |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architecture decisions with pros and cons (frameworks, database, storage, local vs. cloud) |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones and progress checklist |
| [`docs/TESTING.md`](docs/TESTING.md) | **How to test the app by hand** (installer download, step-by-step checklists per milestone, reporting bugs) |
| [`docs/SETUP.md`](docs/SETUP.md) | **Install prerequisites, run, test and build the app**; full dependency list |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Prompt and current-state notes for continuing work in a new AI/dev session |

**Working process:** plan first, then build. Each milestone starts with a written plan that the project owner confirms. Every PR that makes or changes a decision updates `REQUIREMENTS.md`, `DECISIONS.md` and `ROADMAP.md` in the same PR. Before a session ends, update the "Current state" section of `HANDOFF.md`.

| | |
|---|---|
| **Platform** | PC desktop (keyboard and mouse) |
| **Development approach** | AI-assisted coding, supported by an experienced developer |
| **Initial purpose** | Personal use, with optional collaborative workspaces |
| **Scope of this document** | Full feature vision, not the initial MVP |

---

## Core Design Principles

- **Creative freedom.** Users are never forced into predefined organizational structures.
- **Art-focused, not manga-exclusive.** Every feature is available in every project.
- **Visual organization first.** Infinite canvases are the foundation of the app.
- **Optional structure.** Grids, guides, tags, and templates help without being mandatory.
- **Original file preservation.** Artwork is organized and displayed, never altered.
- **Review over creation.** Dedicated art and writing programs handle most content creation.
- **Expandable design.** The app is structured so features can be added later.
- **No integrated AI.** AI may help build the app, but no live AI features are planned inside it.

This app is not meant to replace Clip Studio Paint, Procreate, Photoshop, Microsoft Word, or other professional drawing and writing software.

---

## Planned Features

### Workspace and Organization

- **Multiple windows.** Open different boards or the same project in several windows, each with its own zoom and scroll, with saved changes synced between them. Works across any number of monitors. No advanced docking.
- **Independent projects.** Each project has its own main board, nested boards, folders, asset library, documents, collections, and tags.
- **Folders and nested boards.** Organize through a traditional folder sidebar, visually by placing boards inside boards, or both.
- **Collections.** Groups of content with extra viewing features, such as chapters, page sequences, galleries, and reference sets. A collection can appear as an object on a board.

### Infinite Canvas

- Unlimited panning, smooth zooming, and fit-to-screen, with no page boundaries.
- Drag, resize, multi-select, duplicate, group, lock, layer, and align objects. Notes and comments can rotate freely.
- Freeform placement by default, with optional grids, snap-to-grid, alignment guides, equal spacing, and uniform sizing. Showing guides never moves objects on its own.

### Board Objects

Text boxes and notes, images, documents, nested boards, checklists, simple tables, headers and dividers, containers, connection lines and arrows, link cards, and free-floating or attached comments.

### Documents

- A dedicated viewer for writing documents and PDFs, built to handle manuscripts and scripts hundreds of pages long.
- Search, a linked table of contents, jumping to chapters or scenes, bookmarks, review comments, limited text corrections where the format allows, and original-file download.
- The focus is reviewing and navigating, not full editing.

### Artwork and Images

- Images are never distorted, cropped, reshaped, or modified. Aspect ratio, resolution, and transparency are preserved.
- Full-size preview with zoom, pan, fit-to-window, collection navigation, and original download.
- Target formats include PNG, JPEG, WebP, TIFF, PSD, PDF, `.clip`, and `.procreate`. Storing a file doesn't guarantee it can be previewed, so files that can't be previewed can have a standard image attached as their preview.

### Asset Libraries

- Each project has its own library that stores original files with their metadata, folders, search, and storage tracking.
- **Reusable assets.** One file can appear on many boards without being duplicated. Removing it from a board doesn't delete the original, and deleting an original warns you if it's still used elsewhere.
- **Mass importing.** Import multiple files or whole folders, keep their folder structure, and tag in bulk, all without placing anything on a board.

### Image Stacks

Combine images on a board into one stack that shows a single image at a time. Click through with arrows, reorder, set a cover, view as a slideshow, or split the stack apart again. This is useful for sketch, ink, and final stages, outfits, expressions, and alternate concepts.

### Page Collections and Manga Planning

Available in every project, not just manga projects.

- Ordered page sequences organized into chapters.
- A page planner with thumbnails, empty placeholders, spreads, right-to-left or left-to-right reading, page-turn planning, and page counts.
- Replace rough pages with updated art while keeping each page's position, and optionally keep earlier versions.
- A full-screen reader and presentation mode with single-page, spread, and vertical scroll views, plus a separate review mode where annotations stay visible.

### Annotation and Review

Lightweight, non-destructive tools: highlight, circle, draw simple lines and arrows, add text comments and floating notes, and toggle annotation layers. Earlier artwork versions can be kept for review. There are no painting or drawing tools.

### Tags and Search

- **Unique tags** for one-off use, and **reusable tags** stored in a project tag library.
- Advanced search that matches all or any of the selected tags, combines filters, and filters by type across the whole project.
- Tags handle character, artwork, and production tracking. There's no mandatory tracking database.

### Navigation

- **Hybrid table of contents.** Entries can be generated automatically or made by hand, and can link to board locations, named anchors, objects, nested boards, documents, headings, page collections, and specific pages.
- **Named anchors** mark specific locations on a canvas.
- **Pinned items** give quick access to boards, documents, images, tables of contents, and board locations in a collapsible panel.

### Collaboration

- Projects are private by default. You can invite collaborators to specific projects with view, comment, or edit permissions.
- **Single-editor model.** One person edits a given item at a time while others can view it. Conflicts and interrupted sessions are handled safely. There's no real-time co-authoring.

### Appearance

- Custom covers for boards, documents, files, and collections, without modifying the original files.
- Custom font import (TTF and OTF). Licensing and portability still need review.

### Capture and Productivity

- Paste images from a browser, drag files in from File Explorer, and paste URLs to create link cards.
- Import directly into library folders without creating canvas objects.
- Keyboard shortcuts and a searchable command menu.

### History, Recovery, and Quality of Life

- Undo and redo, board snapshots, and a trash area for recovering deleted content.
- Automatic saving with a visible save status, protection against data loss, and backup planning.
- A clear difference between removing an object from a board and deleting its file.
- Storage usage information and file-size warnings.
- Keyboard navigation and reasonable accessibility support.
- Project-wide search across board names, notes, file names, document text, tags, and metadata.

### Optional: Plot Roadmaps

Lower priority. A visual map of plot-event cards with branching, converging, and merging storylines, likely built from existing board objects and connection tools.

---

## Out of Scope

- A mobile app
- A full illustration or painting program, or advanced image editing
- Cropping or reshaping artwork
- A full Word-style document editor
- Live AI assistants or AI generation
- Simultaneous co-editing of the same item
- Advanced window docking and management
- Mandatory manga templates, character databases, or production tracking

---

## Decisions (Tech Stack)

The open questions from the spec (§23) have been answered. The full reasoning, with pros and cons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

| Area | Choice |
|---|---|
| Desktop shell | Electron (electron-vite, electron-builder) |
| UI | React 19 + TypeScript, Zustand, Tailwind CSS v4, Radix UI, cmdk |
| Canvas | Konva via react-konva |
| Database | One SQLite file per project: better-sqlite3 + Drizzle ORM (FTS5 for search) |
| Files | Originals copied into the project, content-addressed (SHA-256), never modified |
| Text notes | Tiptap (ProseMirror) editor, drawn on the canvas by Konva |
| Images / PDF | sharp (thumbnails, metadata), pdf.js (viewer, search, outline) |
| Cloud (later, for collaboration only) | Supabase (Postgres, Auth, Realtime) + Cloudflare R2 |

**Local-first.** Everything in the MVP runs on your own computer, with no server, account or internet connection needed. A project is a folder you can keep anywhere, including a OneDrive or Dropbox folder for backup. A cloud backend is added only when shared projects (collaboration) are built.

Still open: detailed interface styling, custom fonts, and preview generation for PSD, `.clip` and `.procreate` files.

---

## Roadmap

Spec stages 1–4 (inventory, feasibility, scope, architecture) are **done**. Stage 5, MVP development, is next. The detailed checklist is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

**MVP priorities:**

1. ~~**M0 — Scaffold.** Electron + React app, database, project create/open.~~ ✅ Done
2. ~~**M1 — Nested boards and folders** (§3).~~ ✅ Done
3. ~~**M2 — Canvas navigation and manipulation** (§4).~~ ✅ Done
4. **M3 — Board objects** (§5, §7): ~~M3A images (JPEG/JPG, PNG, WebP)~~ ✅ Done; ~~M3B rich text notes~~ ✅ Done; ~~M3C PDFs and file cards~~ ✅ Done. (Board covers moved to later.)
5. ~~**M4 — Project asset library** (§8).~~ ✅ Done.
6. ~~**M5 — Reliability polish.** Autosave status, recovery points, command palette, search.~~ ✅ Done. The packaged Windows install still needs a manual check (see `docs/TESTING.md`).

## Running Locally

You need **Git** and **Node.js 22.12+** (24 LTS recommended). Everything else installs with npm. Step-by-step instructions for Windows and macOS, every command, the dependency list and troubleshooting are in **[`docs/SETUP.md`](docs/SETUP.md)**.

```bash
git clone https://github.com/hooperart12-cyber/Creative-Workspace-App.git
cd Creative-Workspace-App
npm install
npm run dev        # opens the desktop app with hot reload
```

Other useful commands: `npm test` (unit), `npm run test:e2e` (end-to-end UI), `npm run typecheck`, `npm run lint`, and `npm run build:win` (Windows installer; CI also builds one on every push to `main`).

---

**The goal:** a flexible, PC-based visual creative workspace that can organize an entire artistic project, from early ideas and reference gathering to scripts, finished artwork, and collaborative review, without requiring a rigid workflow.
