# Creative Workspace App

## Complete Feature Inventory — Version 1.5 (living document)

> **This Markdown file is the source of truth for requirements.** It was converted from the original PDF (v1.0, archived at [`docs/archive/Creative Workspace App v1.0.pdf`](archive/Creative%20Workspace%20App%20v1.0.pdf)).
> Update it whenever a decision or scope change is made, and record the reasoning in [`DECISIONS.md`](DECISIONS.md). Progress is tracked in [`ROADMAP.md`](ROADMAP.md).

**Project Status:** Architecture decided / pre-MVP. M8 (connections, links, comments) is on `feat/m8-connections-links-comments` (PR #13, ADR-020). Picture export and one-board packages are in that branch. A hand pass of `docs/TESTING.md` and a hand install of the Windows installer are still open. M6 and M7 stay unmerged.
**Platform:** PC Desktop (Windows target; developed cross-platform with Electron)
**Development Approach:** AI-assisted coding with support from an experienced developer
**Initial Purpose:** Personal use, with optional collaborative workspaces
**Scope:** Full feature vision, not the initial MVP

### Status legend

| Badge | Meaning |
|---|---|
| 🟢 **MVP** | Part of the first working version (milestones M0–M6) |
| 🟡 **MVP – deprioritized** | In MVP scope, but built after the priority items |
| ⚪ **Later** | Important for later development |
| 🔵 **Optional** | Optional enhancement |
| ⛔ **Out of scope** | Not planned |

### Section status overview

| # | Section | Status | Notes |
|---|---|---|---|
| 1 | Project Overview | — | Guiding principles |
| 2 | Platform and Multi-Window Support | 🟢 MVP (basic) | Electron `BrowserWindow`s; changes broadcast from the main process |
| 3 | Projects and Organizational Structure | 🟢 **MVP – priority** (✅ core done in M1) | Nested boards + folders; Collections ⚪ Later; ADR-011 pending team review |
| 4 | Infinite Canvas | 🟢 **MVP – priority** (✅ done in M2) | Navigation, selection, move/resize, group, lock, layers, align/distribute, grid/snap, smart guides |
| 5 | Board Object Types | 🟢 **MVP – priority** (✅ images M3A, ✅ text notes M3B, ✅ PDFs and file cards M3C) | Checklists, headers/dividers and containers 🟡 deprioritized |
| 6 | Document Viewing and Review | 🟢 MVP (✅ PDF viewing in M3C) | Bookmarks, comments and other formats ⚪ Later |
| 7 | Artwork and Image Handling | 🟢 **MVP – priority** (✅ images M3A, ✅ PDF and stored files M3C) | Automatic previews for TIFF, PSD, .clip and .procreate ⚪ Later |
| 8 | Project Asset Libraries | 🟢 **MVP – priority** (✅ done in M4) | Local-first storage; tags stay ⚪ Later (ADR-016) |
| 9 | Image Stacks | ⚪ Later | |
| 10 | Page Collections and Manga Planning | ⚪ Later | |
| 11 | Artwork Annotation and Review | ⚪ Later | |
| 12 | Tags and Advanced Searching | 🟢 MVP | ✅ Scoped tags, Tag Manager, and tag search in M6 |
| 13 | Linked Tables of Contents and Navigation | ⚪ Later | Sidebar hierarchy is MVP (via §3) |
| 14 | Pinned Items and Workspace Navigation | ⚪ Later | |
| 15 | Collaboration and Shared Workspaces | ⚪ Later | **Requires cloud backend** (see DECISIONS ADR-006) |
| 16 | Plot Roadmaps | 🔵 Optional | |
| 17 | Covers, Typography, and Appearance | ⚪ Later | Notes already offer bundled and system fonts (M3B); board covers and font import later |
| 18 | Quick Capture and Importing | 🟢 MVP (✅ drop, paste, and direct library import) | URL link cards ⚪ Later |
| 19 | Keyboard Shortcuts and Quick Commands | 🟢 MVP | ✅ Canvas shortcuts done in M2; command palette in M5 |
| 20 | Board History and Recovery | 🟢 MVP (✅ undo/redo and Trash) | Snapshots ⚪ Later |
| 21 | Essential Quality-of-Life Features | 🟢 MVP | Autosave, save status, backups, project search |
| 22 | Features Explicitly Outside the Planned Scope | ⛔ | |
| 23 | Decisions Still to Be Made | ✅ Mostly decided | See [`DECISIONS.md`](DECISIONS.md) |
| 24 | Development Philosophy and Next Steps | — | Currently at Stage 4 → 5 |

### Design references

- **Milanote:** reference for the organization layer (cards on boards, nested boards with covers, breadcrumb navigation, drag-in-anything, low-chrome UI).
- **Figma:** reference for how the canvas feels (panning, zoom-to-cursor, fit-to-content, marquee selection, transform handles, smart guides and snapping, align/distribute, grouping, locking, layer order, command palette).

When a UX detail is unspecified, default to Milanote's behaviour for organization and Figma's for canvas interaction.

---

## 1. Project Overview

The goal is to create a desktop creative workspace inspired by Milanote, designed primarily for artists, illustrators, comic creators, manga creators, writers, and other visual storytellers.

The application will combine infinite visual canvases, interconnected boards, notes, reference images, document viewing, artwork management, and project organization into one flexible environment.

It should support the creative process from brainstorming and research through planning, reviewing, and organizing finished work.

### Core Design Principles

- **Creative freedom:** Users should not be forced into predefined organizational structures.
- **Art-focused but not manga-exclusive:** All features should be available in every project.
- **Visual organization first:** Infinite canvases are the foundation of the application.
- **Optional structure:** Tools such as grids, guides, tags, and templates should assist users without becoming mandatory.
- **Original file preservation:** The application should organize and display artwork without altering the original files.
- **Review over creation:** Dedicated art and writing programs will handle most content creation.
- **Expandable design:** The application should be structured to accommodate additional features later.
- **No integrated AI:** AI may assist with developing the application, but no live AI functionality is planned inside it.

The application is not intended to replace Clip Studio Paint, Procreate, Photoshop, Microsoft Word, or professional drawing and writing software.

---

## 2. Platform and Multi-Window Support

> **Status:** 🟢 MVP (basic). **Decision:** Electron desktop app; the main process owns the data and broadcasts saved changes to every open window (ADR-001).

### Desktop Application

- PC-only application.
- Optimized for keyboard and mouse interaction.
- No mobile or tablet application required.
- Support standard desktop window resizing and fullscreen use.

### Multiple Windows

Users should be able to open multiple windows of the same application.

Features:

- Open separate boards in different windows.
- Access the same project from multiple windows.
- Automatically synchronize saved changes between windows.
- Independently navigate, zoom, and scroll in each window.
- Use multiple windows regardless of the number of monitors.
- Support dual-monitor setups without requiring any special configuration.

Multi-window functionality should remain relatively simple.

Advanced docking, complex window management, and dragging tabs between windows are unnecessary.

---

## 3. Projects and Organizational Structure

> **Status:** 🟢 **MVP – priority**. ✅ **Implemented in M1:** projects, main board, unlimited nested boards, library folders, sidebar trees, breadcrumb navigation. Board cover images arrive in M3. Collections are ⚪ Later.
> **Decisions:** Each project is a self-contained folder on disk with its own SQLite database and asset store (ADR-004, ADR-005). **Boards and folders are separate hierarchies:** boards nest inside boards, and folders organize the file library (ADR-011, 🟡 tentative, pending team discussion; we may return to a unified tree).

### Independent Projects

Each creative project should function as its own separate workspace.

Each project can contain:

- A main project board.
- Unlimited-style nested boards.
- Project-specific folders.
- An asset library.
- Documents and notes.
- Artwork and reference images.
- Collections.
- Tags and navigation tools.

Projects should remain independent rather than sharing one universal asset library.

### Folders and Nested Boards

Both organizational methods should exist.

**Traditional folders:**

- Organize files and materials through a folder hierarchy.
- Access folders through a sidebar or file explorer.
- Support nested folders.

**Visual nested boards:**

- Place boards inside other boards.
- Open nested boards directly from the canvas.
- Allow multiple levels of nesting.
- Navigate through the hierarchy without relying exclusively on folders.

Users should be able to organize projects visually or through a traditional file-management system.

### Collections ⚪ Later

Collections are distinct from ordinary folders.

They organize groups of content with additional viewing functionality.

Examples include:

- Manga chapters.
- Page sequences.
- Artwork galleries.
- Reference collections.

A collection can appear as an object on a board.

---

## 4. Infinite Canvas

> **Status:** 🟢 **MVP – priority**. ✅ **Implemented in M2**, with free rotation of images added in M3A and of text notes in M3B (Shift snaps to 15°). Board cards don't rotate.
> **Decisions:** Built on react-konva (ADR-003). Interaction model follows Figma conventions (ADR-012).

The infinite canvas is the primary application interface.

### Canvas Navigation

- Effectively unlimited horizontal and vertical space.
- Free panning in all directions.
- Vertical and horizontal scrolling.
- Smooth zooming in and out.
- Mouse and keyboard navigation.
- Navigation between nested boards.
- Ability to fit board contents into the visible screen area.

The canvas should not have traditional page boundaries.

### Object Manipulation

Board objects should support relevant basic interactions:

- Dragging and repositioning.
- Resizing.
- Selecting multiple objects.
- Copying and duplicating.
- Grouping and ungrouping.
- Locking objects in place.
- Adjusting object layering.
- Aligning objects.
- Moving grouped objects together.

Text notes and comments should support free rotation.

### Freeform and Structured Layouts

Freeform placement should be the default.

Optional tools should include:

- Visible grid guidelines.
- Snap-to-grid.
- Alignment guides.
- Object alignment.
- Equal spacing and distribution.
- Uniform object sizing.

Displaying guidelines should not automatically reposition objects.

Users should be able to create either completely freeform arrangements or highly organized, uniform layouts.

---

## 5. Board Object Types

> **Status:** 🟢 **MVP – priority** (Milestone M3). Build order: **Images (M3A ✅) → Text Boxes/Notes (M3B ✅) → Documents and other files (M3C ✅)**. Nested board covers moved to Later (§17).
> Checklists, Headers and Dividers, and Containers are 🟡 **deprioritized**. Tables, Connections, and Comments are ⚪ Later.

The canvas should support multiple object types.

### Text Boxes and Notes 🟢 — ✅ implemented in M3B (ADR-014)

> Rich text notes are edited directly on the canvas or in an expanded editor, with card or floating-text styles, auto or fixed height, autosave, and safe sharing between windows. **Images inside notes are not supported yet** (⚪ Later): paste images onto the canvas next to the note instead. Tables and checklists inside notes are also Later.

- Freely placed text boxes.
- Resizable text areas.
- Basic text formatting.
- Adjustable font sizes.
- Text colors and backgrounds.
- Rotatable notes.
- Short-form writing directly on the canvas.
- Ability to arrange reference images around text.
- Support images inside text cards where practical.

These are intended for character biographies, setting descriptions, worldbuilding notes, brainstorming, and similar material.

### Images 🟢 (highest priority) — ✅ implemented in M3A (ADR-013)

- Place images directly on boards.
- Move, resize, and rotate images.
- Preserve original image proportions.
- Preserve transparency.
- Open images in a full-size viewer.
- Link images to their original asset files.

### Documents 🟢 (PDF first) — ✅ implemented in M3C (ADR-015)

> PDFs are read-only cards with a first-page cover. Double-click opens a reader (continuous, single page, or two-page spread) with search, page thumbnails and the PDF's own outline. Other files are stored unchanged and shown as compact or preview cards. PDF editing, bookmarks and OCR are not included.

- Place documents on boards as file objects.
- Open documents in a dedicated viewer.
- Display documents using compact cards, covers, or previews.

### Nested Boards 🟢

- Represent other boards as clickable objects.
- Support custom covers.
- Open the linked board when activated.

### Checklists 🟡 deprioritized

- Create editable checklists.
- Add and remove checklist entries.
- Mark individual items as complete.
- Use checklists as standalone canvas objects.

### Tables ⚪ Later

- Create simple tables directly on boards.
- Add or remove rows and columns.
- Resize tables.
- Edit cell contents.
- Apply basic formatting.

Advanced spreadsheet functionality is not required.

### Headers and Dividers 🟡 deprioritized

- Create section headings.
- Add visual dividers between board areas.
- Resize and reposition headers and dividers.
- Use them to organize large canvases.

### Containers 🟡 deprioritized

- Create visual containers around related objects.
- Move related items together.
- Apply basic container styling.
- Use containers to organize reference groups, character materials, and other visual sections.

### Connections and Links ⚪ Later

- Connect objects using lines or arrows.
- Link objects to boards, documents, or other materials.
- Add website links and link cards.

### Comments ⚪ Later

- Add free-floating comments.
- Move comments anywhere on a board.
- Rotate and resize comments.
- Attach comments to specific objects when needed.

---

## 6. Document Viewing and Review

> **Status:** 🟢 MVP for **PDF viewing** — ✅ implemented in M3C (ADR-015): page navigation, continuous / single / two-page reading, search, thumbnails, the PDF's own outline, and saving the original. Bookmarks, review comments, text editing and other document formats are ⚪ Later (ADR-007, ADR-015).

The application should support large writing files without attempting to become a complete writing program.

It should comfortably accommodate substantial documents, including manuscripts or scripts hundreds of pages long.

### Document Viewer Features

- Open supported writing documents and PDFs.
- Read lengthy documents.
- Search for specific words or phrases.
- Navigate through a linked table of contents.
- Jump to chapters, headings, scenes, or sections.
- Create custom bookmarks and navigation points.
- Add comments and review notes.
- Make limited text corrections where the file format permits.
- Download the original document.

The application should prioritize reviewing and navigating documents rather than extensive editing or formatting.

A 500-page manuscript should be a dedicated document, not one enormous canvas text box.

---

## 7. Artwork and Image Handling

> **Status:** 🟢 **MVP – priority** for **JPEG/JPG, PNG, WebP and PDF**. ✅ **Implemented in M3A** for JPEG, PNG and WebP: originals stored byte-for-byte and never modified, proportional resizing only, transparency kept, full-size viewer with zoom, pan, fit, previous/next and original download (ADR-013). ✅ **Implemented in M3C** for PDFs (read-only reader) and for storing other files as generic cards with an optional image preview (ADR-015). Automatic previews for TIFF, PSD, .clip and .procreate remain ⚪ Later.

### Image Preservation

Images must never be distorted during resizing.

Requirements:

- Maintain original aspect ratios.
- Scale images proportionally.
- Preserve original image quality and resolution in storage.
- Preserve transparent backgrounds.
- Avoid automatic cropping.
- Do not reshape images.
- Do not modify original artwork files.

A person can crop one card or one stack slide by hand (ADR-019). That crop is stored on the appearance. The original file, and every other use of that file, stay unchanged. There is no filter, effect, or aspect-ratio preset.

The application is not intended to provide a general image editor.

### Full-Size Image Preview

Users should be able to open supported images in a larger viewer.

Features:

- Full-size viewing.
- Zooming.
- Panning.
- Fit-to-window viewing.
- Navigation between images in supported collections.
- Original-file downloading.

### Native Artwork File Support

The app should accept and preserve a broad range of creative file formats.

Target formats include:

- PNG 🟢
- JPEG/JPG 🟢
- WebP 🟢
- TIFF ⚪
- PSD ⚪
- PDF 🟢
- Clip Studio Paint files (.clip) ⚪
- Procreate files (.procreate) ⚪
- Other relevant artwork and export formats ⚪

Related multi-file project formats should be considered where necessary.

**Important distinction:** Storing a file does not necessarily mean the application can render it.

For formats that cannot be automatically previewed, users should be able to attach a standard image preview while keeping the original working file available for download.

The goal is broad file compatibility and preservation, not native editing support.

---

## 8. Project Asset Libraries

> **Status:** 🟢 **MVP – ✅ implemented in M4** (ADR-016). Tags are M6 (ADR-018). Bulk rename stays ⚪ Later.
> **Decision:** Imported files are **copied into the project** and stored by content hash, never modified. A library entry is the named, foldered row; many entries can share one original. Folders live in the database, so moving an entry never breaks board references (ADR-005, ADR-016).

Each project should have its own asset library.

### Asset Storage

- Store imported images, documents, and other files.
- Preserve original files.
- Maintain file metadata.
- Organize assets into folders.
- Search and filter stored assets.
- Track file sizes and overall storage usage.

### Reusable Assets

The same file should be usable on multiple boards without duplicating its original storage.

For example, a character design could appear on a character board, chapter board, and costume board while referencing one underlying asset.

Requirements:

- One original asset can have multiple board appearances.
- Each appearance can have its own position and display settings.
- Removing an appearance does not delete the original.
- Moving a file between library folders should not break references.
- Deleting an original file should warn users if it is still referenced elsewhere.

### Mass Importing

Users should be able to import large numbers of assets directly into the project's library.

Features:

- Multiple-file selection.
- Drag-and-drop importing.
- Importing entire folders.
- Preserving folder structures where possible.
- Choosing a destination asset folder.
- Bulk organization. Tagging is ⚪ Later.

Mass importing should not require placing every file onto a board.

### Storage Approach — ✅ DECIDED

~~Both local and cloud storage remain under consideration.~~

**Decided: local-first now, hybrid later** (ADR-004, ADR-005, ADR-006).

- Each project is a folder on the user's computer containing a SQLite database (`project.db`) and the copied original files (`assets/`), plus generated thumbnails and backups.
- The user chooses where the folder lives: internal drive, external drive, or a folder synced by OneDrive, Dropbox, or Google Drive (which gives free off-machine backup).
- No server or internet is needed for any MVP feature.
- A cloud backend (Supabase for database/auth/locks + Cloudflare R2 for files) will be added only when §15 collaboration or cross-device sync is built. The schema is designed for this from day one.

---

## 9. Image Stacks

> **Status:** ✅ **Implemented in M7** (ADR-019). Fixed or adaptive sizing, combine or copy, separate here or restore a saved layout, a gallery/focus viewer, per-slide tags, and a non-destructive crop. Page collections, annotations, and filters stay later.

Image stacks are a visual grouping feature for images on a board.

They are not separate assets in the project library.

### Stack Features

- Select multiple images and combine them into one stack.
- Display one image at a time.
- Click through images with navigation arrows.
- Reorder images inside the stack.
- Choose a default cover image.
- Expand the stack into a slideshow viewer.
- Separate a stack back into individual images.
- Download individual original images.

Possible uses:

- Sketch, inked, and finished artwork.
- Different character outfits.
- Character designs at different ages.
- Alternate design concepts.
- Different character expressions.
- Related visual references.

The underlying files remain independent assets.

---

## 10. Page Collections and Manga Planning

> **Status:** ⚪ Later

Page collections should organize sequential artwork.

These tools must remain available to all projects, not just manga projects.

### Page Collections

- Combine images into ordered page sequences.
- Rearrange pages.
- Add or remove pages.
- Choose collection covers.
- Navigate directly to individual pages.
- Organize pages into chapters or other sequences.

### Page Planner

- Display page thumbnails in order.
- Create empty page placeholders.
- Reserve pages before artwork is finished.
- Rearrange planned page order.
- View pages as single pages or spreads.
- Account for right-to-left and left-to-right reading.
- Plan double-page spreads.
- Plan important page turns and reveals.
- Track page counts.

### Page Replacement

- Replace rough artwork with updated versions.
- Preserve the page's position in its collection.
- Optionally preserve earlier artwork versions.
- Keep links and related organizational information intact where possible.

### Reader and Presentation Mode

Page collections should have a full-screen viewing mode similar to PowerPoint's presentation mode.

Features:

- Full-screen reading.
- Single-page viewing.
- Two-page spread viewing.
- Continuous vertical viewing.
- Page-by-page navigation.
- Thumbnail navigation.
- Zooming and panning.
- Configurable reading direction.
- Clean presentation without editing controls.

A separate review experience should allow comments and annotations to remain visible when needed.

---

## 11. Artwork Annotation and Review

> **Status:** ⚪ Later

The application should provide only lightweight annotation tools.

### Annotation Features

- Highlighting.
- Circling areas.
- Drawing simple lines and arrows.
- Adding text comments.
- Floating notes.
- Movable and rotatable comments.
- Repositioning annotations.
- Hiding or showing annotation layers.
- Removing annotations without affecting the original file.

Annotations should be non-destructive.

The application does not need painting brushes, artistic layer systems, advanced selections, or any substantial drawing functionality.

### Revision Support

- Preserve previous artwork versions when desired.
- Replace displayed artwork with updated versions.
- Review different stages of the same artwork.
- Keep review notes associated with the appropriate version where practical.

---

## 12. Tags and Advanced Searching

> **Status:** 🟢 **MVP – ✅ implemented in M6** (ADR-018). Page collections stay ⚪ Later.

A reusable tag belongs to the project. A one-off tag belongs to exactly one item. Artwork can be tagged on the original file (shared by every entry and file card), on one library entry, or on one board appearance. A board card’s tags are not the tags of the board it opens. Tags on a board do not flow onto the cards inside it.

Archive hides a reusable tag from ordinary suggestions and keeps its name reserved. Tag Trash hides it from pills and search until it is restored or permanently deleted. Restoring a tag whose name is now taken asks for a new name or cancel. Undo of an add, remove, or replace refuses when another window has changed that assignment.

Search keeps the M5 text index and adds tag filters in the database before pagination. A text match on a PDF page names the asset, entry, or appearance whose own tags matched. A tag-only search returns those items, not one row per page. Always-visible canvas tags become compact dots below 35% zoom instead of disappearing.

Tags should handle much of the application's character, artwork, and production tracking.

There should be no mandatory specialized character-tracking database.

### Two Types of Tags

**Unique tags:**

- Created for a particular item or limited purpose.
- Do not need to become permanent reusable tags.

**Reusable tags:**

- Stored in a project's tag library.
- Available across the project.
- Applicable to multiple files and objects.

### Tag Management

- Create tags.
- Rename tags.
- Remove tags.
- Apply multiple tags to an object.
- Apply tags to multiple items simultaneously.
- Use tag autocomplete.
- Use tags on artwork, documents, boards, pages, and other appropriate items.

### Advanced Tag Search

- Search by one or more tags.
- Match all selected tags.
- Match any selected tag.
- Combine tag filters.
- Filter by file or object type.
- Search across the entire project.
- Quickly locate all matching assets or objects.

Possible tags include character names, chapters, production stages, locations, themes, and review statuses.

Tags should remain customizable rather than forcing a predefined production workflow.

---

## 13. Linked Tables of Contents and Navigation

> **Status:** ⚪ Later. The conventional sidebar hierarchy is 🟢 MVP as part of §3.

The application should have a strong linked navigation system.

### Hybrid Table of Contents

Tables of contents should support both automatic and manual organization.

Features:

- Generate entries from headings or other relevant objects.
- Manually create entries.
- Edit automatically generated entries.
- Rearrange entries.
- Remove unwanted entries.
- Customize labels.

### Supported Link Destinations

A table of contents should be able to link to:

- Locations on an infinite board.
- Named canvas anchors.
- Individual objects.
- Nested boards.
- Documents.
- Document headings or bookmarks.
- Page collections.
- Specific pages where supported.

Clicking a linked board destination should navigate directly to the appropriate content.

### Named Anchors

Users should be able to designate and name specific locations on a canvas.

These locations can then be linked from a TOC or other navigation object.

### Navigation Hierarchy

The application should also support a conventional folder/sidebar hierarchy for navigating projects and nested boards.

The linked TOC is intended to reduce the need to manually navigate enormous canvases or automatically restore every previously visited canvas position.

---

## 14. Pinned Items and Workspace Navigation

> **Status:** ⚪ Later

The interface should include a section for pinned content.

### Pinned Shortcuts

Users should be able to pin frequently used materials, including:

- Tables of contents.
- Boards.
- Documents.
- Images.
- Page collections.
- Specific board locations.
- Other active project materials.

Pinned shortcuts should allow quick access without moving or duplicating the original object.

### Pinned Content Panels

The interface should support keeping useful material accessible while working elsewhere.

Examples:

- A pinned table of contents.
- A reference image.
- A checklist.
- An active document preview.

The pinning area should be collapsible to preserve canvas space.

The goal is quick navigation and access to frequently used materials rather than complicated window management.

---

## 15. Collaboration and Shared Workspaces

> **Status:** ⚪ Later. **This is the point where a cloud backend becomes necessary** (accounts, invites, permissions, edit locks, shared file hosting). Planned: Supabase (Postgres + Auth + Realtime) + Cloudflare R2 for files (ADR-006).

Projects should initially be private, with optional sharing.

### Shared Projects

- Invite collaborators to specific projects.
- Keep unrelated projects private.
- Allow collaborators to view project materials.
- Support editing and commenting permissions.
- Share boards, documents, artwork, and organizational information within the project.

### Single-Editor Collaboration

Simultaneous editing of the same item is not required.

A simpler editing model is preferred:

- One person edits a particular object or document at a time.
- Other collaborators can view it.
- Editing access becomes available when the current editor finishes.
- Saved changes become available to other collaborators.
- Different people may work on different items within the same project.

The system should prevent conflicting edits and handle interrupted editing sessions.

Live cursors, real-time coauthoring, and Google Docs-style simultaneous editing are unnecessary.

---

## 16. Plot Roadmaps

> **Status:** 🔵 Optional

**Priority: Lower / Optional**

A visual plot-roadmap feature should remain under consideration.

It would allow users to organize narrative developments through connected paths.

Potential functionality:

- Plot-event cards.
- Multiple story paths.
- Branching storylines.
- Converging storylines.
- Merging narrative threads.
- Linking plot events to other materials.
- Rearranging connected events visually.

The roadmap may be built using existing board objects and connection tools rather than requiring a completely separate system.

This feature is desirable but not essential.

---

## 17. Covers, Typography, and Appearance

> **Status:** ⚪ Later (simple board covers may ship with §3 nested boards).

### Custom Covers

Support custom cover artwork for:

- Boards.
- Nested boards.
- Documents.
- Files.
- Collections.

Users should be able to choose an image that represents the content without modifying the original file.

### Font Support

Explore support for importing custom fonts.

Desired capabilities:

- Import common desktop font formats such as TTF and OTF.
- Use imported fonts in compatible text objects.
- Apply custom typography to relevant board content.
- Preserve appropriate font behavior when opening shared projects.

Font licensing and portability will need consideration during development.

---

## 18. Quick Capture and Importing

> **Status:** 🟢 MVP for images, PDFs and other files (paste, drag-and-drop, file picker, direct library import). URL link cards are ⚪ Later.
> ✅ **Implemented:** paste screenshots, images copied in a browser and files copied in File Explorer; drag one or many files from File Explorer or a browser; file picker (M3A, M3C). The Image tool stays images-only. **M4** adds import straight into a library folder, including a whole folder, without placing anything on a board.

The application should make collecting creative references easy.

### Clipboard and Drag-and-Drop

- Copy images from a browser and paste directly onto a canvas.
- Drag images from Windows File Explorer onto a board.
- Drag multiple files into the application.
- Paste URLs to create link cards.
- Import files without manually navigating complex menus.

Imported files should be registered with the appropriate project asset library.

### Direct Library Import

Users should also be able to import files directly into folders in their asset library, without creating canvas objects.

---

## 19. Keyboard Shortcuts and Quick Commands

> **Status:** 🟢 MVP (core shortcuts in M2, command palette and shortcut sheet in M5, ADR-017).

The PC application should support efficient keyboard-driven navigation.

### Keyboard Shortcuts

Provide shortcuts for common actions such as:

- Creating notes.
- Copying and pasting.
- Duplicating objects.
- Grouping objects.
- Undo and redo.
- Searching.
- Opening boards.
- Navigating between content.
- Other frequently used actions.

### Command Search

Include a searchable command menu for quickly finding and executing available actions.

This should reduce the need to navigate menus for common operations.

---

## 20. Board History and Recovery

> **Status:** 🟢 MVP for undo/redo, trash, and project recovery points (M5, ADR-017). Board snapshots are ⚪ Later.

Users should be able to recover from mistakes and unwanted changes.

### Undo and Redo

- Undo recent actions.
- Redo undone actions.
- Support common board-editing operations.

### Board Snapshots ⚪ Later

- Save snapshots of a board's arrangement.
- Restore previous arrangements.
- Preserve recovery points before significant reorganizations.

### Deleted Content Recovery

- Deleted objects should go to a recoverable trash area when appropriate.
- Support restoration of accidentally deleted content.
- Avoid permanently deleting underlying assets merely because their board appearances were removed.

---

## 21. Essential Quality-of-Life Features

> **Status:** 🟢 MVP

These features should be considered fundamental usability requirements.

### Saving and Reliability

- ✅ Automatic saving. The header shows unsaved, saving, saved, or failed from real writes (M5).
- ✅ Visible save status, separate from backup success or failure.
- ✅ Protection against accidental data loss: WAL, a note journal, and recovery points (ADR-017).
- ✅ Reliable recovery mechanisms. Restore creates a new project. A journal that differs from a newer save is kept.
- ✅ Backup planning: hourly points only after a real change, plus manual and pre-migration points.

### Standard Editing Actions

- Copy.
- Cut.
- Paste.
- Duplicate.
- Delete.
- Undo.
- Redo.
- Multi-select.
- Bulk actions.

### Trash and Recovery

- ✅ Recycle bin: library files, library folders, and board objects, with restore and permanent delete (M4, ADR-016).
- ✅ Restore deleted content, including a folder and what was inside it.
- ✅ Removing a board object does not delete the stored file. Trashing a library entry does not remove board appearances.

### Storage Information

- ✅ Files over 100 MB are imported and called out (M4). There is no size cap.
- ✅ Project storage usage counts each stored original once.
- ✅ The library shows type, size, and a project total.

### Accessibility and Navigation

- ✅ Keyboard navigation, including a command palette and a shortcut sheet (M5).
- Reasonable accessibility support.
- Clear interaction feedback.
- ✅ Searchable interface commands (Ctrl/Cmd+K).

### Project-Wide Search

Search should work across relevant content within a project, including:

- ✅ Board names.
- ✅ Text notes.
- ✅ File names, including the middle of a name.
- ✅ Documents where text is searchable. Image-only and locked PDFs match by name. Tags are later.
- Other indexed metadata.

Search results should allow users to navigate to the matching content.

---

## 22. Features Explicitly Outside the Planned Scope

The following are not currently part of the application's intended functionality:

- A mobile application.
- A full illustration or painting program.
- Advanced image editing.
- Cropping or reshaping artwork.
- A full Microsoft Word-style document editor.
- Live AI assistants or AI generation features.
- Simultaneous collaborative editing of the same document or object.
- Advanced multi-window docking and window-management systems.
- Mandatory manga-specific project templates.
- Mandatory character databases or production-tracking systems.

The goal is to avoid duplicating functions better handled by dedicated creative software.

---

## 23. Decisions Still to Be Made

> Most of these are now decided. Full reasoning, with pros and cons, is in [`DECISIONS.md`](DECISIONS.md).

| Decision | Status | Answer |
|---|---|---|
| Programming languages and frameworks | ✅ Decided | TypeScript + React 19, Vite, Zustand, Tailwind + Radix UI (ADR-002, ADR-010) |
| Desktop application framework | ✅ Decided | Electron, built with electron-vite and packaged with electron-builder (ADR-001) |
| Database architecture | ✅ Decided | One SQLite database per project (better-sqlite3 + Drizzle ORM), cloud-ready schema (ADR-004) |
| Local, cloud, or hybrid file storage | ✅ Decided | Local-first now, hybrid later; files copied in and content-addressed (ADR-005, ADR-006) |
| Cloud storage provider | 🟡 Tentative | Cloudflare R2 (no egress fees), or Supabase Storage (ADR-006) |
| How shared projects are hosted | 🟡 Tentative | Supabase (Postgres + Auth + Realtime), added when §15 starts (ADR-006) |
| Backup and recovery implementation | ✅ Decided | Autosave + SQLite WAL + recovery points outside the project, including stored files, plus ZIP export (ADR-009, amended by ADR-017) |
| Supported document formats and limitations | ✅ Decided (v1) | PDF via pdf.js; DOCX/MD/TXT later (ADR-007) |
| Automatic preview generation for specialized art formats | ⏳ Deferred | Manual preview attachment in v1; PSD (ag-psd), .procreate/.clip embedded thumbnails later (ADR-007) |
| Custom font handling | ⏳ Deferred | Later: TTF/OTF copied into project, loaded via the FontFace API |
| Detailed interface styling | ⏳ Open | Milanote-like low-chrome UI; decided during M1 |
| Exact project and folder navigation interface | ✅ Decided (M1) | Left sidebar with a Boards tree and a Library folders tree + breadcrumb with Back/Forward/Up above the board (ADR-011, pending team review) |
| Storage limits and anticipated operating costs | ✅ Decided (for now) | $0 while local-only; roughly $0–25/month once cloud collaboration exists |
| Performance strategies for very large boards | ✅ Decided | Thumbnails by zoom level, viewport culling, Konva layer caching, lazy board loading (ADR-003) |
| Feature development order | ✅ Decided | See [`ROADMAP.md`](ROADMAP.md) (ADR-008) |
| Initial MVP scope | ✅ Decided | M0–M5 in [`ROADMAP.md`](ROADMAP.md) (ADR-008) |

These should be investigated with the developer before implementation decisions are finalized.

---

## 24. Development Philosophy and Next Steps

> **Current stage:** Stage 4 (Architecture Planning) complete → entering Stage 5 (MVP Development).

This document represents the full feature vision, not a commitment to build everything immediately.

The planned development process is:

**Stage 1 — Feature Inventory** ✅
Collect and document desired features without prematurely limiting ideas.

**Stage 2 — Feasibility Review** ✅
Evaluate each feature based on:

- Technical complexity.
- Development effort.
- Implementation cost.
- Ongoing operating cost.
- Dependencies on other features.
- Importance to the overall experience.

**Stage 3 — Scope Selection** ✅
Classify features as:

- Essential for the first working version.
- Important for later development.
- Optional enhancements.
- Too complex or impractical for available resources.

**Stage 4 — Architecture Planning** ✅
Choose the software architecture and technologies needed to build a maintainable application.

**Stage 5 — MVP Development** ⏳ Next
Build a functional initial version centered on the application's most important systems, then expand incrementally.

The overarching goal is a **flexible, PC-based visual creative workspace that can organize an entire artistic project, from early ideas and reference gathering to scripts, finished artwork, and collaborative review, without requiring users to adopt a rigid workflow.**

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | — | Original feature inventory (PDF) |
| 1.1 | 2026-10-24 | Converted to Markdown; added status badges; recorded architecture decisions (§2, §3, §4, §5, §7, §8, §15, §23, §24) |
| 1.2 | 2026-10-24 | M1 implemented (§3); boards/folders relationship decided as separate hierarchies, pending team review (ADR-011) |
| 1.3 | 2026-10-24 | M2 implemented (§4 canvas, canvas shortcuts §19, undo/redo §20); interaction model recorded (ADR-012) |
| 1.4 | 2026-10-24 | M3A implemented: images on boards (§5), JPEG/PNG/WebP handling and full-size viewer (§7), image paste and drag-and-drop (§18), image rotation (§4); WebP moved into the MVP (ADR-013) |
| 1.5 | 2026-10-25 | M3C implemented: PDF cards and reader (§5, §6), generic file cards with optional previews (§7), drop and paste of PDFs and other files (§18) (ADR-015) |
| 1.6 | 2026-10-25 | M4 implemented: library entries, folders, import, and Trash (§8, ADR-016) |
| 1.7 | 2026-10-25 | M5 implemented: recovery points, crash journals, save status, command palette, and project search (§19–21, ADR-017) |
| 1.8 | 2026-10-26 | M6 implemented: scoped tags, one-off tags, Tag Manager, Tag Trash, and tag search (§12, ADR-018) |
