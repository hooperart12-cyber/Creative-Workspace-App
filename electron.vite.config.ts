import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/** Serves pdf.js fonts and cmaps, and copies them next to the built page. */
function pdfjsAssets(): Plugin {
  const root = resolve('node_modules/pdfjs-dist')
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        const match = /^\/pdfjs\/(standard_fonts|cmaps)\/(.+)$/.exec(url)
        if (!match) return next()
        const base = resolve(root, match[1])
        const file = resolve(base, match[2])
        if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404
          res.end()
          return
        }
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      const out = resolve('out/renderer/pdfjs')
      cpSync(resolve(root, 'standard_fonts'), resolve(out, 'standard_fonts'), { recursive: true })
      cpSync(resolve(root, 'cmaps'), resolve(out, 'cmaps'), { recursive: true })
    }
  }
}

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias }
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss(), pdfjsAssets()]
  }
})
