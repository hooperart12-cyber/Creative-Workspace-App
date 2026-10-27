import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { openRawDatabase } from '../db/client'
import { blobPath, storedOriginalPath, verifyPoint, type RecoveryManifest } from './backup'
import { Project, PROJECT_DB_FILE, PROJECT_EXTENSION, sanitizeProjectName } from './project'

/**
 * Builds a new project from a recovery point. The source project is not opened or changed.
 * Every stored file is checksum-checked before the new project is kept.
 */
export async function restoreProject(input: {
  vaultRoot: string
  manifest: RecoveryManifest
  parentDir: string
  name: string
  migrationsFolder: string
  vaultFor?: (projectId: string) => string
}): Promise<{ path: string; projectId: string }> {
  const checked = await verifyPoint(input.vaultRoot, input.manifest.id, 'checksum')
  if (!checked.ok) {
    throw new Error(`This recovery point cannot be restored. ${checked.errors.join(' ')}`)
  }
  const folder = sanitizeFolder(input.name)
  const finalPath = join(input.parentDir, folder + PROJECT_EXTENSION)
  const partial = join(input.parentDir, `.${folder}.${randomUUID()}.partial`)
  await mkdir(partial, { recursive: true })
  try {
    await copyFile(
      join(input.vaultRoot, 'points', input.manifest.id, 'database.db'),
      join(partial, PROJECT_DB_FILE)
    )
    const projectId = randomUUID()
    const sqlite = openRawDatabase(join(partial, PROJECT_DB_FILE))
    try {
      sqlite.prepare('UPDATE project_meta SET id = ?').run(projectId)
    } finally {
      sqlite.close()
    }
    for (const asset of input.manifest.assets) {
      const destination = storedOriginalPath(partial, asset.sha256, asset.ext)
      await mkdir(join(partial, 'assets', asset.sha256.slice(0, 2)), { recursive: true })
      await copyFile(blobPath(input.vaultRoot, asset.sha256), destination)
    }
    await mkdir(join(partial, 'thumbs'), { recursive: true })
    await mkdir(join(partial, 'backups'), { recursive: true })
    const opened = await Project.open(partial, input.migrationsFolder, {
      vaultFor: input.vaultFor
    })
    opened.close()
    await rename(partial, finalPath)
    return { path: finalPath, projectId }
  } catch (error) {
    await rm(partial, { recursive: true, force: true })
    throw error
  }
}

function sanitizeFolder(name: string): string {
  try {
    return sanitizeProjectName(name)
  } catch {
    throw new Error('Enter a name for the restored project.')
  }
}
