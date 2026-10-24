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

### M1 — Boards, folders & navigation (≈15 minutes)

**Setup**

| # | Do this | Expected |
|---|---|---|
| 1.1 | Launch the app. Type `Test Manga` as the project name, click **Choose location & create**, pick your test folder. | The project opens with the project name at the top, a sidebar on the left (Boards: "Test Manga"; Library folders: empty), and a **New board** card. A `Test Manga.cwproj` folder now exists in your test folder. |

**Creating and renaming boards**

| # | Do this | Expected |
|---|---|---|
| 1.2 | Click the **New board** card. | A new card appears with its name field already selected. |
| 1.3 | Type `Characters` and press **Enter**. | The card is named "Characters". It also appears under "Test Manga" in the sidebar. |
| 1.4 | Create two more boards the same way: `Chapter 1`, `Worldbuilding`. | Three cards, in the order created. |
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
| 1.22 | Click the **Worldbuilding** card once, press **Delete**, then click **Move to trash**. | Worldbuilding disappears from the board and the sidebar. |

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

**Current coverage:**
- Main-process logic: projects, boards, folders, multi-window registry, recent projects.
- Renderer tree helpers.

**Planned (see ROADMAP):**
- End-to-end UI tests with Playwright driving the real Electron app, automating the Part 2 checklists.
- Renderer store tests.
- A coverage report with a minimum threshold.

**Rule for every feature PR:**
- unit tests for its logic
- a checklist section in this file for its user-facing behaviour
- a "How to test" section in the PR description
