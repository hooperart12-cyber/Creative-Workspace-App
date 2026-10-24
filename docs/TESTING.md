# Testing Guide

This guide is for anyone checking the app by hand: the project owner, teammates, or reviewers. No coding knowledge needed for Part 1 and Part 2.

- **Part 1:** get the app running
- **Part 2:** manual test checklists, one per milestone (start with the newest)
- **Part 3:** how to report a problem
- **Part 4:** automated tests (for developers)

> **Keep this file current:** every milestone PR adds or updates its checklist here.

---

## Part 1 — Get the app

Choose **one** option.

### Option A: Windows installer (recommended for testers; no setup needed)

1. Open the repo's **Actions** tab: <https://github.com/hooperart12-cyber/Creative-Workspace-App/actions/workflows/ci.yml>
2. Click the most recent run with a green ✅ on the **main** branch (or on the PR you're reviewing).
3. Scroll to **Artifacts** at the bottom and download **windows-installer** (a `.zip`, about 130 MB). You must be signed in to GitHub with access to the repo.
4. Unzip it and run `Creative Workspace-Setup-<version>.exe`.
5. Windows will show **"Windows protected your PC"** because the app isn't code-signed yet. Click **More info** → **Run anyway**.
6. Follow the installer. Afterwards, launch **Creative Workspace** from the Start menu.

To uninstall: Windows Settings → Apps → Creative Workspace → Uninstall. Your projects are separate folders and are **not** deleted.

### Option B: Run from source (Windows or macOS)

Follow [`SETUP.md`](SETUP.md) (install Git + Node.js once), then:

```bash
git clone https://github.com/hooperart12-cyber/Creative-Workspace-App.git
cd Creative-Workspace-App
npm install
npm run dev
```

To test a specific pull request instead of `main`: `git fetch origin && git checkout <branch-name> && npm install && npm run dev`.

### Before you start

- Create a scratch folder for testing, e.g. `Documents\CW Test Projects`, so test projects don't mix with real work.
- Note which version or commit you're testing. The installer name includes the version; from source, run `git log --oneline -1`.

---

## Part 2 — Manual test checklists

Work through each step, and tick the box if the **Expected** result happens. If it doesn't, write down the step number and report it (Part 3). Keyboard shortcuts say **Ctrl** for Windows; on macOS use **Cmd** where Ctrl is listed, and **Option** for Alt.

### M2 — Canvas: navigation, arranging & drag-and-drop (≈20 minutes)

Use a fresh project (e.g. `Canvas Test`). **Ctrl** = **Cmd** on macOS, **Alt** = **Option**. A mouse with a scroll wheel is ideal; a trackpad works too.

**Creating boards**

| # | Do this | Expected |
|---|---|---|
| 2.1 | **Drag** the **Board** tile from the left toolbar onto the canvas and let go. | A board card appears centred where you dropped it, name field selected. Type `Characters`, press Enter. |
| 2.2 | **Click** the Board tile twice, naming the boards `Chapter 1` and `Worldbuilding`. | Each new card appears near the middle of the view **without covering** existing cards. |
| 2.3 | Right-click an empty spot → **New board here**. Name it `Ideas`. | The card appears at that spot. |

**Moving the view (Figma-style)**

| # | Do this | Expected |
|---|---|---|
| 2.4 | Scroll the mouse wheel / two-finger scroll on a trackpad. | The canvas pans up/down (Shift+wheel pans sideways). |
| 2.5 | Hold **Ctrl** and scroll, or pinch on a trackpad. | Zooms in/out **toward the mouse pointer** (the spot under the pointer stays put). The % in the bottom-right updates. |
| 2.6 | Hold **Space** and drag; then drag with the **middle mouse button**. | Both pan the canvas (cursor shows a hand while Space is held). |
| 2.7 | Press **Shift+1**. | Zooms to fit all cards. |
| 2.8 | Press **+**, **−**, then **Ctrl+0**. Click the **−**, **%**, **+**, **Fit** buttons. | Zoom steps in/out; Ctrl+0 and clicking the % return to 100%. The rest of the window (sidebar, text) never changes size. |
| 2.9 | With nothing selected, press the arrow keys. | The view pans. |
| 2.10 | Open a board, zoom somewhere, go back (Alt+←), then return to it. | Each board remembers where you were looking. |

**Selecting, moving, resizing**

| # | Do this | Expected |
|---|---|---|
| 2.11 | Click a card; Shift+click another; click empty space; drag a box around two cards; press **Ctrl+A**; press **Esc**. | Selection follows each action (blue outline + handles). Box-select picks cards the box touches. |
| 2.12 | Drag a card around near another card. | Red guide lines appear when edges/centres line up, and the card snaps to them. Holding **Alt** while dragging turns snapping off. |
| 2.13 | Turn on **Snap to grid** (magnet button) and drag a card. | It jumps in grid steps. Turn it off again. The dot grid can be hidden with the grid button (or **Ctrl+'**). |
| 2.14 | Select a card and press the arrow keys, then **Shift+arrows**. | It nudges 1 px, then 10 px at a time. |
| 2.15 | Drag a resize handle (corner or edge) of a selected card. | The card resizes; its title stays underneath at normal size. It can't be made tiny. |
| 2.16 | Select 2+ cards and drag one of them. | All selected cards move together. |

**Drag & drop into boards**

| # | Do this | Expected |
|---|---|---|
| 2.17 | Drag **Ideas** over **Characters** and hold it there. | Characters highlights and says "Drop to move inside". Let go: Ideas disappears from this board and appears inside Characters (sidebar updates). |
| 2.18 | Press **Ctrl+Z**. | Ideas comes back to where it was. **Ctrl+Shift+Z** redoes it. |
| 2.19 | Double-click **Characters** to open it, drag **Ideas** onto the **project name** (first item) in the breadcrumb. | The breadcrumb item highlights; on release Ideas moves up to the main board. |
| 2.20 | Back on the main board, drag a card onto a board's name **in the sidebar**. | The sidebar row highlights; on release the card moves inside that board. |
| 2.21 | In the sidebar, drag one board's row onto another board's row. Drag a library folder onto another folder, then onto the "Library folders" heading. | Boards/folders move accordingly; you can't drop a board into itself or its own children. |

**Arranging (select 2–3 cards first)**

| # | Do this | Expected |
|---|---|---|
| 2.22 | Use the floating bar at the top: align left/centre/right/top/middle/bottom; **Distribute** (needs 3); **Same width / Same height**. | Cards line up / space evenly / match the largest size. Each can be undone with Ctrl+Z. |
| 2.23 | Press **Ctrl+G** (group). Click one grouped card, then drag it. | Clicking one selects the whole group; they move together. **Ctrl+Shift+G** ungroups. |
| 2.24 | Right-click a card → **Lock**. Try to drag it and press Delete. | It doesn't move or get deleted; a 🔒 shows on it. Right-click → **Unlock** (or Ctrl+Shift+L). |
| 2.25 | Overlap two cards. Right-click the bottom one → **Bring to front**; try **Send to back**, **Ctrl+]**, **Ctrl+[**. | The stacking order changes as described. |

**Copy, cut, paste, delete, undo**

| # | Do this | Expected |
|---|---|---|
| 2.26 | Select a board that has boards inside it. **Ctrl+C**, then **Ctrl+V**. | A copy appears slightly offset. Open it: its nested boards were copied too (renaming the copy doesn't affect the original). |
| 2.27 | **Ctrl+D** on a card. | Duplicates it. |
| 2.28 | **Ctrl+X** on a card. | It fades (marked to move). Open another board and **Ctrl+V**: it moves there. (Esc cancels a cut.) |
| 2.29 | Select a card and press **Delete**, then **Ctrl+Z**. | It goes to the trash, then comes back (including anything inside it). |
| 2.30 | Use the toolbar **Undo/Redo** buttons. | Same as Ctrl+Z / Ctrl+Shift+Z; greyed out when there's nothing to undo/redo. |

**Right-click menus & windows**

| # | Do this | Expected |
|---|---|---|
| 2.31 | Right-click empty canvas; right-click a card. | Menus list the actions above with their shortcuts (⌘ symbols on macOS). |
| 2.32 | Open the same board in a second window (right-click → **Open in new window**). Move a card in one window. | It moves in the other window too. Each window keeps its own zoom/position. |
| 2.33 | Quit and relaunch the app, reopen the project. | Every card is where you left it, with the same sizes, groups and locks. |

**Feel (your opinion — most important for M2)**

- Does panning/zooming feel smooth and natural with your mouse or trackpad?
- Is dragging cards into boards easy to do on purpose and hard to do by accident?
- Anything that surprised you or felt different from Figma/Milanote?

### M1 — Boards, folders & navigation (≈15 minutes)

**Setup**

| # | Do this | Expected |
|---|---|---|
| 1.1 | Launch the app. Type `Test Manga` as the project name, click **Choose location & create**, pick your test folder. | The project opens with the project name at the top, a sidebar on the left (Boards: "Test Manga"; Library folders: empty), and an empty dotted canvas with a toolbar on its left. A `Test Manga.cwproj` folder now exists in your test folder. |

**Creating and renaming boards**

| # | Do this | Expected |
|---|---|---|
| 1.2 | Click the **Board** tile in the canvas toolbar. | A new card appears in the middle of the canvas with its name field already selected. |
| 1.3 | Type `Characters` and press **Enter**. | The card is named "Characters". It also appears under "Test Manga" in the sidebar. |
| 1.4 | Create two more boards the same way: `Chapter 1`, `Worldbuilding`. | Three cards side by side (new cards don't cover existing ones). |
| 1.5 | Right-click **Chapter 1** → **Rename**, type `Chapter One`, press **Enter**. | Renamed in both the card and the sidebar. |
| 1.6 | Click a card once, press **F2**, type a new name, then press **Escape**. | The rename is cancelled and the old name stays. |
| 1.7 | Rename a board to only spaces and press Enter. | The name doesn't change (empty names aren't allowed). |

**Nesting and navigation**

| # | Do this | Expected |
|---|---|---|
| 1.8 | **Double-click** the Characters card. | You're inside Characters. The breadcrumb reads **Test Manga › Characters**. |
| 1.9 | Create boards `Hero` and `Villain` here. Double-click **Hero** and create `Outfits` inside it. | The breadcrumb reads **Test Manga › Characters › Hero**. The sidebar shows the full nested tree. |
| 1.10 | Press **Alt+←** (or the ← button, or the mouse's back button). | Back to Characters. |
| 1.11 | Press **Alt+→**. | Forward to Hero again. |
| 1.12 | Press **Alt+↑**. | Up to Characters (the parent board). |
| 1.13 | Click **Test Manga** in the breadcrumb. | Back on the main board. The Characters card says "2 boards". |
| 1.14 | Click **Villain** in the sidebar. | Opens Villain directly. |
| 1.15 | Click the arrow next to "Characters" in the sidebar. | Its children collapse/expand. |
| 1.16 | Press **Ctrl+\\**, then press it again. | The sidebar hides, then comes back. |

**Moving boards**

| # | Do this | Expected |
|---|---|---|
| 1.17 | Right-click **Hero** (card or sidebar) → **Move to…** | A dialog lists boards. **Hero and Outfits are not in the list** (you can't move a board inside itself), and Characters is marked "(current)". |
| 1.18 | Pick **Chapter One** and click **Move**. | Hero (with Outfits inside) now lives under Chapter One in the sidebar. |
| 1.19 | Right-click **Test Manga** (the main board). | The menu has **no** "Move to…" or "Move to trash" (the main board is protected). |

**Trash**

| # | Do this | Expected |
|---|---|---|
| 1.20 | Right-click **Chapter One** → **Move to trash**. | The confirmation says it also moves the boards inside it (Hero, Outfits). |
| 1.21 | Click **Cancel**. | Nothing changes. |
| 1.22 | Click the **Worldbuilding** card once and press **Delete**. Then press **Ctrl+Z**. | Worldbuilding disappears immediately (no dialog on the canvas), then comes back with undo. Press **Delete** again to trash it for the next steps. |

**Library folders**

| # | Do this | Expected |
|---|---|---|
| 1.23 | Click **+** next to "Library folders", type `References`, press Enter. | The folder appears in the sidebar. |
| 1.24 | Right-click References → **New folder inside** → `Poses`. | Poses is nested under References. |
| 1.25 | Right-click Poses → **Move to…** → **Library (top level)** → Move. | Poses is now at the top level. |
| 1.26 | Right-click Poses → **Move to trash** → confirm. | Poses is gone. |

**Multiple windows**

| # | Do this | Expected |
|---|---|---|
| 1.27 | Right-click **Characters** → **Open in new window**. | A second window opens, showing Characters. |
| 1.28 | In window 2, create a board `Mentor`. | It appears in **window 1's** sidebar within a second. |
| 1.29 | In window 1, rename the project at the top to `Test Manga v2`. | Window 2's title and breadcrumb update too. |
| 1.30 | Navigate window 2 into **Villain**. In window 1, trash **Villain**. | Window 2 moves back to Characters by itself (no error). |
| 1.31 | Close window 2. | Window 1 keeps working normally. |

**Saving and reopening**

| # | Do this | Expected |
|---|---|---|
| 1.32 | Click **Close project**. | The start screen shows "Test Manga v2" under Recent projects. |
| 1.33 | Quit the app completely and start it again. Click the project under **Recent projects**. | Everything is exactly as you left it (boards, nesting, folders, names). There's no save button; changes save automatically. |
| 1.34 | On the start screen, click **Open project…** and select a normal folder that is *not* a `.cwproj` project. | A red banner explains it's not a Creative Workspace project. The app doesn't crash. |

**Feel and polish (your opinion)**

- Does anything feel slow, confusing, or not where you'd expect it?
- Are the sidebar and breadcrumb easy to understand?
- Anything that looks broken or misaligned at different window sizes (try making the window small, and full screen)?

### M0 — Project basics (≈5 minutes; covered again by M1 steps 1.1 and 1.32–1.34)

| # | Do this | Expected |
|---|---|---|
| 0.1 | Launch the app. | The start screen shows "New project" and "Recent projects". |
| 0.2 | Try to create a project named `CON` or `???`. | A clear error message; no project is created. |
| 0.3 | Create a project in your test folder, then try creating another with the **same name in the same folder**. | The second attempt shows "already exists". |
| 0.4 | On the start screen, click **Remove** next to a recent project. | It's removed from the list. The project folder on disk is **not** deleted. |

---

## Part 3 — Reporting a problem

Open an issue at <https://github.com/hooperart12-cyber/Creative-Workspace-App/issues/new/choose> and pick **Bug report**. It asks for:

1. **Checklist step** (e.g. "M1 step 1.30"), or what you were doing
2. **What you expected** vs. **what happened**
3. **Screenshot**, if anything looks wrong (Win+Shift+S on Windows, Cmd+Shift+4 on macOS)
4. **How you ran the app** (installer or source), **operating system**, and the **version or commit**
5. Whether it **happens every time**

Opinions and suggestions are welcome too: use **Feedback / idea**.

---

## Part 4 — Automated tests (developers)

```bash
npm test             # unit tests (run inside Electron's Node)
npm run typecheck
npm run lint
npm run format:check
```

CI runs all of these on Windows and macOS for every pull request and push to `main`.

```bash
npm run test:e2e     # end-to-end UI tests: builds the app, then Playwright drives it
```

**Current coverage:**
- **Unit tests** (Vitest):
  - main-process logic: projects, boards, folders, canvas objects (move/copy/trash/restore), multi-window registry, recent projects
  - renderer helpers: tree building, camera math, align/distribute/z-order/snapping, undo history
- **End-to-end tests** (Playwright, `e2e/`): launch the real app with a temporary settings folder and test
  - creating boards from the toolbar (click and drag-drop)
  - dragging cards and persistence after restart
  - nesting by drag-and-drop, plus undo
  - delete + undo
  - sidebar drag-and-drop for boards and folders

  Failures in CI upload a Playwright report with screenshots and traces.

**Planned (see ROADMAP):**
- Renderer store tests.
- A coverage report with a minimum threshold.

**Rule for every feature PR:**
- unit tests for its logic
- a checklist section in this file for its user-facing behaviour
- a "How to test" section in the PR description
