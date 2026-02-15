/**
 * Stage 7: Promotion
 *
 * Git pull --rebase → copy to vault → git add → commit → push.
 * Retry once on conflict. Delete staging file on success.
 */

import { copyFile, readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { cleanupStaged } from './staging.js';

/**
 * Execute a git command in the vault directory.
 * @param {string} cmd - Git command
 * @param {string} cwd - Working directory
 * @returns {string} stdout
 */
function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', timeout: 30000 }).trim();
}

/**
 * Promote a single staging file to the vault.
 * @param {string} stagingFile - Path to staging file
 * @param {string} vaultDir - Vault root directory
 * @param {string} [obsSubdir='observations'] - Subdirectory for observations
 * @returns {Promise<boolean>} True if promoted successfully
 */
export async function promoteOne(stagingFile, vaultDir, obsSubdir = 'observations') {
  const filename = basename(stagingFile);
  const destDir = join(vaultDir, obsSubdir);
  const destPath = join(destDir, filename);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Sync with remote
      try { git('pull --rebase', vaultDir); } catch { /* may fail if no remote */ }

      // Copy to vault
      await copyFile(stagingFile, destPath);

      // Git add + commit + push
      git(`add "${join(obsSubdir, filename)}"`, vaultDir);

      const content = await readFile(stagingFile, 'utf8');
      const titleMatch = content.match(/^title:\s*"?(.+?)"?\s*$/m);
      const title = titleMatch?.[1] || filename;
      git(`commit -m "observe: ${title.slice(0, 72)}"`, vaultDir);

      try { git('push', vaultDir); } catch { /* may fail if no remote */ }

      // Clean up staging file
      await cleanupStaged(stagingFile);
      console.log(`[promoter] Promoted ${filename}`);
      return true;
    } catch (err) {
      if (attempt === 0) {
        // Retry after delay
        const delay = 1000 + Math.random() * 4000;
        console.warn(`[promoter] Conflict promoting ${filename}, retrying in ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        try { git('rebase --abort', vaultDir); } catch { /* ignore */ }
      } else {
        console.error(`[promoter] Failed to promote ${filename}: ${err.message}`);
        return false;
      }
    }
  }
  return false;
}

/**
 * Promote all staging files to the vault.
 * @param {string} stagingDir
 * @param {string} vaultDir
 * @returns {Promise<{ promoted: string[], failed: string[] }>}
 */
export async function promoteAll(stagingDir, vaultDir) {
  const promoted = [];
  const failed = [];

  let files;
  try {
    files = (await readdir(stagingDir)).filter(f => f.endsWith('.md'));
  } catch {
    return { promoted, failed };
  }

  for (const file of files) {
    const filepath = join(stagingDir, file);
    const success = await promoteOne(filepath, vaultDir);
    if (success) {
      promoted.push(file);
    } else {
      failed.push(file);
    }
  }

  return { promoted, failed };
}
