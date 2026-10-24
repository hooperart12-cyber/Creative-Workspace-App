# Architecture Decision Log

Each decision is recorded as a short ADR (Architecture Decision Record). **Never rewrite an accepted ADR.** If a decision changes, add a new ADR that supersedes the old one and update the status line on the old one.

Statuses: ✅ Accepted · 🟡 Tentative (will be confirmed when the feature is built) · ⛔ Superseded

| ADR | Title | Status |
|---|---|---|
| [001](#adr-001--desktop-framework-electron) | Desktop framework: Electron | ✅ |
| [002](#adr-002--language-and-ui-stack-typescript--react) | Language & UI stack: TypeScript + React | ✅ |
| [003](#adr-003--canvas-engine-react-konva) | Canvas engine: react-konva | ✅ |
| [004](#adr-004--database-one-sqlite-database-per-project) | Database: one SQLite database per project | ✅ |
| [005](#adr-005--asset-storage-copy-in-content-addressed) | Asset storage: copy-in, content-addressed | ✅ |
| [006](#adr-006--local-first-now-hybrid-cloud-later) | Local-first now, hybrid cloud later | ✅ (provider choice 🟡) |
| [007](#adr-007--v1-file-formats-jpegjpg-png-pdf) | v1 file formats: JPEG/JPG, PNG, PDF | ✅ |
| [008](#adr-008--mvp-scope-and-build-order) | MVP scope and build order | ✅ |
| [009](#adr-009--saving-backup-and-recovery) | Saving, backup and recovery | ✅ |
| [010](#adr-010--m0-toolchain-versions-and-implementation-choices) | M0 toolchain versions & implementation choices | ✅ |
| [011](#adr-011--boards-and-folders-are-separate-hierarchies) | Boards and folders are separate hierarchies | 🟡 Pending team discussion |
| [012](#adr-012--canvas-interaction-model-and-undo) | Canvas interaction model and undo | ✅ |

---

## ADR-001 — Desktop framework: Electron

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §2, §21, §23

**Context.** The app is a PC desktop application (§2). The team is most comfortable with React. It must be easy to run locally and support multiple windows, native file access and large image files.

**Decision.** Use **Electron**, scaffolded with **electron-vite** and packaged with **electron-builder**. Development can happen on macOS or Windows; release builds target a Windows installer.

| Option | Pros | Cons |
|---|---|---|
| **Electron** ✅ | Everything is JS/TS, so React skills carry over. The Node.js main process gives native SQLite, `sharp` image processing and full file-system access. Multi-window is built in (`BrowserWindow`). Huge ecosystem and documentation, which suits AI-assisted coding. `npm run dev` runs locally. | Larger installer (~100–150 MB) and higher memory use than native apps. |
| Tauri 2 | Tiny binaries, low memory, strong security model. | Backend is Rust, a second language. Fewer turnkey JS libraries for images and SQLite on the backend. Rendering engine (WebView2) varies by machine. |
| Plain web app | No installer; easy to share. | Spec requires a desktop app. Browser file access is limited, multi-window is awkward, and hosting is needed from day one. |
| Native (C#/WPF, Qt) | Best raw performance. | Doesn't use React skills; slower UI iteration. |

**Consequences.** The app has two halves: the **main process** (Node.js) and **renderer processes** (React UI, one per window). They talk over typed IPC. The main process acts as the app's local backend (see ADR-006).

---

## ADR-002 — Language and UI stack: TypeScript + React

**Date:** 2026-10-24 · **Status:** ✅ Accepted (versions amended by [ADR-010](#adr-010--m0-toolchain-versions-and-implementation-choices)) · **Requirements:** §19, §23

**Decision.**
- **TypeScript** everywhere (main process, preload, renderer).
- **React 18** + **Vite** (via electron-vite).
- **Zustand** for UI and canvas state. It is small, has no boilerplate and works well with frequent canvas updates.
- **Tailwind CSS** + **Radix UI** primitives for panels, menus, dialogs and context menus.
- **cmdk** for the command palette (§19).
- **Vitest** for unit tests; **Playwright** (Electron mode) for end-to-end smoke tests.

| Choice | Pros | Cons | Alternatives considered |
|---|---|---|---|
| TypeScript | Catches bugs early; shared types across IPC; helps AI tools generate correct code. | Slight setup overhead. | Plain JS (rejected: too error-prone at this size). |
| Zustand | Minimal API; selectors avoid unnecessary re-renders; easy undo/redo integration. | Less structure than Redux for very large teams. | Redux Toolkit (more boilerplate), Jotai (fine, but less obvious for undo stacks). |
| Tailwind + Radix | Fast styling; accessible, unstyled primitives (keyboard support, §21). | Tailwind class lists can get long. | MUI or Chakra (heavier, opinionated look; harder to make it feel like Milanote). |

---

## ADR-003 — Canvas engine: react-konva

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §4, §5, §23 (performance)

**Context.** §4 (navigation and object manipulation) is a top priority. The canvas must handle many large images, with rotation, resizing, layering, grouping, alignment and snapping. **Figma** is the UX reference for canvas interaction.

**Decision.** Use **Konva** via **react-konva**.

| Option | Pros | Cons |
|---|---|---|
| **react-konva** ✅ | MIT license, free forever. Built-in Transformer (resize and rotate handles, aspect-ratio lock), dragging, z-order, groups, hit detection and layer caching. React-friendly. Draws to `<canvas>`, so it scales to hundreds of images. | We write marquee selection, smart guides/snapping, align/distribute and undo/redo ourselves. All are well-understood problems. |
| tldraw SDK | Most canvas features come built in. | Production use needs a paid license or shows a watermark. Its data model is opinionated and harder to fit our asset/board schema. |
| Plain DOM + CSS transforms | Simplest mental model; text editing is easy. | Performance degrades with many large images; we build everything ourselves. |
| PixiJS (WebGL) | Fastest rendering. | Lower-level; no built-in transform handles or text editing. Overkill for now. |

**Performance strategy (§23 large boards):**
- Render **thumbnails by zoom level** (e.g. 256 / 1024 px / original), generated by `sharp` in the main process.
- **Viewport culling:** only render objects inside the visible area plus a margin.
- Konva **layer caching** for static content; separate layers for selection and guides.
- **Lazy board loading:** a nested board's objects are loaded only when that board is opened.

**Text editing note.** Rich text inside Konva is limited. Text notes will show a DOM `contenteditable` (or a small TipTap editor) overlay while editing, then render as a Konva shape. This is the standard approach.

---

## ADR-004 — Database: one SQLite database per project

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §3, §8, §12, §20, §21, §23

**Context.** Projects must be independent (§3). The app must work fully offline. Collaboration (§15) may come later.

**Decision.** Each project has its own **SQLite** file (`project.db`), accessed from the main process with **better-sqlite3** and **Drizzle ORM** (typed schema + migrations). Project-wide search uses SQLite **FTS5**. A small app-level store in Electron's `userData` folder (recent projects, window positions, preferences) is kept separate.

| Option | Pros | Cons |
|---|---|---|
| **SQLite per project** ✅ | Zero setup, offline, very fast, a single portable file, transactions protect against corruption, FTS5 full-text search built in. Matches "independent projects". | Can't be shared live by itself; collaboration needs a server later. |
| Cloud DB only (Supabase/Postgres, Firebase) | Sharing and multi-device sync built in. | Needs internet; costs money; accounts required from day one; slow local development; large art files are expensive to host. |
| Hybrid (local SQLite + cloud Postgres mirror) | Best of both: fast offline use and sharing when needed. | Sync code is real work. **This is the planned future state** (ADR-006), not the starting point. |
| JSON files per board | Very simple. | No transactions, poor search, and corruption risk on crash. |

**Cloud-ready schema rules (mandatory):**
- **UUID** primary keys (never auto-increment integers).
- `created_at`, `updated_at` on every row; `deleted_at` for soft delete. Soft delete also powers Trash (§20/§21).
- Assets identified by **SHA-256 content hash**.
- **All writes go through one repository/service layer** in the main process, never ad-hoc SQL in the UI. A sync adapter can then hook in later.

**Initial tables (draft, refined in M0/M1):** `project_meta`, `folders` (tree, `parent_id`), `boards` (tree via `parent_board_id`, `cover_asset_id`), `board_objects` (`board_id`, `type`, `x`, `y`, `width`, `height`, `rotation`, `z_index`, `locked`, `group_id`, `asset_id?`, `linked_board_id?`, `data` JSON), `assets` (`id`, `sha256`, `original_name`, `mime`, `ext`, `bytes`, `width`, `height`, `has_alpha`, `folder_id`, `imported_at`), `tags`, `object_tags`, `asset_tags`, and an `fts_index` virtual table.

---

## ADR-005 — Asset storage: copy-in, content-addressed

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §7, §8, §18, §21

**Decision.** When a file is imported (drag-and-drop, paste, file picker, folder import), the app **copies the original, byte-for-byte**, into the project folder. The copy is named by its SHA-256 hash and **never modified**.

```
MyProject.cwproj/
  project.db                 # SQLite database
  assets/ab/abcd…ef.jpg      # originals, named by SHA-256 (first 2 chars = subfolder)
  thumbs/abcd…ef_256.webp    # generated previews (safe to delete and regenerate)
  thumbs/abcd…ef_1024.webp
  backups/                   # rolling database snapshots
```

| Option | Pros | Cons |
|---|---|---|
| **Copy into project** ✅ | References never break; the project is portable (copy one folder); backup and cloud sync are simple; identical files are deduplicated automatically. | Uses extra disk space (one copy per project). |
| Link in place | No duplicate disk usage. | Moving or renaming a file outside the app breaks the board; projects aren't portable; cloud sync is much harder. |

**Consequences.**
- Library "folders" (§8) exist **only in the database**. Moving an asset between folders never touches the file, so references never break.
- One asset → many board appearances (`board_objects.asset_id`). Removing an appearance never deletes the asset. Deleting an asset checks references first and warns the user (§8).
- The original file name is kept in metadata, and "Download original" exports it under that name.

---

## ADR-006 — Local-first now, hybrid cloud later

**Date:** 2026-10-24 · **Status:** ✅ Accepted (cloud provider choice 🟡 Tentative) · **Requirements:** §8, §15, §23

**What "local" means.** All project data lives on the user's own computer, in a project folder they choose. That folder can be on an internal drive, an external drive, a network drive, or a folder synced by OneDrive, Dropbox or Google Drive (which gives free off-machine backup). No server, account or internet connection is needed. Limits: only one machine should have a project open at a time, and there are no live collaborators.

**Is there a backend?** Not a separate server in the local phase. **Electron's main process is the local backend.** It owns the database and files, generates thumbnails and serves data to the UI windows over IPC. The UI never touches the disk or database directly, and that boundary is where a cloud backend plugs in later.

**What runs locally vs. what needs the cloud:**

| Requirement | Local only? |
|---|---|
| §2 Multi-window | ✅ Main process broadcasts changes to all windows |
| §3 Projects, folders, nested boards | ✅ |
| §4 Canvas navigation & manipulation | ✅ |
| §5 Object types | ✅ |
| §6 / §7 PDF, JPG, PNG viewing | ✅ (pdf.js, sharp) |
| §8 Asset library, mass import, reuse | ✅ |
| §9–14 Stacks, collections, annotations, tags, TOC, pins | ✅ |
| §19–21 Shortcuts, undo, trash, autosave, search, backups | ✅ |
| **§15 Collaboration / shared projects** | ❌ **Needs cloud** (accounts, invites, permissions, edit locks, shared file hosting) |
| Multi-device sync for one user | ❌ Needs cloud (or a synced folder, used carefully) |
| Automatic off-machine backup | ⚠️ A synced folder covers this; cloud optional |

**Future hybrid design (when §15 starts):**
- **Supabase** (managed Postgres + Auth + Realtime + Edge Functions) for shared project metadata, user accounts, permissions and the **single-editor lock model**: each object or document gets a short-lived "editing lease" row, with a heartbeat to recover interrupted sessions.
- **Cloudflare R2** for asset files (S3-compatible, **no egress fees**, which matters for large art files). Supabase Storage is an alternative if one vendor is preferred.
- Local SQLite stays the working copy; shared projects sync changed rows (`updated_at`) and upload or download assets by hash.
- We don't write or host our own server unless requirements outgrow Supabase.

| Approach | Pros | Cons |
|---|---|---|
| **Local only** (now) | $0, offline, fastest to build, private by default. | No collaboration or automatic multi-device sync. |
| Cloud only | Sharing everywhere; data accessible on any machine. | Requires internet and accounts; monthly cost; big upfront backend work; slower. |
| **Hybrid** (later) | Offline speed plus optional sharing; cloud costs only for shared projects. | Sync logic to build and test. |

**Estimated costs:** $0 while local-only. Later: Supabase Free/Pro ($0–25/month) + R2 at roughly $0.015 per GB-month of storage with free egress.

---

## ADR-007 — v1 file formats: JPEG/JPG, PNG, PDF

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §6, §7, §23

**Decision.**
- **Images (v1):** JPEG/JPG and PNG, rendered natively by Chromium. Transparency is preserved. Dimensions and alpha are read with `sharp`. WebP is a cheap add-on.
- **Documents (v1):** PDF via **pdf.js** (`pdfjs-dist`), which provides page rendering, thumbnails/covers, text search and outline (table of contents) navigation, all offline.
- **Any other file type** can still be **stored** in the library (preservation), shown as a generic file card, with the option to attach a manual preview image (§7).

**Later:**
- TIFF via `sharp`.
- PSD via `ag-psd` (composite image).
- `.procreate` (zip with an embedded `QuickLook/Thumbnail.png`).
- `.clip` (contains an embedded SQLite database with a canvas preview).
- DOCX read-only via `mammoth`; MD/TXT.

---

## ADR-008 — MVP scope and build order

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §23, §24

**Priorities set by the project owner:**
1. **§3** Nested boards and folders.
2. **§4** Canvas flexibility, manipulation and navigation (more important than literal infinity).
3. **§5** Object types, **images first**. Checklists, headers/dividers and containers are deprioritized.
4. **§7** JPEG/JPG and PDF first (PNG comes free); non-standard formats are deprioritized.
5. **§8** Project asset libraries.

**UX references:** **Milanote** for boards and organization, **Figma** for canvas interaction. When a detail is unspecified, follow them.

**Build order:** M0 Scaffold → M1 Structure (§3) → M2 Canvas (§4) → M3 Images, text, PDF (§5/§7) → M4 Asset library (§8) → M5 Reliability polish (§19–21). Details in [`ROADMAP.md`](ROADMAP.md).

**Process rule:** **plan first, then build.** Each milestone starts with a short written plan that the project owner confirms before coding.

---

## ADR-009 — Saving, backup and recovery

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §20, §21

**Decision.**
- **Autosave:** every change is written to SQLite in a transaction (debounced ~300–500 ms during drags). There is no "Save" button; a visible status shows "Saving… / Saved".
- **SQLite WAL mode** for crash safety.
- **Rolling backups:** on project open and every N minutes, the app copies `project.db` (using SQLite's online backup API) into `backups/`, keeping the last ~10. Assets don't need backups because they are immutable.
- **Undo/redo:** an in-memory command stack per board in the renderer.
- **Trash:** soft-deleted rows (`deleted_at`) shown in a Trash view, restorable, and purged after confirmation.
- **Export:** "Export project as .zip" for manual backups or moving to another PC.

---

## ADR-010 — M0 toolchain versions and implementation choices

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Amends:** ADR-002 (versions only)

**Context.** These choices came up while building the M0 scaffold. The stack itself is unchanged.

**Decisions.**

- **React 19** instead of 18. 19 is the current stable release; nothing in our stack requires 18.
- **TypeScript 6.0** (pinned `~6.0`). TypeScript 7 exists, but `typescript-eslint` doesn't support it yet. Upgrade once it does.
- **Tailwind CSS v4** via `@tailwindcss/vite`. Design tokens (colors, font) live in `src/renderer/src/styles.css` under `@theme`.
- **Radix UI and cmdk are added when first needed** (M1 and M5), not up front, to keep the dependency list honest.
- **Tests run inside Electron's Node** (`ELECTRON_RUN_AS_NODE`, see `scripts/run-tests.mjs`). `better-sqlite3` is a native module compiled for one runtime; running tests in Electron means a single build works for both the app and the tests, and the tests cover the exact runtime we ship.
- **Project logic must not import `electron`.** `src/main/project/*` and `src/main/db/*` are plain Node, so they can be unit-tested. Electron-specific code (windows, dialogs, IPC) lives in `src/main/index.ts`, `windows.ts` and `ipc.ts`.
- **Typed IPC contract** in `src/shared/ipc.ts`. The renderer can only call channels listed there (the preload script enforces an allow-list).
- **Window security:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict Content-Security-Policy, external links open in the system browser, and in-app navigation is blocked.
- **Multi-window model:** a `ProjectRegistry` in the main process shares one database connection per open project across all windows showing it. Changes are broadcast to those windows (`project:changed`), and the connection closes when the last window releases it. A single-instance lock prevents two app processes from opening the same database.
- **Migrations** are generated by `drizzle-kit` into `drizzle/` (committed), run automatically when a project opens, and shipped as `extraResources` in the installer.
- **Windows installers are built by CI on a Windows runner** (GitHub Actions), because building native modules for Windows from macOS is unreliable.

---

## ADR-011 — Boards and folders are separate hierarchies

**Date:** 2026-10-24 · **Status:** 🟡 Tentative, **pending team discussion** (we may return to the unified tree) · **Requirements:** §3, §8, §13

**Context.** §3 asks for both "traditional folders" and "visual nested boards", but doesn't say whether boards can live inside folders.

**Decision (for now): Separate.**
- **Boards** nest only inside other boards (Milanote model). A nested board appears as a card on its parent board, and the sidebar shows the board hierarchy as one tree.
- **Folders** are the project's **file library** (§8): they hold assets (images, PDFs, other files), shown as a second sidebar tree.
- An asset lives in exactly one library folder but can appear as a card on many boards (ADR-005).
- To group boards without a visual layout, use a board that contains only board cards. It works like a folder.

| Option | Pros | Cons |
|---|---|---|
| **Separate** ✅ (tentative) | Every item has exactly one home (a board's home is where its card is). Matches §8 (folders = asset library) and §13 (sidebar navigates nested boards). Simpler rules, less to build and test. | Two trees in the sidebar. You can't file a board next to the PDFs and images in a folder. |
| Unified tree | Familiar Windows Explorer model; folders can hold boards and files together. | A board could have two parents (a folder and the board its card sits on). Needs rules for moving cards between boards while filed in a folder, and is harder to explain and build. |

**Keeping the door open.** Switching to Unified later is additive: add an optional `folder_id` to `boards` and show boards in the folder tree. No existing data would need restructuring. Going from Unified back to Separate would be much harder, which is another reason to start here.

**Next step:** discuss with the team before M4 (asset library), when folders get their real content.

---

## ADR-012 — Canvas interaction model and undo

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §4, §19, §20

**Decisions.**
- **Figma-style navigation.**
  - The wheel or two-finger scroll **pans**.
  - Ctrl/Cmd+wheel or pinch **zooms toward the cursor**.
  - Space+drag and middle-drag pan.
  - Shift+1 / Shift+2 fit all / fit the selection; Ctrl+0 goes to 100%.
  - Zoom range 5%–800%.
- **Camera per board, per window.** Each window has its own camera (§2). Each board's last camera is saved in `boards.viewport_*` (not broadcast), and boards never viewed fit their content on first open.
- **One pointer state machine** (pan / drag / marquee) instead of Konva's built-in dragging. This gives full control over multi-select drags, snapping and drop targets. Resizing uses Konva's `Transformer`.
- **Snapping.** Smart guides by default: edges and centres within 6 screen px. An optional snap-to-grid (20 world units) replaces the guides. Holding **Alt** disables snapping. The visible grid is display-only.
- **Drop to nest (Milanote-style).** Dropping cards on a board card, a breadcrumb item or a sidebar row moves them into that board. DOM drop targets are marked with `data-drop-board-id`.
- **New boards never cover existing content.** "Board" clicks place the card at the view centre and shift it right until there's room. This prevents accidental nesting when dragging overlapping cards.
- **Clipboard.** It lives in the main process (shared by all windows) and holds object ids only.
  - **Copy** of a board card deep-copies the board and everything inside it, sharing assets (ADR-005).
  - **Cut** is Explorer-style: items fade and are *moved* on paste, so nothing is lost if you never paste.
- **Delete on the canvas has no confirmation dialog**, because every action is undoable. The sidebar "Move to trash" keeps its dialog.
- **Undo/redo** is a per-window command stack (`src/renderer/src/canvas/history.ts`). Every edit goes through `canvas/actions.ts`, which records how to undo and redo it. Trash undo uses `objects:restore`, which restores everything trashed in the same operation (matched by a strictly increasing deletion timestamp).
- **Optimistic updates.** Moves and resizes update the screen immediately, then save. Other windows refresh from the broadcast.
- **App menu.** Electron's default menu is replaced: no page zoom (it would scale the whole UI) and no Reload in packaged builds. Edit roles stay for text fields.
- **Test hook.** `window.__cw` exposes the stores read-only, because the canvas draws to `<canvas>` and end-to-end tests need object positions.
