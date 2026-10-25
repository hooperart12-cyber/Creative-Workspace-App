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
| [013](#adr-013--images-import-pipeline-display-and-rotation) | Images: import pipeline, display and rotation | ✅ |
| [014](#adr-014--rich-text-notes-editor-display-saving-and-multiple-windows) | Rich text notes: editor, display, saving and multiple windows | ✅ |
| [015](#adr-015--pdfs-and-generic-file-cards) | PDFs and generic file cards | ✅ |

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

**Date:** 2026-10-24 · **Status:** ✅ Accepted (WebP added by [ADR-013](#adr-013--images-import-pipeline-display-and-rotation); PDFs and other files are stored and shown as in [ADR-015](#adr-015--pdfs-and-generic-file-cards)) · **Requirements:** §6, §7, §23

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

**Date:** 2026-10-24 · **Status:** ✅ Accepted (clipboard and rotation extended by [ADR-013](#adr-013--images-import-pipeline-display-and-rotation); undo while typing by [ADR-014](#adr-014--rich-text-notes-editor-display-saving-and-multiple-windows)) · **Requirements:** §4, §19, §20

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

---

## ADR-013 — Images: import pipeline, display and rotation

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §4, §5, §7, §8, §18, §23 · **Amends:** ADR-007 (adds WebP) · **Extends:** ADR-012 (clipboard, rotation)

**Context.** M3A puts images on boards. The project owner's conditions: never modify or recompress imported artwork; keep transparency and proportions under every resize and alignment; large images must not freeze the UI; M2 behaviour, undo and multi-window must keep working; the asset code must suit the M4 library.

**Decisions.**

- **Import pipeline** (main process, `src/main/project/assets.ts`):
  1. Stream the source into `assets/.incoming/<uuid>` while hashing it (SHA-256). The source is only read.
  2. Check the content with `sharp` metadata: the file must really be JPEG, PNG or WebP, whatever its extension. Read the size (EXIF orientation applied) and whether it has alpha.
  3. Rename into `assets/<sha[0..2]>/<sha>.<ext>`, retrying briefly if OneDrive or antivirus has the file locked. An identical file already stored is reused (deduplication by hash; a trashed asset is restored).
  4. Generate thumbnails. Clean up the temporary file whatever happens.

  Up to 3 files import at a time. Files that can't be imported are skipped and listed with a reason, and the rest still import.
- **The original is never written to after step 3.** Copies on boards, duplicates and pastes share the asset (ADR-005). "Download original" copies the stored file byte-for-byte.
- **Formats:** JPEG, PNG and WebP. Anything else gets a clear message for now; generic file cards come in M3C.
- **Thumbnails:** WebP, 256 and 1024 px on the longest side, only when smaller than the original, EXIF orientation applied, alpha kept (`alphaQuality: 100`). They live in `thumbs/`, are regenerated on demand if missing, and are safe to delete.
- **Serving files to the UI:** a privileged `cw-asset://<projectId>/<sha256>/<256|1024|original>` protocol handled in the main process. It accepts only a 64-character hash belonging to that project, never a path, and sends immutable cache headers. The CSP allows `img-src cw-asset:`.
- **Level of detail and performance:** the canvas draws the smallest stored version that covers the image's on-screen size in device pixels, and keeps the previous version visible while the next one loads. Images decode off the main thread (`img.decode()`). A shared cache keeps up to ~256 MB of decoded images that are off screen, and viewport culling (ADR-003) still applies.
- **Image objects:** `board_objects.type = 'image'` with `asset_id`.
  - **Size:** new images are at most 800 canvas units on their longest side (smaller images keep 1 px = 1 unit). There is no maximum display size.
  - **Proportions are enforced in the main process.** `objects:update` recomputes an image's height from its width and the asset's ratio, so no code path (handles, match size, a future feature) can distort an image. The smallest allowed size is 24 units on the longest side.
  - **Handles:** with an image selected, the resize handles are corner-only and proportional (Konva `keepRatio`).
- **Rotation:** degrees in `board_objects.rotation`, around the object's top-left corner (Konva's native origin), stored normalised to −180…180.
  - Shift snaps to 15° (Konva's built-in behaviour). Board cards don't rotate. "Reset rotation" straightens an image around its centre.
  - Culling, marquee, snapping, fit, align, distribute, free-space placement and drop targets all use the rotated bounding box (`src/shared/geometry.ts`).
- **Placement:** on the open board only; dropping into nested boards comes later.
  - Drops and "Paste here" centre on the pointer. The toolbar and Ctrl+V centre in the view, shifted right until clear of existing content.
  - Several images are laid out in a grid with 24-unit gaps, and adding them is one undoable step.
  - Assets go to the library's top level (`folder_id = null`) until M4. The import API already accepts a folder id.
- **Clipboard (extends ADR-012):** copying objects in the app also writes a short note ("N items copied in Creative Workspace") to the system clipboard. Paste checks for that note:
  - If the note is still there, the app's own objects are pasted.
  - Otherwise the main process reads the system clipboard: file URLs first (`text/uri-list`, which is how File Explorer and Finder copy files), then a PNG, JPEG or WebP bitmap (screenshots, images copied in browsers), imported as "Pasted image <date and time>.png".
  - Reads are retried for up to ~0.5 s while the clipboard comes back empty, because Windows clipboard history and clipboard managers briefly lock it after a copy.
- **Drag and drop:** files dropped from File Explorer are imported by path (`webUtils.getPathForFile` in the preload). Items with no path, such as an image dragged out of a browser, are sent as bytes.
- **Full-size viewer:** a DOM dialog showing the original file, with the 1024 px thumbnail underneath while the original loads.
  - Zoom: wheel zooms toward the cursor (2%–3200%). Fit to window (the default), 100%, and drag to pan.
  - ←/→ step through the images on the board.
  - Pixels are drawn crisp from 200% upward, and a checkerboard shows transparency.
  - "Download original" saves an exact copy.
- **Packaging:** `sharp` and `@img/*` are unpacked from the asar (native library).

| Choice | Pros | Cons | Alternatives considered |
|---|---|---|---|
| Custom `cw-asset://` protocol ✅ | No file paths in the renderer; browser caching; the renderer can only request hashes of its own project's assets. | A little protocol code. | `file://` URLs (expose paths and need a weaker CSP); IPC with base64 (slow, doubles memory). |
| Thumbnails with `sharp` in main ✅ | Fast, high quality, off the UI thread; handles EXIF and alpha. | Native dependency (~10 MB). | Renderer canvas resizing (blocks the UI, lower quality). |
| Proportions enforced in main ✅ | One rule protects every path that resizes images. | Main must know which objects are images (a join on `assets`). | UI-only locking (any new code path could distort images). |
| Rotation around top-left ✅ | Konva's native model: no offsets to convert; existing x/y stay valid. | Layout maths needs rotated bounds. | Rotation around the centre (needs offset conversions everywhere). |
| Clipboard note on the system clipboard ✅ | "Copy in a browser, paste in the app" just works after copying in the app; no stale internal paste. | Copying in the app replaces the system clipboard text. | Always preferring the internal clipboard (pastes old objects instead of the new screenshot). |

**Consequences.**
- The M4 library can reuse `AssetRepository`, `ImportOptions.folderId`, `AssetInfo`, `cw-asset://` URLs and the thumbnails.
- The same pipeline will serve PDFs (M3C), with a page render as the cover.
- Projects gain a `thumbs/` folder that can be deleted and regenerated at any time.

---

## ADR-014 — Rich text notes: editor, display, saving and multiple windows

**Date:** 2026-10-24 · **Status:** ✅ Accepted · **Requirements:** §4, §5, §17, §19, §20, §21 · **Extends:** ADR-012 (undo while typing), ADR-013 (rotation)

**Context.** M3B adds text notes for character bios, worldbuilding and brainstorming. The project owner's conditions:
- A note is a full canvas object: move, resize, rotate, layers, copy, delete, undo, group, align, multiple windows.
- Rich formatting edited directly on the canvas, plus a larger editor for long text.
- Writing is never lost: autosave with a visible status, no out-of-order saves, and no silent overwrites between windows.
- Pasting is safe, and letters are never stretched.
- Excluded for now: images, tables and checklists inside notes, custom font import, and board covers (moved to later).

**Decisions.**

- **Stored as `board_objects.type = 'text'`.** `data` holds:
  - `content`: `{ schemaVersion: 1, doc }`, a ProseMirror JSON document.
  - `plainText`: a plain copy of the text, kept for search (M5).
  - `appearance`: card or floating, background, opacity, border, corners, padding and shadow.
  - `sizing`: `auto` or `fixed`.

  A new `revision` column (migration `0001_note_revision`) counts content saves.
  - The main process checks every document against an allow-list of nodes, marks and attributes before saving. That covers colours, links (http, https and mailto only) and sizes. Documents over 512 KB are refused.
  - A note that can't be read (damaged, or from a newer version) is drawn as a placeholder, and the rest of the board works normally.
- **Editor: Tiptap 3 (ProseMirror).**
  - One editor per window, for the note being edited. The inline editor and the expanded editor show the same instance, so switching keeps the cursor and the typing history.
  - Content allowed:
    - Paragraphs, headings 1–3, bulleted and numbered lists, and line breaks.
    - Bold, italic, underline, strikethrough and links.
    - Text colour, highlight, font and size.
    - Alignment, line spacing and space after a paragraph.
- **Display: the browser lays out the text and Konva paints it.**
  - Each note is rendered into a hidden copy of the editor's DOM, with the same CSS and width. The app reads back every line and run of text and draws exactly that on the canvas.
  - So the canvas and the editor break lines in the same places, and nothing jumps when editing starts.
  - Baselines snap to pixels the way Chromium does.
  - Layouts are cached per note and width. Text smaller than about 3.5 screen px is drawn as grey bars ("greeking").
- **Inline editing** places the editor over the note's drawing with one CSS transform that matches the camera (translate, rotate about the top-left corner, scale by zoom).
  - Starting to edit:
    - Double-click a note (the cursor goes where you clicked), or press Enter on a selected note.
    - To make a new note: press `T`, use the **Text** tool, choose "New text here", or double-click empty canvas.
    - Editing below 50% zoom first zooms to 100% around the note.
    - Locked notes can't be edited.
  - Clicking outside or pressing Esc finishes. A new note left empty disappears again.
  - While typing, no key reaches the canvas: Ctrl+A selects text, Delete deletes characters, `T` types a T. The browser's own attempts to scroll the canvas to show the cursor become camera moves.
- **Undo.**
  - While typing, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z undo and redo typing (the canvas undo buttons are off).
  - When editing ends, the whole session becomes one canvas step: "Edit text", or "Add note" for a new note.
  - Undoing a text step is skipped, with a message, if another window changed the note since.
  - Style changes (panel, menus, reset) are canvas steps right away.
- **Appearance and sizing.**
  - **Card** and **floating text** use the same box metrics, so switching never moves the text. "Reset appearance" restores the default card.
  - **Auto height** (the default): the height follows the text, and only the width can be resized (side handles).
  - **Fixed height**: corner handles too. Extra text scrolls inside the note: the mouse wheel over a selected fixed note scrolls its text, not the canvas. "Fit to content" makes the height match the text.
  - Resizing reflows the text and never scales it. The minimum size is 80 × 40.
  - Rotation works like images (ADR-013).
- **Saving.**
  - Autosave runs 600 ms after typing pauses, and at least every 3 s while typing continues.
  - One save runs at a time, in the same queue as canvas edits, so saves can't arrive out of order and a canvas action never overtakes a pending save.
  - Each save names the revision it started from. If another window saved first, nothing is overwritten.
  - A per-note badge shows "Saving… / Saved / Couldn't save".
  - Failed saves retry with backoff (up to every 15 s). The note stays open until the text is saved or the user chooses.
  - Closing a window waits up to 4 s for open notes to save.
  - Opening another board finishes editing first. If the board is gone, unsaved text is kept as a new note.
- **Multiple windows.**
  - Saves refresh only that note in other windows (`objects:changed`).
  - The main process keeps an in-memory "lease" per note being edited. Other windows show "✎ Editing in another window", and editing there offers **Edit here instead**: the first window saves what it has (the main process waits up to 3 s) and becomes read-only.
  - If a save is refused because the note changed elsewhere, the user chooses **Keep mine**, **Use theirs** or **Keep both** (theirs stays; mine becomes a new note).
  - If the note is moved to the trash elsewhere while being edited, the text stays on screen with **Keep my text as a new note** or **Discard**.
- **Fonts.** Four open-licence (SIL OFL) fonts ship with the app via `@fontsource`: Inter (default), Lora, JetBrains Mono and Caveat. Fonts installed on the computer can also be chosen, through the Local Font Access API. They're labelled as possibly looking different on another computer, because the name is stored, not the font. Sizes run from 10 to 96.
- **Links.** Only web and email addresses. A plain click never opens a link. Ctrl/Cmd+click opens it, in the editor or on the canvas. The main process checks the address again before `shell.openExternal`.
- **Paste.**
  - HTML is cleaned with DOMPurify. From other programs, emphasis, headings, lists, links and alignment are kept; their colours and fonts are dropped. Text copied from another note keeps all its formatting.
  - Ctrl+Shift+V pastes plain text.
  - Images are never put inside notes. The user is told to paste them on the canvas instead.
  - Paste on the canvas stays images and files only: pasting text there doesn't create a note.
- **Two toolbars.**
  - A quick bar above the note: text style, B/I/U/S, highlight, lists, link, the advanced panel, expand, and the save badge.
  - An advanced panel with **Selected text** (font, size, colour, highlight, clear formatting, alignment, line and paragraph spacing) and **Whole note** (card or floating, background, opacity, border, corners, shadow, padding, auto or fixed height, fit, reset).

| Choice | Pros | Cons | Alternatives considered |
|---|---|---|---|
| Tiptap 3 / ProseMirror ✅ | Mature, schema-based (the stored format is validated JSON), good paste handling and undo, React bindings. | Extensions to learn; a few internals (DOM selection timing) need care. | Lexical (younger, less schema control), Slate (more to build), Quill (weaker schema). |
| Browser layout + Konva paint ✅ | Identical line breaks in the editor and on the canvas, all canvas features keep working, fast with many notes. | A hidden measuring DOM; strikethrough position and some sub-pixel details are approximations. | DOM overlays for every note (breaks layering and culling, slow with many), Konva `Text` layout (different line breaks from the editor). |
| Leases + revision-checked saves ✅ | Prevents nearly all conflicts up front; the revision check guarantees no silent overwrite even if a lease is lost. | Users choose when a conflict does happen. | Revision check alone (more conflicts), CRDT merging (much larger, unnecessary until collaboration, ADR-006). |

**Consequences and known limitations.**
- The strikethrough line is placed by font metrics and may sit a pixel away from the browser's.
- At some zoom levels, a line may be drawn 1 px from where the editor shows it. Line breaks always match.
- The expanded editor uses a wider page (at least 720 px), so its line breaks differ from the canvas; the canvas reflows when you return.
- Right-to-left text isn't specially handled.
- Ctrl+Shift+E opens the expanded editor (Tiptap uses it for centring; alignment is in the panel).
- System fonts are stored by name; another computer without the font shows a fallback.
- `plainText` is ready for project search (M5) and the revision column for future sync (ADR-006).

---

## ADR-015 — PDFs and generic file cards

**Date:** 2026-10-25 · **Status:** ✅ Accepted · **Requirements:** §5, §6, §7, §18 · **Extends:** ADR-005 (asset storage), ADR-007 (formats), ADR-013 (image import)

**Context.** M3C is the last part of board objects before the asset library. People need to read PDFs (scripts, references) and keep other creative files (`.clip`, `.psd`, `.procreate`, `.docx`, archives, and so on) in the project without the app becoming a document editor or launching those files on its own.

**Decisions.**

- **One store, three card types.** Drop, paste and the **File** tool copy every accepted file into the existing content-addressed asset store (SHA-256, byte-for-byte, deduplicated). The **Image** tool still accepts only JPG, PNG and WebP.
  - A file `sharp` can read as JPEG, PNG or WebP becomes an image card, even if its name says `.pdf`.
  - A file whose header or name says PDF must actually be a readable PDF, or it is skipped with a reason. A corrupt PDF is not stored as a generic file. The rest of a batch still imports.
  - Empty files are skipped. Everything else is a generic file card. Import success does not mean the file can be previewed.
- **PDF cards** (`board_objects.type = 'document'`). The first page's size (in PDF points) is stored on the asset as `width` and `height`, and `page_count` (migration `0002_pdf_page_count`) holds the page count. The card locks that ratio, like an image, and does not rotate. A cover is the first page rendered in the importing window (about 1024 px on the long side) and saved by the main process as `thumbs/<sha>_1024.webp`. Import does not wait for the cover. Any window can draw a missing cover later. Until then the card shows a PDF placeholder. A password-protected PDF is stored with no page size until it is unlocked in the reader; the password is kept in that window's memory only and is never written down.
- **Generic file cards** (`type = 'file'`) do not rotate. The frame can be resized down to the usual minimum. Two appearances, per card, in `data.appearance`:
  - **Compact** (the default): icon, filename, extension and size.
  - **Preview:** an attached image, letterboxed so it keeps its own proportions, plus the filename and type.
  - The preview image is a separate image asset (`assets.preview_asset_id`), shared by every card of that file. Switching appearance does not change the file or remove the preview. Removing or replacing a preview does not delete an image that another card still uses.
- **Reader.** pdf.js (`pdfjs-dist`) in the renderer, read-only. Scripting and eval are off. The worker cannot fetch `cw-asset://`, so the main process serves byte ranges of the stored original (`assets:readRange`) and only the pages on screen are painted. Modes: continuous scroll (default), single page, and a two-page spread. The spread draws page 1 alone, then pairs, and a leftover last page alone. Right-to-left only swaps which side is drawn; it never reorders the file. Switching modes keeps the current page when it can. The sidebar shows page thumbnails as they come into view, and the PDF's own outline when it has one. Search covers the whole document, highlights matches, and says "No searchable text" when the PDF has none. There is no OCR. Hyperlinks use the same web-and-mail check as notes. Reading position, zoom and mode belong to the window and are not saved.
- **Where the reader lives.** Double-click opens it full-window in the current window; closing it returns to the same board, camera and selection. **Open in new window** is another Electron window on the same project. Closing that window does not close the project.
- **Opening a file outside the app.** **Save original as** copies the stored bytes. **Open a copy** asks for a folder, writes a new file there (it will not overwrite an existing one), opens that copy, and says edits in the other app do not come back into the project. The hash-named file in `assets/` is never opened for editing. Executables and scripts (`.exe`, `.bat`, `.cmd`, `.ps1`, `.msi`, `.app`, `.command`, `.sh`, and similar) can be stored and shown, and **Open a copy** is unavailable for them. Nothing is launched just because it was imported.

| Choice | Pros | Cons | Alternatives considered |
|---|---|---|---|
| pdf.js in the renderer, ranges read by the main process ✅ | No new native module; pages stream; the worker never needs the custom protocol. | Each range is an IPC call. | Fetching `cw-asset://` from the page (Chromium returns "Failed to fetch" for this protocol), a native canvas library (rejected: another native module). |
| Cover rendered in the window that imported the PDF ✅ | Uses the same pdf.js; no second renderer in the main process. | The cover appears a moment after the card. | Rendering covers in the main process (needs a canvas there). |
| Preview on the asset, appearance on the card ✅ | Every card of a file shares one preview; each card can still be compact or large. | Replacing a preview changes it for every card of that file. | Preview stored per card (easy to lose, and duplicates the link). |

**Consequences and known limitations.**
- PDF and file cards do not rotate.
- There is no PDF editing, annotation, user bookmarks, OCR, or editing of DOCX / Markdown.
- The app does not invent a table of contents. If the PDF has no outline, the sidebar says so.
- A 500-page PDF is read a few pages at a time. That is a manual check, not a CI fixture.
- Password-protected PDFs show a placeholder cover until unlocked in that window.
- Search in the reader is not project-wide search (M5).
- Files land at the top of the library until M4. There is no library browser for picking a preview; the user picks an image file.
