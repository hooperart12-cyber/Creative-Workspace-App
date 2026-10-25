# Setup Guide: Install, Run and Build

This guide takes you from a fresh computer to the running app. If something doesn't work, check [Troubleshooting](#troubleshooting) at the bottom.

**Keep this file current:** when you add, remove, or upgrade a dependency or change a script, update the tables below in the same PR.

---

## 1. Prerequisites (one-time setup)

You need **Git** and **Node.js 22.12 or newer** (version **24 LTS** recommended; the repo's `.nvmrc` pins 24). Node includes `npm`, which installs everything else.

You do **not** need to install Electron, React, SQLite or any database server. `npm install` downloads them into the project.

### Windows

1. **Git:** install from <https://git-scm.com/download/win> (default options are fine).
2. **Node.js 24 LTS:** install the "LTS" Windows installer from <https://nodejs.org>.
   - On the "Tools for Native Modules" screen you can leave the box **unchecked**. The database module ships prebuilt binaries. Only check it if [native build errors](#npm-install-fails-with-gyp--build-errors) show up later.
3. Open a **new** PowerShell or Windows Terminal window and check:
   ```powershell
   git --version
   node --version   # should print v22.12 or higher (v24.x recommended)
   npm --version
   ```

### macOS

1. **Xcode Command Line Tools** (provides Git and compilers):
   ```bash
   xcode-select --install
   ```
2. **Node.js 24 LTS:** either the installer from <https://nodejs.org>, or with [nvm](https://github.com/nvm-sh/nvm):
   ```bash
   nvm install   # reads .nvmrc from the repo
   nvm use
   ```
3. Check with `git --version`, `node --version` and `npm --version`.

### Recommended (optional)

- **VS Code** with the **ESLint**, **Prettier** and **Tailwind CSS IntelliSense** extensions.
- **GitHub CLI** (`gh`) for working with pull requests from the terminal.

---

## 2. Get the code and install dependencies

```bash
git clone https://github.com/hooperart12-cyber/Creative-Workspace-App.git
cd Creative-Workspace-App
npm install
```

`npm install`:

- downloads every package listed in `package.json` into `node_modules/` (exact versions are locked in `package-lock.json`)
- downloads the Electron runtime (~100 MB, first time only)
- runs `electron-builder install-app-deps` automatically (the `postinstall` script), which fetches the SQLite module (`better-sqlite3`) built for Electron

> Use `npm ci` instead of `npm install` when you want an exact, clean install from the lockfile (this is what CI does).

---

## 3. Start the app

```bash
npm run dev
```

The desktop window opens. Changes to React code (`src/renderer`) appear instantly. Changes to the main process or preload (`src/main`, `src/preload`) need a restart: press `Ctrl+C` in the terminal and run `npm run dev` again.

**Try it:** type a project name, click **Choose location & create**, and pick a folder. The app creates `<Name>.cwproj/` there. Reopen it later from **Recent projects** or **Open project…**.

To quit, close the window (on macOS, press `Cmd+Q`) or press `Ctrl+C` in the terminal.

---

## 4. All commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode with hot reload |
| `npm test` | Run unit tests (Vitest, run inside Electron's Node) |
| `npm run test:e2e` | Build the app, then run end-to-end UI tests (Playwright drives the real app; uses a temporary settings folder) |
| `npm run typecheck` | TypeScript type checking for main, preload and renderer |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Format code with Prettier, or only check formatting |
| `npm run build` | Typecheck, then produce a production build in `out/` |
| `npm run preview` | Run the production build locally |
| `npm run build:win` | Build a Windows installer (`dist/*.exe`). Run it on Windows; CI also builds it on every push to `main` |
| `npm run build:mac` | Build a macOS `.dmg` (run on a Mac) |
| `npm run db:generate` | After editing `src/main/db/schema.ts`, generate a new SQL migration in `drizzle/` |

Before opening a PR, run: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e`

### Getting the Windows installer without a Windows build machine

Every push to `main` (and every PR) runs the GitHub Actions workflow in `.github/workflows/ci.yml`. Open the run on GitHub → **Artifacts** → download **windows-installer**.

---

## 5. Project structure

```
src/
  main/            Electron main process: the app's local "backend"
    index.ts       App start-up, single-instance lock
    windows.ts     Window creation + security settings
    ipc.ts         Handlers for every request the UI can make
    db/            SQLite schema (Drizzle) and connection setup
    project/       Project create/open, board + folder repositories, multi-window registry,
                   recent projects (+ tests)
  preload/         Safe bridge that exposes `window.api` to the UI
  shared/          Types and the IPC contract shared by main + UI
  renderer/        React UI
    src/canvas/      The board canvas: CanvasView (Konva stage + pointer handling), actions (every
                     undoable edit), arrange/geometry/history (pure logic + tests), toolbar & menus
    src/notes/       Text notes: editing session and autosave (session.ts), layout and Konva
                     drawing, inline and expanded editors, toolbar and formatting panel
    src/components/  Screens and UI pieces (sidebar, breadcrumb, dialogs)
    src/store/       Zustand stores: projectStore (open project), workspaceStore (per-window
                     navigation, tree, current board), canvasStore (camera, selection, drag, undo)
    src/lib/         Small pure helpers (tree building, error messages) (+ tests)
drizzle/           Generated SQL migrations (committed; shipped with the app)
e2e/               Playwright end-to-end tests (helpers in e2e/app.ts)
scripts/           Helper scripts (test runner)
docs/              Requirements, decisions, roadmap, handoff, this guide
```

**Adding a new UI → backend call:** add the channel to `src/shared/ipc.ts` (both `IpcRequests` and `IPC_CHANNELS`), then implement it with `handle(...)` in `src/main/ipc.ts`. Call it from React with `window.api.invoke('channel', ...args)`; it's fully typed.

**Where data lives:**

- **Projects:** wherever the user chose, as `<Name>.cwproj/` folders containing `project.db`, `assets/`, `thumbs/` and `backups/`.
- **App settings** (recent projects): Electron's user-data folder, `%APPDATA%\Creative Workspace\` on Windows or `~/Library/Application Support/Creative Workspace/` on macOS.

---

## 6. Dependencies

### Runtime (shipped inside the app)

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | ^13 | SQLite database engine (native module, rebuilt for Electron on install) |
| `drizzle-orm` | ^0.45 | Typed SQL queries and migrations for SQLite |
| `zustand` | ^5 | Lightweight React state management |

### Development and build tools

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^45 | Desktop runtime (Chromium + Node.js) |
| `electron-vite` | ^6 | Dev server and bundler for main, preload and renderer |
| `electron-builder` | ^26 | Packages installers (`.exe`, `.dmg`); rebuilds native modules for Electron |
| `vite` | ^8 | Bundler used by electron-vite |
| `react`, `react-dom` | ^19 | UI library (bundled into the renderer at build time) |
| `@vitejs/plugin-react` | ^6 | React support for Vite |
| `typescript` | ~6.0 | Type checking (held at 6.0 until typescript-eslint supports 7) |
| `tailwindcss`, `@tailwindcss/vite` | ^4 | Utility-first CSS styling |
| `radix-ui` | ^1.8 | Accessible context menus and dialogs (bundled into the renderer) |
| `konva`, `react-konva` | ^10 / ^19 | Canvas rendering, hit detection and resize handles (bundled into the renderer) |
| `sharp` | ^0.35 | Checks imported images, reads their size and transparency, and makes thumbnails (main process). Installs a prebuilt native library for your platform (`@img/sharp-*`); installers unpack it from the asar |
| `@tiptap/*` (`react`, `core`, `pm`, `starter-kit`, `extensions`, `extension-text-style`, `extension-highlight`, `extension-text-align`) | ^3.32 | Rich text editor for notes, built on ProseMirror (bundled into the renderer) |
| `dompurify` | ^3.4 | Cleans pasted HTML before it reaches a note (bundled into the renderer) |
| `@fontsource/inter`, `lora`, `jetbrains-mono`, `caveat` | ^5.3 | The four fonts included for notes (SIL Open Font License), bundled as font files |
| `@playwright/test` | ^1.64 | End-to-end UI tests that drive the Electron app |
| `drizzle-kit` | ^0.31 | Generates SQL migrations from the schema (`npm run db:generate`) |
| `vitest` | ^5 | Unit test runner |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` | ^10 / ^8 / ^7 | Linting |
| `prettier` | ^3 | Code formatting |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/better-sqlite3` | — | TypeScript type definitions |

### Planned (added in later milestones; see ROADMAP)

| Package | Milestone | Purpose |
|---|---|---|
| `pdfjs-dist` | M3C | PDF viewing, search and outline |
| `cmdk` | M5 | Command palette |

---

## Troubleshooting

### `npm install` fails with gyp / build errors

The database module couldn't download a prebuilt binary and tried to compile from source.

- **Windows:** install "Desktop development with C++" from the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), or re-run the Node installer and check "Tools for Native Modules". Then delete `node_modules` and run `npm install` again.
- **macOS:** run `xcode-select --install`, then `npm install` again.

### "was compiled against a different Node.js version" / `NODE_MODULE_VERSION` error

The SQLite module was built for plain Node instead of Electron. Run:

```bash
npx electron-builder install-app-deps
```

Don't run tests with `npx vitest` directly; use `npm test`, which runs them inside Electron so the same build works for both.

### The window is blank, or `window.api` is undefined

Check the terminal for errors. Make sure `out/preload/index.cjs` exists after `npm run dev` starts, and restart the dev server after changing `src/preload` or `src/main`.

### `npm audit` shows moderate warnings

These come from `drizzle-kit` (a development-only tool) depending on an old `esbuild`. They don't affect the shipped app.
