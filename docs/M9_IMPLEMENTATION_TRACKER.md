# M9 implementation tracker

Branch: `feat/m9-page-collections`, stacked on `feat/m8-connections-links-comments` at `5563b9d`.
Pull request: [#14](https://github.com/hooperart12-cyber/Creative-Workspace-App/pull/14), not merged.
Spec: `docs/M9_Consolidated_Design_Specification.md`. Decision: ADR-021.
M6 PR #11, M7 PR #12, and M8 PR #13 stay open and unmerged.

States: Not Started, In Progress, Implemented, Tested.
A row is Tested only when a unit test asserts that behavior. In Progress means the persistence for that decision exists and is not the whole feature. Roadmap boxes stay unchecked.

| Decision | State | What is in the branch |
|---|---|---|
| D01 Hybrid collections | In Progress | A collection survives when one of two canvas cards is deleted. Tested. No sidebar. |
| D02 Page entries | In Progress | Stable page ids, notes, status, and optional artwork. Showing a version leaves status `not_started`. Tested. No Planner or Reader UI. |
| D03 Sequence and spreads | In Progress | Derived numbers, wide span, locked pairs, and RTL side placement. Tested in `src/shared/collections.test.ts` and the repository reorder/lock tests. |
| D04 Dual-view Planner | Not Started | `planner_view` is stored. No grid or spread layout. |
| D05 Artwork versions | In Progress | Add a version, show it on purpose, clear it, and remove the version row without deleting the asset. Crop columns exist. No crop editor and no M7 slide import. |
| D06 Production stages | In Progress | Stages are copied from the template at creation. A later template edit does not rewrite them. `setStage` does not change overall status. Tested. No bulk edit. |
| D07 Reader | Not Started | No Reader window. |
| D08 Reader resume | In Progress | `touchReader` is the only writer. Tested. A passive close cannot call it because there is no Reader yet. Two windows are not tested. |
| D09 Folders and templates | In Progress | Nested folders, rename, move, built-in templates, and collection trash/restore. Tested. No sidebar. |
| D10 Canvas cards | In Progress | `type: 'collection'` cards can be created and one can be deleted. Tested. No compact/cover drawing. |
| D11 Staged import | Not Started | `naturalCompare` is tested. Nothing imports into a collection. |
| D12 Move, copy, recovery | In Progress | Move keeps ids. Copy, full duplicate, and structure-only duplicate are tested. Locked partners are trashed and restored together. Stale page writes throw. No app undo stack for these operations. |
| D13 Page links and comments | In Progress | Page links and comments are their own tables. A copied internal link follows the new page. Comments stay behind unless requested. Tested. Canvas navigation to a collection or page does nothing yet. |
| D14 Artwork Review | Not Started | No comparison workspace. |
| D15 Collection search | Not Started | No collection-local search. No saved views and no new project search. |
| D16 Export and packages | Not Started | |
| D17 Collection settings | In Progress | Direction, opening side, numbering start, and an explicit next collection can be saved without changing page ids. Direction and numbering were tested. No impact preview. |
| D18 Multi-window conflicts | In Progress | One stale note write is refused and the saved note remains. Tested. No second window. |
| D19 Scale and recovery | Not Started | Migration still uses the existing pre-migration recovery point. No new scanner. Virtualization is not built. |
| D20 Flat contents and bookmarks | In Progress | A contents entry keeps its page id after a reorder and is marked unavailable after trash. Tested. Bookmarks use the same table. No hierarchical contents and no camera. |
| D21 Overview | Not Started | `collectionCounts` is tested. No overview screen. |
| D22 Reader appearance | Not Started | No per-collection theme. |
| D23 Reader controls | Not Started | |
| D24 Artwork errors | Not Started | |
| D25 Bulk editor | Not Started | |
| D26 Planner thumbnails | Not Started | |
| D27 Page inspector | Not Started | |
| D28 Placeholders | In Progress | 40 placeholders keep their ids, title, and notes, and one undo soft-deletes them. Tested. Tags are not applied at insert. No page templates. |
| D29 Reference panel | Not Started | Excluded. Do not build a reference panel or split view. |
| D30 Notes and links on move/copy | Tested | Move keeps the page id. Copy remaps an internal page link, leaves an outside collection link, and omits comments. |
| D31 Planner shortcuts | Not Started | No remappable Planner shortcuts. |
| D32 Drag preview | Not Started | |
| D33 Chapter validation | Not Started | Excluded. Do not add a chapter check before Reader opens. |
| D34 Page roles | In Progress | Cover, blank, and an explicit unnumbered page are left out of the count. Tested. No role picker. |
| D35 Mixed dimensions | Not Started | |
| D36 End screen | Not Started | `next_collection_id` can be stored. No end screen and no inferred next chapter. |
| D37 Reader handoff | Not Started | |
| D38 Planner reopen | Not Started | |
| D39 New-collection dialog | Not Started | `create` accepts a name, folder, template, direction, and placeholder count. No dialog. |
| D40 CBZ and ZIP | Not Started | |
| D41 Package import | Not Started | |
| D42 Sidebar order | Not Started | Folder and collection order are stored. No sidebar and no smart folders. |

## Tests actually run

- `npm test` — 29 files, 244 tests, all passed (2026-11-05).
- `npm run lint` — passed.
- `npm run typecheck` — passed.

## Not built

Sidebar, creation dialog, Planner, Reader, Artwork Review, import, export, portable packages, command palette, and IPC. Excluded C features from the spec are not implemented.
