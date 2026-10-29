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

### M8 — Connections, links, and comments (in progress)

Use a project that already has two image cards on one board, plus a second board. M8 is not finished. A failed step in this table is a bug. Anything in **Not ready yet** is unfinished work, not a regression.

| # | Do this | Expected | A failure looks like |
|---|---|---|---|
| 8.1 | Press L. Drag from the middle of one card to the middle of the other, then release. | A line appears with an arrow at the end you released. Move either card: that end stays on the card. | The line is missing, both ends stay where you released even after the card moves, or only the start sticks. |
| 8.2 | Press L again. Drag from a card and release on empty canvas. | The start stays on the card. The other end stays on the empty spot when you move the card. | Both ends move with the card, or the free end jumps onto a nearby card you did not release on. |
| 8.3 | Press L and start a drag, then press Escape before you release. | No connection is created. The tool returns to the normal pointer. | A line appears anyway, or L stays stuck on. |
| 8.4 | Select a card. Drag the blue dot on its right edge to another card. | A connection is created without pressing L first. | The card moves instead, or nothing is created. |
| 8.5 | Select the connection. Open Properties (P on the toolbar). Change path, color, and width. Press Swap markers. On an elbow path, turn on Avoid objects. | The line updates. Undo once puts the previous look back. Endpoints stay put. | Undo restores only part of the change, or the ends detach. |
| 8.6 | In Properties, set Connections to Hide connections, then back to Adaptive. | Hidden lines disappear. Selecting a connection still shows it. Adaptive is not a delete: showing them again brings the same lines back. | The connections are gone from the board after you show them again. |
| 8.7 | Press C on empty canvas, type a note, and press Ctrl+Enter. | A comment card appears with that text. Escape on an empty draft cancels it. Escape with text asks before discarding. | The letters change the canvas tool, or the comment vanishes after you click away. |
| 8.8 | Press C on a stack that is showing a slide. Leave “This slide”, post, then switch the stack to another slide. | The comment is gone from the canvas. Open Comments and jump to it: the stack shows that slide again. | The comment stays on every slide, or jump opens a different slide. |
| 8.9 | In the same composer, choose “The whole stack” and post. | That comment stays while you change slides. | It disappears on the next slide. |
| 8.10 | Press Ctrl+Shift+K. Search for the other board and choose it. Double-click the new card. | The other board opens. Ctrl+K still opens the command palette, not this picker. | Ctrl+K opens the picker, or the card opens a website. |
| 8.11 | Ctrl+Shift+K, type `https://example.com`, and choose Add website. Double-click the card. | It opens in your browser. `http://127.0.0.1` is refused. | The address loads inside the canvas, or a private address is accepted. |
| 8.12 | Copy `https://example.com` and paste on empty canvas. Then paste a picture the same way. | The address becomes a link card. The picture still becomes an image, not a link. | The picture is replaced by a link, or the address is ignored. |
| 8.13 | Delete a card that a connection is attached to. Undo. | The connection remains. After undo, the end is on the card again. | The connection is deleted with the card, or undo leaves the end loose. |

**Not ready yet.** Do not file these as bugs until a later M8 build says they work: dragging an endpoint to a new target, curve and elbow handles, a label you can type on the line, bridge and gap drawings (Gap currently only dashes an unselected line), a link stored on an existing card, a link inside a note, Duplicate with Comments, comments following a slide that is extracted or moved to another stack, a Project Integrity panel, and exporting one board as a package or a picture. Whole-project zip export already includes the database, so connections stored there are in the zip, but that is not a separate board-share file.

### M5 — Recovery, search and commands (≈30 minutes)

Use a fresh project. Have ready: a text PDF, a PNG, and a text file. The Windows installer steps use a packaged build, not `npm run dev`.

**Saving and recovery**

| # | Do this | Expected |
|---|---|---|
| 5.1 | Type in a note and watch the header. | It shows Saving…, then Saved. There is no Save button. |
| 5.2 | Open **Backup**. | It names the vault folder, how much it stores, and whether that folder is on the same drive as the project. |
| 5.3 | Choose **Back up now**, then **Verify** on that point. | A manual point appears. Verify says it passed. |
| 5.4 | Trash a file, delete it permanently, then restore an earlier point as a new project. | The original project stays without that file. The new project has the file and can be opened beside the original. |
| 5.5 | Export a ZIP, then import it as a new project. | The copy opens and contains the files. It does not point at the vault. |
| 5.6 | Type in a note and force-quit before it says Saved. Reopen the project. | The draft is offered. If you saved a different version in another window first, you can restore the draft as a copy. A harmless quit shows no dialog. |
| 5.7 | Leave the app open for an hour after a change, and for an hour with no changes. | A point appears only after the hour that had a change. |

**Search and commands**

| # | Do this | Expected |
|---|---|---|
| 5.8 | Press Ctrl+K (Cmd+K on macOS) and run a command. Press Ctrl+/ . | The palette finds commands and files. The shortcut sheet lists them. Neither opens while you are typing in a note. |
| 5.9 | Press Ctrl+Shift+F and search a note. | The board opens with that note selected. |
| 5.10 | Search a PDF phrase, and an image that is only in the library. | The PDF opens on the matching page with the words highlighted. The image opens in the viewer and no new card appears. |
| 5.11 | On a file that is on a board, choose **Used on boards**. | The list shows active boards only. Choosing one opens that board and frames the card. |
| 5.12 | Trash a file, then search its name. | It does not appear. |

**Packaged Windows install**

These steps are not claimed as already done. Run them on a real PC with the installer from CI.

| # | Do this | Expected |
|---|---|---|
| 5.13 | Install the `.exe`, create a project, import a PNG, and make a recovery point. | The app starts. The point verifies. |
| 5.14 | Quit from the window close button, reopen, and search the PNG by part of its name. | No recovery dialog. The image is found. |

### M6 — Tags and advanced search (≈40 minutes)

Use a fresh project. Have ready: one PDF with text on two pages, and one image. Open the project in two windows for the undo steps.

**Creating and scoping tags**

| # | Do this | Expected |
|---|---|---|
| 6.1 | Press Ctrl+K and open **Tag manager**. Create a reusable tag named `Hero`. | It appears in the list with 0 uses. |
| 6.2 | Create `hero` again. | The app says that name already exists. |
| 6.3 | Archive `Hero`, then try to create `hero`. Unarchive it. | The archived tag keeps the name. After unarchive, new assignments can suggest it again. |
| 6.4 | Import the image twice so the library has two entries of one original. Tag only the first entry `Cover`. Tag the original `Hero` with **On the original**. | The first entry shows both. The second shows `Hero` only. A card of that file shows `Hero`, not `Cover`. |
| 6.5 | Place the PDF on two boards. Tag the first card `Alpha` and the second `Beta`. | Each card shows only its own tag. |
| 6.6 | Right-click a board card. Use **Tag this board card**, then **Tag linked board** with a different tag. | The card does not pick up the linked board’s tag. Opening the linked board shows only its own tag. |
| 6.7 | On one item, create a one-off tag. In Tag manager, promote it. | It becomes a reusable tag on that item. If a reusable tag with that name is in Tag Trash, the app asks before restoring it. |

**Search**

| # | Do this | Expected |
|---|---|---|
| 6.8 | Search with no words and the tag `Alpha`. | The first PDF card appears once. The other card does not, and there is not a row for every page. |
| 6.9 | Search the PDF’s words together with `Alpha`, using **Direct only**. | The matching page opens on the first card’s board, with the page and highlight kept. The second card is not a result. |
| 6.10 | Search `Hero` with **Including original**, then again with **Direct only**. | Including original lists the original and the entries or cards that show it. Direct only lists the item the tag was actually assigned to. |
| 6.11 | Search two tags with **All tags**, then **Any tag**, then **Not**. Choose **This board**, then **This folder**. | All requires every tag. Any requires one. Not excludes that tag. Board and folder results stay inside that scope. |
| 6.12 | Tag more than 50 notes with one tag and search for that tag. Choose **Load more**. | The first page is 50 notes. The rest appear after Load more, without the untagged note. |

**Canvas, trash, and undo**

| # | Do this | Expected |
|---|---|---|
| 6.13 | Set **Tag visibility** to Hover, Always, then Hide. Zoom out below 35% while Always is on. Reopen the project. | Hover shows tags on the selected or hovered card. Always shows labels, and dots when zoomed far out. Hide shows none. The choice is still there after a restart. Dragging and resizing still grab the card, not the label. |
| 6.14 | Select several cards, some already tagged. Add a tag, remove a tag, and replace direct tags. | Add leaves other tags. Remove takes only the chosen tag. Replace asks first and changes only the direct tags. |
| 6.15 | In one window, add a tag. In the other window, remove that same tag. Undo in the first window. | Undo does not put the tag back over the other window’s removal. A message says the tags changed in another window. |
| 6.16 | Trash a tagged file and restore it. Then delete it permanently. | Restore keeps the tags. Permanent delete removes that item’s assignments and its one-off tag. A reusable tag used on something else remains. |
| 6.17 | Move a tag to Tag Trash, create a new tag with the same name, and restore the trashed one. | Restore offers a new name or cancel. It does not overwrite the new tag. Permanent delete removes the trashed tag and its assignments. |
| 6.18 | Make a recovery point, then open a copy of an older project file if you have one. Export a ZIP and import it. | The copy contains the tags. An older project is backed up before its database is updated, and existing tags are not dropped. |

### M7 — Image stacks and cropping (≈45 minutes)

| # | Do this | Expected |
|---|---|---|
| 7.1 | Place two images and choose Combine into stack. | The cards leave the board. One stack remains, in left-to-right then top-to-bottom order. The files stay in the library. |
| 7.2 | Undo, then Create stack copy. | The original cards come back. A copy leaves the cards on the board and cannot restore a layout. |
| 7.3 | Use the arrows and the counter. Click empty canvas, then the artwork. | Arrows show while the stack is hovered or selected, wrap around, and do not drag the stack. A click on the artwork selects it. |
| 7.4 | Zoom out below 35%. | The arrows hide. The stack still draws. |
| 7.5 | Drag a thumbnail to a new place in the stack editor. Also use Up and Down. Set a different cover. | The order changes. The cover stays the image you chose. |
| 7.6 | Turn remember-last off, change the canvas image, switch boards, then reopen the project. | While the project stays open the canvas image remains. Reopening shows the cover. |
| 7.7 | Open the stack. Switch Gallery and Focus. Use previous, next, the arrow keys, Fit, and 100%. Zoom and pan. | The viewer opens on the canvas image. Browsing, zooming, and panning do not change that image. The picture is the original file, cropped for this slide. |
| 7.8 | Drop a canvas image on the stack. Choose Move, then try Copy. | Move removes the card. Copy leaves it. Cancel puts the card back. A library drop adds a reference and does not ask. |
| 7.9 | Remove a slide, then extract another. | Remove leaves no new card. Extract places a card. The file stays. A one-image stack and an empty stack both remain. |
| 7.10 | Separate here, undo, then Restore original layout on a combined stack. | Separate keeps each slide’s current crop. Restore uses the crop and position from before the combine, including later slide crops that are not copied back. |
| 7.11 | Crop one card and the same file on another card. Reset one crop. | Only that appearance changes. The stored file is unchanged. Resize keeps the crop. |
| 7.12 | Tag the stack OPU and one slide Approved. Tag another slide Draft. Search OPU and Approved, then Draft and Approved. | The first slide matches. The two sibling tags together do not. Direct-only does not treat the stack tag as the slide’s own tag. |
| 7.13 | Open the matching slide from search. Close the preview, then use Keep displayed. Also click the stack name above the slides when the stack itself was not a match. | The stack name is the real name and opens the stack. A slide opens that slide. The preview does not overwrite the saved image until Keep displayed. The cover does not change. |
| 7.14 | Duplicate the stack. Delete the stack. | The copy has its own slides and tags. Deleting the stack removes the board object, not the file. |
| 7.15 | Change the stack in a second window, then undo in the first. | The undo is refused and the newer edit remains. |
| 7.16 | Make a recovery point and export a ZIP. Open an older project. | Slides, crops, and tags come back. An older project is backed up before migration. |
| 7.17 | Windows and macOS CI, plus the Windows installer. | CI is green, including the installer artifact. Installing that installer on a real PC is still a manual step. |

### M4 — Project asset library (≈35 minutes)

Use a fresh project. Have ready: a folder of mixed files (a JPG, a PDF, a text file, and an empty subfolder), one file larger than 100 MB if you have one, and a second copy of the JPG under another name.

**Browsing**

| # | Do this | Expected |
|---|---|---|
| 4.1 | In the sidebar, click **Open library**. | The canvas is replaced by the library. Go back to the canvas and the view is where you left it. |
| 4.2 | Expand a folder in the sidebar. | Its files are listed there (name and a small mark). There is a filter box. |
| 4.3 | Switch between **Grid** and **List**, and change the sort. | The same files stay selected. Name, date, size, and type each sort both ways. |
| 4.4 | Search, then switch between **This folder** and **Whole library**. | The words you typed stay. This folder includes subfolders. Whole library searches everywhere. |
| 4.5 | Turn on **Unfiled**, then click one file. | Only files that are not in a folder show. The details list the original filename, type, size, pixel size or page count, import date, and folder. |

**Import**

| # | Do this | Expected |
|---|---|---|
| 4.6 | Choose **Import**, pick a destination folder, leave **Skip** and **Keep folders**, and choose the mixed folder. | Files are copied in. Nothing new appears on the board. The empty subfolder is created. Progress counts found, imported, skipped, and failed. |
| 4.7 | Import the same folder again with **Skip**. | The message says the files are already in the library. No second copy is stored. |
| 4.8 | Import the renamed JPG with **Add another entry**. | A second name appears. Storage still counts the bytes once. |
| 4.9 | Import two different files that share a name. | Both are kept. |
| 4.10 | Start an import and press **Cancel** after it has begun. | Files already finished stay. The message does not claim the rest were imported. |
| 4.11 | If you have a file over 100 MB, import it. | It is imported, and a message says it is over 100 MB. |
| 4.12 | Drop a library file onto the canvas. Drag the same file from the sidebar onto another board. | Each board gets a card. The project still has one stored original. |
| 4.13 | Delete one of those cards and press Ctrl+Z. | The card goes away and comes back. The library file stays the whole time. |
| 4.14 | Move the library file into another folder, and rename it. | Both cards still show the picture. Ctrl+Z undoes the rename and the move. |

**Folders and trash**

| # | Do this | Expected |
|---|---|---|
| 4.15 | Trash a folder that contains files, including one that is on a board. | The dialog tells you how many files and folders, and that board appearances stay. The folder and its files leave the library. The card stays. |
| 4.16 | Choose **Delete folder only** when a child has the same name as something in the parent. | You can cancel, or keep both and see a “ (2)” name. |
| 4.17 | Open **Trash**. Restore the folder. | The folder and the files that were inside it come back. |
| 4.18 | Trash a folder that has a folder inside it. In Trash, restore only the inner folder. | You are asked where to put it, because its parent is still in Trash. Choosing Library puts it at the top. |
| 4.19 | Trash a file that is on a board, then **Delete permanently**. | The file row is gone. The stored file stays, and the message says a board still uses it. |
| 4.20 | **Empty trash** after removing the card as well and trashing the file again. | Confirming removes the stored file. This cannot be undone. |
| 4.21 | Open a second window, trash a file there, and press Ctrl+Z in the first window for an older library action. | The first window does not undo the other window’s trash. |

### M3C — PDFs and other files (≈40 minutes)

Use a fresh project. Have ready: a text PDF of a few pages that has a table of contents, a long PDF (a few hundred pages if you have one), a PDF that is only scanned images, a password-protected PDF if you have one, a JPG or PNG, and a few other files (for example `.txt`, `.psd`, `.clip`, `.zip`, and an `.exe` or `.bat` you can spare — they will not be run).

**Adding files**

| # | Do this | Expected |
|---|---|---|
| 3C.1 | Click the **File** tool and choose the PDF and the text file. | Both appear. The PDF is a card with its name and a picture of the first page (it may take a moment). The other file is a small card with an icon, its name, its type and its size. |
| 3C.2 | Drag several files onto the canvas at once, including one you renamed to `.pdf` that is not really a PDF, and an empty file. | The real files appear. A message lists the ones that were skipped and why. The rest are not lost. |
| 3C.3 | Click the **Image** tool and choose the PDF. | It is not added. The message says it is not a JPG, PNG or WebP image. |
| 3C.4 | Copy the text file in File Explorer and press **Ctrl+V** on the canvas. | A file card appears for it. |

**PDF cards and the reader**

| # | Do this | Expected |
|---|---|---|
| 3C.5 | Select the PDF card and look for a rotation handle. Drag a corner. | There is no rotation handle. Resizing keeps the page's shape. |
| 3C.6 | Double-click the PDF (or select it and press **Enter**). | A reader fills the window. It shows the name, the page, and the page count. The board is gone until you close it. |
| 3C.7 | Use **Next**, **Prev**, and type a page number. Switch **Continuous**, **Single** and **Two-page**. | You move through the pages. Two-page shows page 1 alone, then pairs. A last leftover page sits alone. The page you were on stays put when you switch, when it can. |
| 3C.8 | In two-page mode, switch the reading direction to right-to-left, then back. | The two pages swap sides. The page order of the file does not change. |
| 3C.9 | Try **Fit width**, **Fit page**, **100%**, and the zoom buttons. | The page refits. Text on the page stays selectable on a text PDF; you can copy it. |
| 3C.10 | Open the sidebar. Click a page thumbnail, then **Outline**, then a heading. | Thumbnails highlight the page you are on. A heading jumps to that page. If the PDF has no outline, the sidebar says so and does not invent one. |
| 3C.11 | Search for a word you know is in the PDF. Use **Next match** and **Prev match**. Then search for a word that is not there. | Matches are counted and highlighted, and the view moves to them. A missing word says **No matches**. |
| 3C.12 | Open the image-only PDF and search for any word. | The pages still display. Search says **No searchable text**. |
| 3C.13 | Press **Delete** while the reader is open, then **Esc** or **Close**. | The card is not deleted. Closing returns you to the same board, in the same place, with the same selection. |
| 3C.14 | Open the PDF again and click **Open in new window**. Change the page and the view mode there. Close that window. | The new window has its own page and mode. The first window is unchanged. Closing the extra window leaves the project and the first reader open. |
| 3C.15 | Click **Save original as** and pick a place. | The saved file opens in a PDF reader outside the app and matches the original. |
| 3C.16 | If you have a password-protected PDF, open it, then cancel, then open it again and enter the password. Quit and reopen the project and open it once more. | Cancel leaves the card. The right password shows the pages. You are asked again next time; the password is not remembered. |
| 3C.17 | Open a PDF of a few hundred pages and scroll. | The app stays responsive. Pages appear as you reach them, not all at once. |

**Other files**

| # | Do this | Expected |
|---|---|---|
| 3C.18 | Double-click a file card (not a PDF). | A details window shows the name, type and size, and **Compact** / **Preview**. |
| 3C.19 | Click **Attach preview** and choose a JPG, PNG or WebP. Switch to **Preview**, then back to **Compact**. | Preview shows the picture without cropping or stretching it, plus the filename. Compact shows the icon again. The picture is still attached. |
| 3C.20 | Click **Change preview**, then **Remove preview**. | The picture changes, then the card says there is no preview. The image file you attached is still in the project if you used it only as a preview (it is not deleted). |
| 3C.21 | Duplicate the file card (**Ctrl+D**). | A second card appears. Both refer to the same file (the project does not store the file twice). |
| 3C.22 | Click **Save original as**. | You get a copy of the original bytes. |
| 3C.23 | Click **Open a copy**, choose an empty folder, and edit that file in another app. Come back. | The app says edits in the other app do not update the project. The card is unchanged. The file that opened is in the folder you chose, not a file named with a long hash. |
| 3C.24 | Open details for the `.exe` or `.bat`. | **Open a copy** is unavailable and explains why. The file is not launched. |
| 3C.25 | Quit and relaunch, then reopen the project. Open the board in a second window. | PDF cards, file cards, their size, and any preview are still there in both windows. |

**Feel**

- Is the reader comfortable for a long document?
- Is it obvious that **Open a copy** will not change the file in the project?

### M3B — Text notes (≈30 minutes)

Use a fresh project (e.g. `Notes Test`) with a board card and an image on it. Have a web page with formatted text open (a Wikipedia article works well), and a word processor if you have one.

**Creating and typing**

| # | Do this | Expected |
|---|---|---|
| 3B.1 | Double-click an empty spot on the canvas and type a few words. | A note appears where you clicked, with a blinking cursor, and grows as you type. A small bar above it shows formatting buttons and **Saved** / **Saving…**. |
| 3B.2 | Click an empty spot on the canvas (or press **Esc**). | Editing finishes and the note stays, looking exactly as it did while typing (the text doesn't jump). |
| 3B.3 | Press **T**; click the **Text** tool in the left toolbar; drag the **Text** tool onto the canvas; right-click empty canvas → **New text here**. | Each makes a new note ready for typing: in the middle of the view, or where you dropped or right-clicked. |
| 3B.4 | Make a new note and finish editing without typing anything. | The empty note disappears again. |
| 3B.5 | Click a note once, then double-click it in the middle of a word. | One click only selects it (handles appear). Double-click starts editing with the cursor **where you clicked**. **Enter** on a selected note also starts editing. |

**Formatting**

| # | Do this | Expected |
|---|---|---|
| 3B.6 | Select some words and try **B**, **I**, **U**, **S**, **Ctrl+B / I / U**, highlight, bulleted and numbered lists, and the **Text style** menu (Heading 1–3). | Each applies to the selection. Lists indent with **Tab** and come back with **Shift+Tab**. |
| 3B.7 | Click **More formatting** (the **Aa…** button). Under **Selected text**, change font, size, colour and highlight; try each alignment, line spacing and **Space after**. Then select it all and click **Clear formatting**. | Changes show immediately in the note. Fonts list four **Included with the app** fonts and, below, fonts **On this computer**. Clear formatting removes bold, colours, fonts and sizes but keeps links. |
| 3B.8 | Select a word, press **Ctrl+K**, type `example.com`, press Enter. Then try adding `javascript:alert(1)` as a link. | The word becomes a link to `https://example.com`. The unsafe address is refused with a message. |
| 3B.9 | Click the link normally, then **Ctrl+click** it (while editing and again after finishing). | A normal click just places the cursor or selects the note. Ctrl+click opens your web browser. |
| 3B.10 | Finish editing and look closely at the note at 100%, 200% and 50% zoom. | The canvas shows the same formatting, line breaks and spacing as the editor did. Zoomed far out, text turns into grey lines. |

**Look and size**

| # | Do this | Expected |
|---|---|---|
| 3B.11 | In the panel under **Whole note**, switch **Style** between **Card** and **Floating text**; change background, opacity, border, corners, shadow and padding. Then click **Reset appearance**. | Floating text has no background or border; the text itself doesn't move when switching. Reset brings back the plain card, keeping the text and its formatting. |
| 3B.12 | Select a note (not editing) and drag its side handle to make it narrower and wider. | Text re-wraps; letters never stretch or squash. The height follows the text. Only side handles are shown. |
| 3B.13 | In the panel, set **Height** to **Fixed height**, then drag the bottom handle up so text is hidden. Scroll the mouse wheel over the selected note. Then click **Fit to content**. | Hidden text scrolls inside the note (the canvas doesn't move). Fit to content makes the note exactly tall enough again. |
| 3B.14 | Rotate a note with the round handle (with **Shift** for 15° steps), then double-click to edit it. | It rotates like an image. The editor appears rotated in place and typing works. |
| 3B.15 | Zoom out to about 20% and double-click a note. | The view zooms to 100% around the note so you can read what you type. |
| 3B.16 | Click **Expand note** (or **Ctrl+Shift+E**). Type, then press **Esc** or the button to go back. | A large editor opens with the same text and cursor. Changes appear on the canvas note. **Ctrl+Z** still undoes typing done before expanding. |

**Paste and keys**

| # | Do this | Expected |
|---|---|---|
| 3B.17 | Copy a formatted paragraph (with a heading, bold and a link) from a web page or word processor and paste it into a note. | Headings, bold, italics, lists and links come through; the page's fonts and colours don't. |
| 3B.18 | Paste the same thing with **Ctrl+Shift+V**. | Plain text only. |
| 3B.19 | Copy an image (or take a screenshot) and press **Ctrl+V** while editing a note. Then finish editing and press **Ctrl+V** on the canvas. | Nothing goes into the note; a message suggests pasting it on the canvas. On the canvas, the image is added as usual. |
| 3B.20 | Copy some text, click empty canvas (not editing) and press **Ctrl+V**. | No note is made: canvas paste is for images and files. |
| 3B.21 | While editing, press **Ctrl+A**, **Delete**, **T**, **+**, **−**, the arrow keys and **Ctrl+Z**. | They only affect the text: Ctrl+A selects all the text, Delete deletes characters, letters type, arrows move the cursor. Nothing on the canvas changes, moves or zooms. |
| 3B.22 | Edit an existing note: type a sentence, finish editing, move the note, then press **Ctrl+Z** twice and **Ctrl+Shift+Z** twice. | The first undo puts the note back, the second removes the whole sentence in one step; redo brings them back in order. |

**On the canvas**

| # | Do this | Expected |
|---|---|---|
| 3B.23 | On notes, try everything from M2: move, arrow-key nudge, group with the image, align, layer order, copy/paste, duplicate, cut and paste on another board, Delete + Ctrl+Z, lock (a locked note can't be edited). | All work as for other objects. |
| 3B.24 | Right-click a note. | **Edit text**, **Expand note**, **Show as floating text** / **Show as card**, **Reset appearance** (and **Fit to content** for fixed-height notes), plus the usual items. |

**Keeping your work safe**

| # | Do this | Expected |
|---|---|---|
| 3B.25 | Type a long paragraph quickly without stopping. Watch the status. | It shows **Saving…** then **Saved** within a few seconds, even while you keep typing. |
| 3B.26 | Type a few words and **immediately** close the window (✕). Reopen the project. | The words are there. |
| 3B.27 | Quit and relaunch the app, then reopen the project. | Every note is back with its text, formatting, look, size, rotation and position. |
| 3B.28 | Open the board in a second window. Edit a note in window 1. | Window 2 shows **✎ Editing in another window** on that note and updates as window 1 saves. |
| 3B.29 | In window 2, double-click that note, then click **Edit here instead**. | Window 1's typing is saved and it becomes read-only ("Another window is editing this note now…"). Window 2 can now edit, starting from window 1's latest text. |
| 3B.30 | While window 1 is editing a note, select it in window 2 and press **Delete**. | Window 1 says the note was moved to the trash and offers **Keep my text as a new note** or **Discard**. Keep makes a new note with the text. |

Conflicting saves (**Keep mine / Use theirs / Keep both**) and failed saves (**Couldn't save**, **Try now**) are hard to trigger by hand; the automated tests cover them.

**Feel (your opinion — most important for M3B)**

- Does typing on the canvas feel natural? Is anything about the cursor, selection or scrolling awkward?
- Are the quick bar and the formatting panel easy to find and use? Anything missing that you reach for often?
- Do the notes look good next to images at different zoom levels?

### M3A — Images (≈25 minutes)

Use a fresh project (e.g. `Image Test`) with one or two board cards on it.

**Collect some test files first** (put copies in a scratch folder):
- a large photo, ideally taken **in portrait on a phone** (these are stored sideways with a "rotate" tag)
- a **PNG with a transparent background** (a logo or cut-out character)
- a **WebP** image (many websites serve them; "Save image as…" in a browser often gives `.webp`)
- a **very tall or wide** image (a comic strip, a long screenshot)
- a file the app can't use yet: `.psd`, `.tif`, `.pdf` or `.txt`
- optionally, a folder of 20+ large images

**Adding images**

| # | Do this | Expected |
|---|---|---|
| 3A.1 | Click the **Image** tool in the left toolbar and choose 2–3 images. | They appear in the middle of the view, side by side in a grid, **next to** (not on top of) existing cards, and stay selected. Big images arrive at most 800 px on their longest side at 100% zoom. |
| 3A.2 | Drag **one** image file from File Explorer onto the canvas. | It appears centred where you dropped it. |
| 3A.3 | Drag **several** files at once, including the unsupported one. | The images appear. A yellow message near the bottom lists the unsupported file with the reason ("Not a JPG, PNG or WebP image."). It closes after a few seconds or with **Dismiss**. |
| 3A.4 | In a web browser, right-click an image → **Copy image**. Click the canvas, press **Ctrl+V**. | The image appears in the middle of the view. (Its name in the viewer is "Pasted image" plus the date and time.) |
| 3A.5 | Take a screenshot with **Win+Shift+S** (or Print Screen), then press **Ctrl+V** on the canvas. | The screenshot is added. |
| 3A.6 | In File Explorer, select one or more image files and press **Ctrl+C**. Press **Ctrl+V** on the canvas. | The files are added under their own names. |
| 3A.7 | Drag an image straight from a web page onto the canvas. | It's added (most browsers allow this; if one doesn't, copy and paste works instead). |
| 3A.8 | Right-click an empty spot → **Add images here…** | The chosen images are placed at that spot. |
| 3A.9 | Right after adding several images, press **Ctrl+Z**, then **Ctrl+Shift+Z**. | All images from that one import disappear together, then come back. |
| 3A.10 | Copy one image in the app (**Ctrl+C**), then copy something in a browser, then press **Ctrl+V** in the app. | You get the **browser's** image (the newest copy), not the old one. Copy an image in the app again and **Ctrl+V**: you get a copy of the app image. |

**Does it look right?**

| # | Do this | Expected |
|---|---|---|
| 3A.11 | Put the transparent PNG over the dot grid and partly over another image. | Transparent parts show what's behind them. No white or black box. |
| 3A.12 | Look at the portrait phone photo. | It's upright, not sideways. |
| 3A.13 | Zoom far in on a large image (Ctrl+wheel), then far out. | Up close it's sharp (a brief soft moment while the full-quality version loads is fine). Zoomed out, panning stays smooth. |
| 3A.14 | Optional: add 20+ large images at once. | The app stays responsive; "Importing…" shows if it takes more than a moment. Panning and zooming afterwards stay smooth. |

**Resizing and rotating**

| # | Do this | Expected |
|---|---|---|
| 3A.15 | Select an image. Drag a corner handle, making it much bigger and much smaller. | Only corner handles are shown. The image always keeps its shape (never stretches or squashes) and has no maximum size. |
| 3A.16 | Resize the very tall or wide image. | It still resizes; it just can't shrink to nothing. |
| 3A.17 | Drag the **round handle above the image** to rotate it. Then rotate again while holding **Shift**. | It rotates freely; with Shift it jumps in 15° steps. **Ctrl+Z** undoes a rotation. |
| 3A.18 | Right-click a rotated, resized image → **Reset rotation**, then **Reset to original size**. | It straightens in place, then returns to its pixel size (1 image pixel = 1 px at 100% zoom), keeping its centre. |
| 3A.19 | Select an image **and** a board card together. | No rotation handle (board cards don't rotate) and corner handles only. Resizing keeps the image's shape. |
| 3A.20 | Select 3 images of different shapes (one rotated). Try align, **Distribute** and **Same width / Same height** in the floating bar. | They line up by their **visible** edges. Images keep their shape: "Same width" makes them as wide as the widest, and their heights follow. |
| 3A.21 | On images, try everything from M2: move, arrow-key nudge, group, lock, layer order, copy/paste, duplicate, cut and paste on another board, Delete + Ctrl+Z. | All work as they do for board cards. Copies appear instantly (nothing is imported again). |
| 3A.22 | Drag an image onto a board card. | It moves into that board. |
| 3A.22a | Add 3 images one at a time, delete one, then press **Ctrl+Z** 4 times **as fast as you can**. Then **Ctrl+Shift+Z** twice quickly. | Every key press counts: the deleted image comes back and all 3 imports are undone (empty board), then two images return. Nothing is skipped or undone out of order. |
| 3A.22b | Open a different project (or relaunch the app) and, **immediately** as its board appears, drop an image file onto the canvas. | It lands centred where you dropped it, and the view doesn't jump afterwards. |

**Full-size viewer**

| # | Do this | Expected |
|---|---|---|
| 3A.23 | Double-click an image (or select it and press **Enter**, or right-click → **View full size**). | A dark full-window viewer opens with the image fitted to the window. The top shows the file name, pixel size, format and file size. |
| 3A.24 | Scroll to zoom, drag to pan; try **Fit**, **100%**, double-click, and the keys **+**, **−**, **1**, **F**. | Zoom follows the pointer. Double-click toggles between 100% (at that spot) and fit. Zoomed right in, pixels look crisp and square (not blurry). Transparent areas show a grey checkerboard. |
| 3A.24a | Close the viewer. Click an image once, then straight away double-click it (three quick clicks). | The viewer opens **fitted** (below 100% for a big image) and stays fitted. Double-clicking inside the viewer still toggles 100% / fit. |
| 3A.25 | Press **←** / **→** (or the arrow buttons). | Steps through the images on this board ("2 of 5"). |
| 3A.26 | Click **Download original** and save it somewhere. Also try right-click on the canvas → **Save original as…**. | The saved file is **identical** to the file you imported: same size in bytes (right-click → Properties), opens in your art app at full quality with its transparency. |
| 3A.27 | Press **Esc** (or ✕). While the viewer was open, did **Delete** or the arrow keys change the board? | The viewer closes. Keys pressed in the viewer never edit the board. |

**Keeping your work safe**

| # | Do this | Expected |
|---|---|---|
| 3A.28 | Open the board in a second window. Move, resize and rotate an image in one window. | The other window shows the images and updates. |
| 3A.29 | Quit and relaunch the app, then reopen the project. | Every image is back with the same position, size and rotation. |
| 3A.30 | Check the files you imported, in their original folders. | They're untouched (same size and date). The project folder holds copies in `assets` and small previews in `thumbs`. |

**Feel (your opinion — most important for M3A)**

- Do resizing and rotating feel natural? Are the handles easy to grab?
- Does pasting from your browser and screenshot tool work every time?
- Is anything about image quality disappointing at any zoom level?

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
  - assets: originals stored byte-for-byte and source files untouched, content checks (fake or unsupported files), deduplication, EXIF orientation, thumbnails with transparency, export of originals, PDF page size, invalid PDFs skipped, other files stored, previews attached and removed without deleting the image
  - image, PDF and file objects: initial sizing, layout, PDF proportions enforced on every update, file cards free to resize, copies sharing one asset
  - renderer helpers: tree building, camera math, rotated bounds, image level of detail, align/distribute/match size with rotated and ratio-locked images, z-order, snapping, undo history
  - text notes: content validation and sanitising (unsafe links, images and scripts refused, invalid attributes, size limit), unreadable notes, plain-text extraction, revision-checked saves (stale revisions and notes trashed meanwhile), style and minimum-height rules, copy/trash/restore, editing leases and take-over
- **End-to-end tests** (Playwright, `e2e/`): launch the real app with a temporary settings folder and test
  - creating boards from the toolbar (click and drag-drop)
  - dragging cards and persistence after restart
  - nesting by drag-and-drop, plus undo
  - delete + undo
  - sidebar drag-and-drop for boards and folders
  - images (`e2e/images.spec.ts`): Image tool import with byte-for-byte storage and thumbnails served to the UI; drawn on the canvas; proportional resize and Shift-snapped rotation with undo and persistence; dropping files (with an unsupported one explained); duplicate sharing the stored file; delete/undo/redo; pasting a screenshot, files copied in File Explorer and copied images; viewer open/fit/100%/download original/close; a second window showing the image and its changes
  - text notes (`e2e/notes.spec.ts`): creating notes (double-click, T, toolbar) with autosave; card/floating and reset; formatting drawn on the canvas, unsafe links refused, Ctrl+click opening links; resize reflow and auto height; fixed height scrolling and fit to content; move and Shift-snapped rotation; editing zoomed in and far out; the expanded editor; paste cleaning, plain paste and images kept out of notes; keyboard isolation; undo/redo ordering; persistence after restart; two-window sync, take-over, conflicts and notes deleted elsewhere; failed saves with retry; closing a window right after typing; damaged notes; a CPU-throttled "slow machine"
  - PDFs and other files (`e2e/documents.spec.ts`): PDF import with page size and a skipped invalid PDF; the image tool refusing a PDF; reader page navigation, single and two-page modes, right-to-left spread, zoom, outline jump, search highlights, a page with no text, saving the original, a separate reader window, closing it leaving the canvas, a long PDF painting only the pages on screen, persistence; generic files keeping their bytes, compact and preview appearance, attaching and removing a preview without deleting the image, a duplicate card sharing the file, an executable that cannot be launched, and opening a working copy

  Failures in CI upload a Playwright report with screenshots and traces.

**Planned (see ROADMAP):**
- Renderer store tests.
- A coverage report with a minimum threshold.

**Rule for every feature PR:**
- unit tests for its logic
- a checklist section in this file for its user-facing behaviour
- a "How to test" section in the PR description
