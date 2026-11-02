# M8 implementation plan

Branch: `feat/m8-connections-links-comments`, from `feat/m7-image-stacks` at `b9df529`.
PRs #11 and #12 stay open and are not retargeted.

## Model

Connections, link cards, and comments are board objects (`connection`, `link`, `comment`). They use the existing layer order, lock, group, soft delete, revision, and object tags. Geometry and destinations live in versioned, validated `data`. Comment replies live in `comment_messages`. Opt-in external preview metadata lives in `link_previews`. Boards gain `connection_display`, `crossing_style`, and `comment_view`.

Object-attached navigation is `data.navLink`. Note links use a `cw:` destination inside the existing link mark. Nothing writes into original asset files.

## Stages

1. Shared geometry, destinations, anchors, and identity remapping, with unit tests. Landed.
2. Migration `0007`, repositories, search, copy/move/delete repair, revision checks. Landed.
3. Canvas tools, connection editing, link cards, comments, panels, and navigation. Landed. Create, attach on release, endpoint drag (Alt pin, Shift group), curve and elbow handles, labels, bridge and gap drawing, style copy, comments, destination picker, object links, note links, slide-comment transfer, and the integrity panel.
4. Picture export (PNG and PDF), one-board package with comments off unless asked, integrity repair, and the stacked PR. Playwright covers connection ends, bends, labels, and overlapping lines. It does not drive the save dialog. A hand install of the Windows installer is still not done.

## Boundaries kept

No accounts, live collaboration, paragraph anchors, named connection styles, comment audit history, or board-snapshot UI. Snapshots can read these tables later. Ctrl/Cmd+K stays the command palette. Link creation is in the palette, menus, and toolbar; the link shortcut is Ctrl/Cmd+Shift+K.
