# Creative Workspace — M9 Consolidated Design Specification

**Milestone:** M9 — Page Collections, Manga Planning, Page Review & Reader Mode  
**Status:** Design locked; Decisions 1–42 consolidated  
**Platform:** Windows desktop, local-first, PC-only  
**Implementation policy:** Build on existing M1–M8 architecture. **Keep M6, M7, and M8 unmerged**; M9 work must remain on a stacked branch/PR above their current implementation rather than merging them to the base branch.

> **Authority:** This specification records the user's selected decisions, not the assistant's earlier recommendations. Where an earlier proposed C feature was declined in favor of A/B, the declined feature is explicitly outside scope.

## 1. Mission, boundaries, and product philosophy

M9 adds *standalone page collections* to Creative Workspace. A collection can organize blank and illustrated manga/comic pages, provide page-sequencing and production tools, support non-destructive artwork versions and review, and display the sequence in a flexible Reader. Collections belong to the project and are organized in nested folders, with optional representations as movable cards on infinite canvases.

M9 must feel like part of the existing application, not a parallel app: reuse existing project identity/persistence, Asset Library, image stack assets, M6 tags, M8 link/comment primitives, undo/redo, M5 autosave and backups, keyboard dispatch, and multi-window architecture. Maintain no-AI, no cloud account, no online real-time collaboration, and no additional drawing/painting tools. This is primarily for manga/comic page planning, not a desktop-publishing or illustration editor.

**Core invariants:**

1. **A page is an identity, not a number.** Stable page IDs survive sorting, renumbering, moves between collections, restoration, and references. Automatic numbers are derived from sequence positions; custom labels are separate.
2. **A collection is an identity, not a canvas card.** Its folder location, name, canvas appearances, and reader session can change without changing collection identity.
3. **Assets are not pages.** Multiple page entries and versions may reference the same project-managed original; changing presentation does not change the original bytes. Never remove project assets merely because a page, canvas card, collection, or artwork version is removed.
4. **Intentional blanks and failures differ.** Blank placeholders are valid pages. Missing/corrupted/unsupported artwork and temporary loading errors are diagnosed separately.
5. **Page sequence and reader presentation differ.** RTL/LTR, spreads, pairing, fit, zoom, and pan are presentation rules; reordering is an explicit page mutation.
6. **Shared data, independent windows.** Windows see synchronized collection content, but maintain their own selection, Reader camera, and transient UI. Conflicting edits are revision-safe, never silently last-write-wins.
7. **No rejected feature creep.** No per-collection reader appearance overrides, hierarchical TOC, saved-camera bookmarks, expanded project-wide M9 search, saved filter views, page templates, dedicated reference workspace, extra collection recovery/scanner, user-configurable Planner shortcuts, always-on chapter validation, or smart folders.

## 2. Locked decision register — authoritative 1–42

| # | Choice | Locked implementation decision |
|---|---|---|
| 1 | C | **Hybrid collection entities:** independent project collections, visible in sidebar and optionally via multiple canvas card appearances; removing a card does not remove the collection. |
| 2 | C | **Flexible page entries:** stable-ID pages can contain displayed artwork or no artwork, notes, production state, M6 tags, and metadata; planner/reader present the same entries differently. |
| 3 | C | **Flexible sequence/spreads:** reorder, automatic numbering, optional custom/unnumbered labels, per-collection RTL/LTR and first-page side, automatic facing-page pairing, locked adjacent two-page spreads, and one wide illustration spanning two reading positions non-destructively. |
| 4 | C | **Dual-view planner:** Thumbnail Grid (initial default) and editable Spread Layout, shared sequence and selection, drag, multi-selection, placeholders, spread management, properties inspector, undo; remember view per collection. |
| 5 | C | **Artwork versions/reuse:** one displayed version plus optional named alternate versions, all referencing existing managed assets (including M7 slides); independent non-destructive crop/presentation metadata; no automatic M7 stack synchronization. |
| 6 | C | **Customizable production:** per-collection stage list; per-page stages Not Started / In Progress / Done / Skipped, independent overall status, page and stage notes, aggregate progress, bulk editing, M6 filters, undo; assigning artwork never automatically completes stages. |
| 7 | C | **Flexible Reader:** Single Page, Two-Page Spread, Continuous Vertical Scroll, RTL/LTR, fullscreen/focus, thumbnail strip, jump to page/label, fit/zoom/pan, locked spreads and wide pages, blank placeholders; no production overlay by default. |
| 8 | **B** | **Remember everything automatically:** per collection restore last stable-ID page, exact Reader layout, exact zoom, exact pan/camera; honor independent live Reader sessions and most recently actively interacted-with resume source. |
| 9 | **B** | **Nested folders + independent collections + collection templates:** standalone collections in arbitrarily nested folders, built-in/custom reusable templates for reader/planner/numbering/production defaults; identity-safe moves and names; Trash/Restore; no collection-in-collection hierarchy. |
| 10 | C | **Flexible canvas cards:** Compact (default)/Cover Preview per appearance, collection cover with optional per-card preview override, optional page/progress/reading metadata, configurable double-click (Planner default, Reader, last-used), quick actions, existing canvas operations/M6 tags/M8 links, connections, comments. |
| 11 | C | **Smart multi-source import:** files/folders, Asset Library, canvas objects, M7 stack slides, clipboard, other collections; editable staging preview, natural sort, reorder, append/insert/fill placeholders, version and wide-spread suggestions, folder handling, dedup/error feedback, cancel and one-step undo. |
| 12 | C | **Move/copy/recovery:** Move retains page ID, Copy generates independent IDs; Page and Collection Trash/Restore, artwork-only clearing, locked spreads, production mapping review and recoverable unmatched records, full and structure-only collection duplicate, reference remapping, transactional undo/multi-window safety. |
| 13 | **B** | **Exact-page links and threaded page comments:** stable-ID destinations to collections/pages, page-scoped comment threads, canvas connections stay on canvas. **Do not** add Option C's expanded collection-level relationship graph or artwork-version deep-link system. |
| 14 | C | **Artwork review:** dedicated Single Image, Side-by-Side, A/B Toggle comparison; version picker, synchronized/independent zoom/pan, spread-aware display, optional page-comment panel; explicit Set as Displayed Artwork, no M11 paint annotations. |
| 15 | **B** | **Advanced *collection-local* search/filter:** titles, numbers, labels, notes, production states/stages, artwork metadata, M6 tags, spreads, threaded page comments, stable-ID results. **No new cross-project/project-wide M9 discovery or saved filter views.** |
| 16 | C | **Export and portable packages:** readable PDF, numbered PNG/JPEG/WebP sequences, validated independent editable collection package containing pages, versions, notes, production, tags, settings; optional comments OFF by default; remap included links, flag outside references; no alteration of source assets. |
| 17 | C | **Category-aware settings:** collection-wide presentation/numbering changes apply appropriately; new-page defaults only affect future pages; stage/data migrations require impact previews, preserve stage IDs, history and notes, explicit template-apply to existing; safe undo and revision checks; protect Reader exact state. |
| 18 | C | **Conflict-safe multi-window:** independent Planner/Reader/Review sessions, live content refresh without forced navigation, safe nonoverlapping field edits, conflict UI for overlaps, atomic structural operations and revision-aware undo; last *actively used* Reader owns saved resume state, not stale close events. |
| 19 | **B** | **Scale with existing M5 recovery:** metadata-first, virtualized thumbnails, lazy full-res loads, bounded caches, progressive loading, scalable imports/exports; reuse existing M5 autosave/backups/recovery. **No additional M9 targeted backup restoration tool or project-wide structural scanner.** |
| 20 | **B** | **Flat TOC and simple bookmarks:** named collection-local TOC entries and page bookmarks with stable-ID targets, accessible in Planner and Reader; **no** hierarchical TOC or exact-camera bookmark snapshots. |
| 21 | **B** | **Optional structured overview:** shared cover/metadata, distinct page-entry/artwork/placeholder counts, independent production summary/overall status, flat TOC/bookmark preview, recent activity, shortcuts to Planner/Reader/Review/search/settings/export; collapsible sections, no rearrangeable widgets, not mandatory. |
| 22 | **B** | **Global Reader appearance preferences only:** backgrounds, margins, gutters, borders, fitting, enlargement/interpolation applied consistently across collections; exact camera restoration overrides default fit. **No per-collection theme override or window-specific appearance hierarchy.** |
| 23 | C | **Customizable Reader controls:** RTL/LTR-aware turns, Reader-scoped remappable keyboard shortcuts and conflict checking, configurable click zones/wheel, touchpad scrolling/pinch if supported, zoom-safe panning, cursor-anchored zoom, on-screen controls, input presets; preserve exact Reader camera. |
| 24 | C | **Non-destructive artwork errors:** distinguish blank/missing/unsupported/damaged/changed-external/transient; per-version retry/relink/review, user-initiated collection-local bulk matching with approval, clear Reader placeholders and export handling; no silent substitution, external sync, backup system, global scanner. |
| 25 | C | **Advanced bulk editor:** stable-ID Ctrl/Shift/range/filter selection, hidden-selected count, mixed states, Add/Remove/Replace semantics, safe notes append, production/tags/artwork/structure operations, impact/compatibility/conflict preview, locked-spread checks, atomic undo and revision safety; no default mass comment edits. |
| 26 | C | **Adaptive Planner thumbnails:** Compact/Balanced(default)/Detailed, fine size slider, configurable metadata and hover/focus details, mandatory page label/selection/error/spread indicators, M6 tag visibility respected, saved collection-local Grid sizing and separate Spread Layout zoom, virtualized rendering; no Reader camera coupling. |
| 27 | C | **Page Properties inspector:** resizable/collapsible, inline + expanded editing for title/label, notes/stages/tags/artwork/spreads/comments, explicit displayed-version switch, stable-ID selection, derived numbering, multi-selection summary routed to bulk preview, per-window UI state. |
| 28 | **B** | **Batch placeholders with initial metadata:** one/many placeholders, title/label/notes/M6 tags/initial stage values, insertion preview, stable IDs, atomic undo. **No reusable per-page templates or automatically attached supporting artwork.** |
| 29 | **A** | **Inspector-only supporting notes/reference links:** use Page Properties and ordinary existing M8 links opening existing viewers; **no dedicated reference panel, split view, or new reference associations subsystem.** |
| 30 | **B** | **Notes/references on move/copy:** preserve with page ID on move; include notes, stage notes and outgoing M8 links on copy by default, with simple per-category exclusions; remap links between copied pages, retain external/outside targets, don't retarget incoming links to originals; comments opt-in, stage mapping safe. |
| 31 | **B** | **Context-aware fixed Planner controls:** standard shortcuts/menus routed by focus (text fields override page commands), cross-collection Move/Copy, assets/canvas to Planner, drag page to canvas creates exact-page link, filter/spread protection. **No new Planner shortcut remapping system.** |
| 32 | **B** | **Smart stable-layout drag:** selected-page ghost/count/locked-wide indicators, exact insertion marker, neighboring spread preview, invalid-target feedback, no live whole-grid reflow; escape/cancel/auto-scroll, atomic commit and undo. |
| 33 | **A** | **No proactive chapter-validation pass.** Surface errors when operations fail or their existing operation-specific prerequisite checks discover problems. Do not add automatic chapter-wide validation dashboards or warnings before every Reader open. |
| 34 | **B** | **Optional built-in page roles:** Cover, Title, Story, Bonus, End, Intentional Blank, with numbering exceptions; no user-defined page-type taxonomy or elaborate per-role publishing rules. |
| 35 | **B** | **Mixed dimensions/orientation:** preserve artwork aspect ratio and portrait/landscape orientation, existing non-destructive crop/fit and spread rules; no print bleed/trim/safe-area prepress suite. |
| 36 | **B** | **End-of-collection screen:** Restart, Overview, Planner, and optionally an explicitly linked Next Chapter; no automatic inference of chapter order from sidebar sorting. |
| 37 | **B** | **Reader handoff:** Open Current Page in Planner or Artwork Review, optional existing page comment access. No always-on editable Reader review mode or new annotation overlays. |
| 38 | **B** | **Planner reopen:** restore last selected stable-ID page, nearby scroll anchor, density/zoom, inspector layout; clear transient bulk selections and active search/filter state. |
| 39 | **B** | **Lightweight new-collection dialog:** name, nested destination folder, built-in/custom collection template, RTL/LTR, optional initial placeholder count; open Planner directly. No wizard or forced overview. |
| 40 | **B** | **CBZ and ZIP image archives:** safely extract/list and stage review using D11 importer plus individual images/folders; no PDF-as-image conversion or other archive/document formats. |
| 41 | **B** | **Package import conflicts:** validate and preview; create new independent collection, deduplicate assets, reconcile M6 tag identities, remap included links and flag unresolved outside links; no merging/overwriting existing collection. |
| 42 | **B** | **Sidebar order:** manual drag order and natural-name/date/last-modified sorts within nested folders; no smart folders or automatic rule-driven organization. |

## 3. Canonical domain model and persistence contracts

Implement using the repository's existing data model, database, asset and IPC conventions; the following is conceptual, **not** a mandate for specific table names or a rewrite.

### 3.1 Project collection

- `collectionId` immutable stable identity.
- `projectId` existing ownership; `folderId` nested organizational parent; `manualSortKey` stable order and other sorting modes.
- Title, description, optional cover asset reference, template provenance **only for informational use**, optional collection type metadata, overall status.
- Reader direction RTL/LTR; first-page side; automatic numbering rules, optional custom labels, built-in page-role exceptions; collection-wide spread/reader layout defaults.
- Collection configuration: planner initial/persisted view, per-collection production stage definitions and defaults, new-page default metadata, collection settings.
- Ordered page references; flat TOC entries; simple bookmarks.
- Trash/tombstone data and version/revision suitable for safe undo and multi-window synchronization.
- Settings from a template are copied at creation, not live-bound to later template edits.

### 3.2 Page entry

- Immutable `pageId`, current `collectionId`, order key/sequence position; *derived* displayed number and optional user-edited title/custom label/unnumbered flag.
- Built-in optional role: Cover, Title, Story, Bonus, End, Intentional Blank. Role affects labeling/numbering exceptions under collection rules; never silently changes actual sequence.
- Displayed artwork version ID or null for intentional blank; zero or more named version records referencing existing Asset Library asset IDs, with source metadata; page-local non-destructive crop/fit properties.
- Page notes, per-stage notes, stage state and independent overall status; M6 direct tag associations; M8 page comment threads; ordinary M8 outgoing links/reference destinations as already supported, **not** a new attachment subsystem.
- Spread membership: pair/locked partner, reading order, optional wide-artwork span of two reading positions. Protect partner and continuity during move/copy/trash.
- Revision, deleted/trash state and source-independent link identity. Page moving across collections preserves this ID; page copying assigns new ID.

### 3.3 Other records

- **ProductionStage**: stable stage ID within a collection, display name, sequence, applicability/default state. Renaming/reordering does not erase progress; removed stages with history retained recoverably through existing persistence approach.
- **ArtworkVersion**: version ID, name, underlying asset reference, optional non-destructive page-local crop/fit; one explicitly chosen displayed version.
- **CollectionCardAppearance**: separate board-object ID referencing collection ID, compact/preview display, size/transform/group/layer/links, per-appearance cover override and opening action; deletion is not collection deletion.
- **FlatTOCEntry / Bookmark**: stable collection-local navigation entry ID + target page ID + title for TOC (bookmark may use optional label); no nested TOC hierarchy and no saved camera.
- **ReaderSession**: per-window local active page ID, layout, exact zoom/pan/camera state; durable per-collection resume record updated by most-recent active Reader interaction, not by passive refresh or stale window close.
- **PlannerSession**: selected stable page ID, scroll-neighborhood anchor, view, grid density/size, spread zoom, inspector UI; transient selections/search/filter reset when reopened.

### 3.4 Counting rules

Always distinguish **page entry count**, **reading position count**, and **artwork file/asset count**. A wide image may occupy two reading positions without becoming two independent image files; a locked spread comprises two page identities. Overview and export previews must not conflate these counts. Artwork coverage means entries with valid displayed artwork, separate from production completion.

### 3.5 Referential integrity and transactions

- Stable IDs must be authoritative for links, notes, comments, TOC, bookmarks, selection and Reader navigation. Page numbers and filenames are display/search fields.
- All structural operations—cross-collection moves, duplication of linked selections, locked spread changes, bulk insertion, trash/restore—must be atomic and revision-checked using existing infrastructure. No partially committed spread or transferred sequence.
- Preserve stale unsaved field edits on conflicts; merge non-overlapping changes where safe; require explicit conflict resolution for overlapping edits.
- Undo/redo must not overwrite newer changes from another window. Use the existing application undo semantics and safe revision checks.
- A project's backup remains M5's responsibility. Do not add M9 snapshot scheduling, targeted backup restore UI, or global integrity scans.

## 4. Navigation, presentation and relationship rules

### 4.1 Collection lifecycle and organization

A dedicated **Collections** sidebar supports arbitrary folder depth, moving, renaming, manual reorder and optional natural-name/date/last-modified sort. Collections are standalone, **not recursively nested collections**. Collection templates (built-in and user-saved) can set Reader/Planner/numbering/production defaults; editing them is not retroactive. New collection: lightweight name/folder/template/direction/initial-placeholders dialog, then Planner. An optional structured overview remains reachable but is not a forced landing page.

Canvas card appearances can reference the same collection from multiple boards; each separately controls Compact (default) or Cover Preview, optional per-card cover image, optional metadata, and double-click Planner(default)/Reader/last-used behavior. Cards support the established canvas position/resize/rotation/group/layer controls and existing M6 appearance tags/M8 canvas connections, links, comments. Removing a card removes that appearance only.

### 4.2 Page structure and facing-page composition

The ordered sequence supports regular pages, explicit intentional blank pages, optional unnumbered pages, custom labels, cover/title/bonus/end roles, and role-based numbering exceptions. Derive numbers from order with role rules; do not couple IDs to numbers. Per-collection reading direction and opening side determine automatic facing-page layout. Users may lock adjacent pages into a spread; a single wide illustration can occupy two reading positions without cutting or copying original artwork. Viewers must honor original dimensions and non-destructive crop/fit, never stretch image proportions. Insertion and moves must validate locked pair boundaries.

### 4.3 Reader, saved state and input

Single, Two-Page, Continuous Vertical Scroll; direction-aware page turns and spreads, fullscreen/focus, collapsible thumbnail navigation, flat TOC/simple bookmarks and page/label jumps, zoom/pan/fit. Global (not per-collection) appearance preferences for background, spacing, gutter, borders, fit policy, enlargement, interpolation. **Persist per-collection exact last stable-ID page, Reader layout, zoom and pan; defaults apply only when no saved state or when user intentionally changes fit/layout.** Keep independent live window cameras; the most recently *actively interacted with* Reader session updates persisted resume. Passive refresh and stale close events must not overwrite it. Move/reorder retains page camera target by ID; open exact-page link intentionally navigates to its target.

Reader navigation uses configurable Reader-scoped shortcuts, collision handling, click zones, mouse wheel and touchpad input, cursor-centered zoom, pan, zoom-aware prevention of accidental turns and optional Manga/Western/Keyboard/Continuous presets. Focused text editing overrides page-turn hotkeys. No new Planner shortcut remapping: Planner gets fixed, focus-aware defaults integrated with existing M5 input dispatch.

At chapter end show simple end card: Restart / Overview / Planner / optional **explicitly linked** Next Chapter. Never infer next from folder order. Reader-to-Planner and Reader-to-Artwork-Review actions target the *current stable page ID*. Existing page comments may be accessed intentionally; Reader is not a persistent editable production overlay.

### 4.4 Flat TOC and simple bookmarks

Users manually create, rename, reorder and delete flat named TOC entries resolving to page IDs; bookmarks are simple page shortcuts, not camera snapshots. Both appear in Planner and Reader. Reordering page sequence preserves targets; moving to another collection must not silently retarget a different page. Show unavailable targets when trashed/missing and allow an explicit fix. Do not build nested/sectioned TOCs, auto-TOC hierarchy or camera bookmarks.

### 4.5 Page links, comments and reference boundary

M8 stable-ID navigation targets can point at a collection or exact page. M8 canvas connections are only rendered on canvas objects, not across page thumbnails or Reader images. Page-scoped threaded comments appear in Planner inspector and optionally Artwork Review, not over Reader artwork by default. No expanded collection-level relationship graph, collection-scoped commenting suite, or artwork-version deep-linking. Supporting reference links are ordinary M8 links exposed in the Page Properties inspector, opening their existing destination viewers. **No new references panel, split-view reference workspace, or special reference assets embedded in placeholders.**

## 5. Page Planner and edit flows

### 5.1 Two Planner views

**Thumbnail Grid** initially default with Compact/Balanced(default)/Detailed density presets, size slider, adaptive column count, optional production status/stage, artwork version, M6 tags according to their visibility rules, comment counts and hover/focus details. Always show page label, selection, missing-art error and spread markers as relevant. **Spread Layout** shows facing-page arrangement, locked pair and wide-artwork composition, with zoom independent from grid thumbnail sizing. Remember selected Planner view, density/zoom and inspector layout per collection.

### 5.2 Page Properties inspector

Resizable, collapsible, per-window UI state. Page ID is immutable; number is derived; editable title/custom label, notes, stage notes, overall and stage statuses, M6 direct tags, artwork version picker/crop/actions, spread settings and threaded comments. Fast inline changes; expanded focused note, production, artwork or comment editor for longer tasks. Viewing an artwork version does not set it as displayed; explicit Set as Displayed Artwork. Multiple selection shows mixed/aggregate states, with batch change routed to D25 impact preview rather than writing one page's values onto all.

### 5.3 Creation and placeholders

Insert one or many blank page entries at beginning/before/after/end with insertion preview. Users can provide titles, labels, page notes, M6 tags and initial production states; maintain stable IDs and one-step undo. No reusable page-template system and no automatic supporting-reference artwork on creation. Blank is a valid Reader page. Later assignment of displayed artwork through D11 retains the page identity and its notes/statuses; never automatically completes workflow stages.

### 5.4 Bulk editing

Click, Ctrl-click, Shift range, select filtered results, Ctrl+A (scoped), selection across virtualized offscreen thumbnails, visible count including hidden-selected count. Support production status/stages, M6 Add/Remove/explicit Replace, safe note Append and explicit dangerous Replace, compatible artwork display/crop/version changes, page metadata, page move/copy/trash and spread operations. Mixed values display as Mixed. Show preflight: targeted, already-matching, changed, incompatible, and conflicting records; require explicit confirmation for dangerous/large edits. Avoid default mass thread editing/deletion. Atomic, revision-checked commit and one-step undo. Filtered view supports metadata edits but **disables drag reordering**; use full sequence for reordering.

### 5.5 Drag-and-drop and keyboard context

The *focused field/surface* controls keys: text fields before Planner, Reader and canvas; global commands only where appropriate. Planner has fixed context-aware shortcuts and right-click menus, not separately remappable Planner shortcuts. Drag page within collection to reorder; between collections to choose Move or Copy; page to canvas creates an exact-page M8 link card, never extracts original; Asset Library or canvas image into Planner uses D11 import/assign staging. Existing assets remain intact. Locked spreads cannot split accidentally; invalid targets reject. Drag ghosts show selected item count and locked/wide status; precise insertion markers map to logical sequence; Spread Layout previews neighboring pairing; **no full live reflow**. Escape cancels; edge auto-scroll and Move to Position support distant moves. Revalidate on release and commit atomically with undo.

### 5.6 Search and filters

**Within the current collection only**, search page numbers/labels, titles, notes, stage information, existing artwork metadata/version labels/filenames, M6 direct/effective tags using existing AND/OR/NOT, spreads/placeholders and page threaded comments. Results resolve stable IDs; jump to Planner/Reader/Review as appropriate. Filters and temporary sorts do not change chapter order. No M9 saved views, expanded global collection index or project-wide search additions. Existing M5/M6 search outside M9 remains unchanged.

## 6. Asset versions, review, importing and repair

### 6.1 Artwork versions

Each page can refer to zero (placeholder) or many named existing managed assets, with one explicit displayed artwork selection. Sources include Asset Library entries and M7 stack slides without mirroring/syncing later stack edits. Page-local non-destructive crop and fit, no mutation of original bytes. Older versions preserved upon replacement when configured. Selecting a version for inspection does not change Reader's displayed image.

### 6.2 Artwork Review workspace

Separate from Reader and Planner, reachable from inspector, current page or overview. Single, Side-by-Side and A/B Toggle; choose versions, synchronized/independent normalized-coordinate zoom/pan; locked spread/wide-artwork aware. Comments panel optional. Explicit Set as Displayed Artwork; no drawing tools or M11 overlay annotations. Review windows are independent, shared page data live-refresh and conflict protected.

### 6.3 Smart staged import

Sources: selected Windows files, folders, project Asset Library, canvas images, M7 stack slides, clipboard, other collections, **CBZ and ZIP comic image archives**. Input staging shows thumbnails, natural filename sort (`Page 2` before `Page 10`), manual reorder/reverse, excluded/unsupported/broken files and reasons, folder handling, proposed targets: append, insert before/after, fill empty placeholders. May suggest grouping `Sketch`/`Inks`/`Final` into versions and wide assets into spreads; **never commit suggestions silently**. Import references/duplicates use existing Asset Library dedup and source-preserving behavior. Reject path traversal, decompression abuse, unsafe archives; no PDF-to-image import conversion (Decision 40B). Cancel means no partial sequence; commit as one logical revision-aware undoable operation. Large batches process progressively without freezing other windows.

### 6.4 Artwork errors and repair

Recognize: intentionally blank, missing managed asset, unsupported image type, corrupt/decode failure, changed *explicitly linked* external source (only if already supported), temporary load failure and cache miss. The latter are not equivalent to missing originals. Preserve page ID, position, tags, notes, stage history, comments and spread. Retry, inspect alternate versions, explicitly relink per version, and collection-local user-initiated folder matching with preview/confirmation. Revalidate cropped/spread content if replacement dimensions differ. Do not automatically switch displayed version, auto-sync external folders, or alter originals. Reader shows safe error placeholder retaining logical page position and exact Reader saved target. Export cannot silently drop unavailable displayed artwork; show operation-scoped warning and let user repair, substitute marked placeholders, or explicitly omit pages where supported.

## 7. Collection overview, creation, settings, export and lifecycle

### 7.1 Optional structured overview

Title, description, cover, folder/breadcrumb, built-in/custom template classification, overall status, page entries/artwork coverage/placeholders, distinct reading-position count where relevant, independent production-stage completion, recent activity if source records exist (otherwise add only minimal data necessary), flat TOC/bookmarks preview, shortcuts to Planner/Reader/Review/collection-local search/settings/export. Collapsible fixed sections; no movable widgets. No forced landing screen: card's double-click mode and new-collection Planner direct-open still apply.

### 7.2 Collection settings and templates

Settings grouped reading/sequence/numbering, planner, production stages, cover, templates. Collection-wide changes affecting existing presentation (direction, opening side, numbering) update the view and derived labels without rewriting IDs/page order. New-page metadata defaults affect future pages; existing page production/stage changes require scoped impact preview. Stage rename/reorder preserves stage identity and notes; remove with progress must retain recoverable history. Bulk settings updates atomic and revision-safe. Built-in/user collection templates are starting configurations only. Applying a changed template to an existing collection is a separate selective, previewed action. No *page* templates.

### 7.3 Export formats

1. **PDF** from displayed page artwork and actual sequence, preserving cover/unnumbered/blank roles and non-destructive crops. Spread handling must be explicit (keep one wide PDF page vs split into facing pages where valid), not modify assets; confirm unsupported/missing pages as errors at export time.
2. **Image sequence** in numbered, padded PNG/JPEG/WebP, optionally folder/ZIP, ranges/selections, with roles/numbering and spread conventions made explicit. Generated copies never alter project originals.
3. **Portable editable package** including selected/all pages, page roles/metadata/order, version records and contained source assets, stage workflow/progress/notes, M6 tag data, collection settings, locked spread relationships, relevant internal stable-ID links; optional comments **excluded by default**. Personal exact Reader resume/camera is local state and excluded from portable shares by default.

Archive/package import validates paths, sizes, schema/version and content, previews changes, *always creates an independent collection*, deduplicates project assets, reconciles tags via existing M6 semantics, remaps included page/collection links to new identities, and flags external/unavailable targets. **No merge/overwrite into existing collection**. Operation transactional with recovery via existing M5 system.

### 7.4 Move, copy, trash, restore

- **Move page:** retain page ID, notes/stage notes, outgoing links, tag/comment associations and artwork; update only collection ownership, order and incompatible production stage mapping with explicit preview. Preserve unmatched stage data recoverably.
- **Copy page:** new page ID; include ordinary and stage notes and outgoing M8 links by default, with simple exclusions; internal copied-to-copied links remap; outside links retain original target; incoming external links continue pointing at originals. Threaded comments excluded unless opted in. No duplication of underlying source image assets.
- **Full duplicate collection:** independent page and collection identities, copied page structure, referenced asset reuse, scoped link remapping. **Structure-only duplicate:** page slots/order/settings without artwork/completed production state.
- **Clear page artwork:** preserve placeholder and metadata. **Remove a version:** preserve original managed asset. **Trash page/collection:** recoverable with identity; inbound links show unavailable while trashed and work after restoration. **Permanent deletion:** explicit and never implicitly deletes shared Asset Library originals.

### 7.5 Chapter validation boundary (D33A)

**Do not build a proactive chapter validation command, continuous sequence health panel, automatic Reader-opening preflight, or project-wide scanner.** The existing operation guards still apply when needed to safely perform an action: spread drop bounds, staged import validation, bulk editing impact previews, package validation, and missing-artwork export warnings under D24/D16. This is not a contradictory always-on chapter scan: errors arise *during the relevant operation*, or from an actual load failure. An unfinished chapter remains readable and editable without passing a readiness check.

## 8. Performance, local safety and session requirements

- Scale design target: practical navigation of large collections (hundreds or 1,000+ entries) through indexed metadata, virtualized thumbnail grids, bounded thumbnail/image cache, lazy current/nearby Reader pages, appropriate preview resolutions and separate high-res decoding on demand. Benchmark actual hardware; do not promise arbitrary load times.
- Efficient scalable imports/exports, status progress, cancellation before commit, streaming or bounded-memory work; do not decode all artwork versions to display a page grid.
- Continue existing M5 autosave, hourly incremental backup opportunities, verified backups and retained schedules; no new schedule, new backup architecture, separate per-collection recovery screen or global integrity scanner.
- Reader camera persistence must be efficient but durable enough to restore recent page/layout/zoom/pan. Preserve its exact last committed state even if reopened. Exact camera of a moved or renumbered page follows stable ID. Two Readers do not fight over resume through stale close events.
- Planner reopen restores stable-ID selection, nearby scroll anchor, density/Spread zoom and inspector layout, **not** temporary bulk selections or search/filter state.
- Multi-window: view state local, content synchronized; per-field revision checks, transaction-safe moves, non-overlapping updates preserved, stale conflicts never auto-overwritten. No networked collaboration requirement.
- Accessibility: keyboard-focus equivalents to hover info, visible selections, clear error labels not color-only, proper RTL navigation and Windows input ergonomics.
- Persisted files and archives: validated, non-destructive, never trust source paths or filename guesses; preserve data and backups during migrations.

## 9. Acceptance criteria and test matrix

The tests below are **requirements**, not claims of implementation. Prefer existing repo test style; add unit/integration/e2e coverage appropriate to its architecture.

| Test ID | Scenario | Expected result |
|---|---|---|
| M9-01 | Collection in nested folder; two canvas cards reference it; delete one card | Same collection and other card remain; ID intact (D1/9/10/42). |
| M9-02 | Create from template, edit template later | Existing collection unchanged until selective previewed apply (D9/17/39). |
| M9-03 | Move/rename folders and collection | No broken collection identity or stored page target (D9/42). |
| M9-04 | Insert 40 placeholders with title/note/tag/status defaults | Exact count/order, new IDs, notes preserved, single undo; no page templates (D2/28). |
| M9-05 | RTL/LTR + first-page side + ordinary/locked/wide spreads | Correct pair/position/visual orientation; no modified originals (D3/7/34/35). |
| M9-06 | Reorder page holding TOC/bookmark/comment/links | Same page ID still targeted; auto number updates (D3/13/20). |
| M9-07 | Reader saves zoomed/panned Page A, closes/reopens | Same stable page, layout, zoom and pan recovered exactly within supported camera precision (D8). |
| M9-08 | Two Reader windows on different pages; passive window closes later | Last actively interacted-with Reader remains resume owner (D8/18). |
| M9-09 | Move linked spread between collections with different stage workflows | Pair intact, same IDs, stage map preview, unmapped notes recovered, atomic undo (D12/18). |
| M9-10 | Copy linked pages A/B and one external ref | A' links B'; outside link stays outside; original inbound targets unaffected; comments excluded by default (D12/30). |
| M9-11 | Stage rename/reorder/remove with existing history | Preserve stage identity; no silent loss; preview and recoverable history (D6/17). |
| M9-12 | Scan folder with `Page_2`, `Page_10`, duplicate, unsupported file | Natural order; staging explains dedup/unsupported; no silent import; cancel leaves no entries (D11). |
| M9-13 | Import CBZ/ZIP with invalid traversal or oversized expansion | Reject safely without arbitrary file writes or partial page records (D40). |
| M9-14 | Fill existing placeholders with artwork | Preserve IDs/notes/tags/status/comments, version selection explicit (D5/11/28). |
| M9-15 | Change M7 slide or source artwork | No unintended M9 displayed-version or original-asset mutation (D5). |
| M9-16 | Side-by-side and A/B compare | Camera controls correct, displayed version only changes on explicit action (D14). |
| M9-17 | Search collection for title/notes/M6 tags/status/comments | Exact stable-ID results; no accidental saved view or new project-wide search feature (D15). |
| M9-18 | Bulk edit filtered/virtualized pages with hidden selection | All targeted IDs counted and previewed; mixed values displayed; no accidental Replace; one undo (D25). |
| M9-19 | Drag locked spread to valid/invalid insertion point | Smart ghost/neighbor preview; invalid rejected; no live grid mutation before drop (D31/32). |
| M9-20 | Move Planner page to canvas, and canvas asset to Planner | Creates M8 exact-page link in first case; staged artwork assign/import in second; originals remain (D13/31). |
| M9-21 | Focusing page note and pressing Delete/Ctrl+C | Text action, not page trash or page copy; focus precedence correct (D31). |
| M9-22 | Image missing vs intentionally blank vs transient load | Distinct states; preserve records and Reader position; repair candidate preview; no implicit switch (D24). |
| M9-23 | Export PDF/images with wide spread/blank/missing artwork | Faithful sequence; relevant operation warning/explicit choice; originals unchanged (D16/24/35). |
| M9-24 | Export/import portable package with linked included/outside pages and tags | Independent new collection, dedup, safe ID/tag resolution, outside target unresolved visibly, comments off by default (D16/41). |
| M9-25 | Collection overview and TOC navigation | Correct counts/progress, flat stable TOC, simple bookmarks, no forced overview (D20/21). |
| M9-26 | Reader global theme changed after exact-camera save | Reopening retains saved page/layout/zoom/pan; no per-collection appearance override (D8/22). |
| M9-27 | Reader end screen and explicitly linked next chapter | Actions work; no folder-order automatic next (D36/37). |
| M9-28 | Planner reopen after filtered bulk selection | Selected stable page and layout/scroll restored; filter and multi-select cleared (D38). |
| M9-29 | Thousand-page planner with thumbnails | Viewport virtualization and bounded cache confirmed; opening does not decode every image (D19/26). |
| M9-30 | Two Planner windows conflict while editing same note | Stale write prevented and unsaved content preserved; non-overlapping edits survive (D18). |
| M9-31 | Create a chapter with missing artwork then open Reader | No mandatory proactive chapter validation; ordinary Reader error placeholder appears only on relevant failure (D24/33). |
| M9-32 | UI inspections for excluded features | No hierarchical TOC, camera bookmarks, page templates, separate reference panel, saved filter views, Planner remapping, smart folders, global M9 scanner (D15/19/20/28/29/31/33/42). |

**End-to-end manual checks on Windows:** create two collections; import folder/CBZ; fill placeholders; version compare; link page to canvas; reorder locked spread; use two Planner/Reader windows; close and restore exact Reader camera; move/copy selection between collections; run collection-local search and bulk edit; trigger missing artwork and relink; export PDF/image sequence/package and import new independent collection; verify M5 backup remains unchanged; confirm no merges occurred.

## 10. Implementation staging and definition of done

A recommended implementation order, subject to repository inspection:

1. **Repository reconnaissance, branch safety, data-model plan and migration tests.** Identify existing M5/M6/M7/M8 APIs; record stack state; no merges.
2. **Collection and page domain/persistence:** identity, nested folders, roles, numbering, templates/settings, stage schema, spread invariants, trash/restore, transactions, comments/links adapters.
3. **Collections sidebar, creation, canvas cards, overview, page inspector:** maintain shared entity vs appearance separation.
4. **Dual-view Planner and rich interactions:** thumbnails, spread layout, placeholders, reorder, drag previews, stable selection, density, local search, batch edit, quick actions, notes and links.
5. **Artwork handling and import:** versions, crop/fit, asset reuse, staging from all sources and safe CBZ/ZIP, error states and collection-local relink.
6. **Reader and Review:** exact camera saving, modes/RTL/spreads, global presentation and configurable Reader inputs, flat TOC/bookmarks, end screen, handoff, side-by-side A/B review.
7. **Export/portable packages:** PDF/images/package with validation, dedup, tag/link remap and explicit unresolved targets.
8. **Multi-window/race conditions, performance, backups, regression, Windows manual smoke and implementation handoff.**

**Definition of done:** each locked D1–D42 has implemented behavior or a clearly documented blocker; tests cover critical identities/transactions/reader camera/asset safety/import-export and rejected-feature boundaries; Windows build passes; normal M5 autosave/backups and existing canvas/M6/M7/M8 features regressions pass; user-facing manual test checklist and any limitations are supplied. Do not claim tests or a successful build until actually run and observed. Create a stacked M9 PR if permitted, and never merge M6, M7, or M8.
