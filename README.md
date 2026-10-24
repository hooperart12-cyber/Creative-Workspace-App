# Creative Workspace App

A PC desktop creative workspace, inspired by Milanote, for artists, illustrators, comic and manga creators, writers, and other visual storytellers.

It combines infinite visual canvases, interconnected boards, notes, reference images, document viewing, artwork management, and project organization in one flexible environment. The goal is to support the whole creative process, from brainstorming and research through planning, review, and organizing finished work, without forcing a rigid workflow.

> **Status:** Brainstorming / predevelopment. Nothing has been built yet.
> This README summarizes the full feature vision. The complete specification is in [`Creative Workspace App.pdf`](./Creative%20Workspace%20App.pdf) (Feature Inventory, Version 1.0).

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

## Open Decisions

These will be worked out with the developer before implementation:

- Programming languages, desktop framework, and database architecture
- Local, cloud, or hybrid storage, the storage provider, and how shared projects are hosted
- How backup and recovery are implemented
- Supported document formats, and preview generation for specialized art formats
- Custom font handling
- Interface styling and the navigation interface
- Storage limits and operating costs
- Performance strategies for very large boards
- Feature development order and initial MVP scope

---

## Roadmap

1. **Feature inventory.** Collect desired features without limiting ideas. *(Current stage)*
2. **Feasibility review.** Evaluate each feature for complexity, effort, cost, ongoing cost, dependencies, and importance.
3. **Scope selection.** Classify each feature as essential, later, optional, or impractical.
4. **Architecture planning.** Choose a maintainable architecture and technologies.
5. **MVP development.** Build the core systems first, then expand step by step.

---

**The goal:** a flexible, PC-based visual creative workspace that can organize an entire artistic project, from early ideas and reference gathering to scripts, finished artwork, and collaborative review, without requiring a rigid workflow.
