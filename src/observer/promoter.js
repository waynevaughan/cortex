/**
 * Stage 7: Promotion
 *
 * Batch-copies staged observations to vault, then does a single
 * git add + commit + push. No more per-file commits.
 * Stashes dirty state before pull to avoid rebase conflicts.
 */

import { copyFile, readdir, readFile, mkdir } from 'node:fs/promises';
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
 * Check if git repo has uncommitted changes.
 * @param {string} cwd
 * @returns {boolean}
 */
function isDirty(cwd) {
  try {
    const status = git('status --porcelain', cwd);
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Promote a single staging file to the vault (no git, just copy).
 * @param {string} stagingFile - Path to staging file
 * @param {string} vaultDir - Vault root directory
 * @param {string} [obsSubdir='observations'] - Subdirectory for observations
 * @returns {Promise<{filename: string, title: string}|null>}
 */
async function copyToVault(stagingFile, vaultDir, obsSubdir = 'observations') {
  const filename = basename(stagingFile);
  const destDir = join(vaultDir, obsSubdir);
  await mkdir(destDir, { recursive: true });
  const destPath = join(destDir, filename);

  try {
    await copyFile(stagingFile, destPath);
    const content = await readFile(stagingFile, 'utf8');
    const titleMatch = content.match(/^title:\s*"?(.+?)"?\s*$/m);
    const title = titleMatch?.[1] || filename;
    return { filename, title };
  } catch (err) {
    console.error(`[promoter] Failed to copy ${filename}: ${err.message}`);
    return null;
  }
}

/**
 * Promote all staging files to the vault in a single batch commit.
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

  if (files.length === 0) return { promoted, failed };

  // Step 1: Copy all files to vault
  const copied = [];
  for (const file of files) {
    const filepath = join(stagingDir, file);
    const result = await copyToVault(filepath, vaultDir);
    if (result) {
      copied.push({ filepath, ...result });
    } else {
      failed.push(file);
    }
  }

  if (copied.length === 0) return { promoted, failed };

  // Step 2: Single git operation — stash, pull, add, commit, push
  try {
    // Stash any dirty state (daemon logs, etc.)
    const dirty = isDirty(vaultDir);
    if (dirty) {
      try { git('stash push -m "observer-pre-promote"', vaultDir); } catch { /* ignore */ }
    }

    // Pull latest
    try { git('pull --rebase', vaultDir); } catch { /* may fail if no remote */ }

    // Pop stash if we stashed
    if (dirty) {
      try { git('stash pop', vaultDir); } catch { /* ignore conflicts */ }
    }

    // Add all observation files
    for (const { filename } of copied) {
      try {
        git(`add "observations/${filename}"`, vaultDir);
      } catch {
        // Try with full path
        try { git(`add "${filename}"`, vaultDir); } catch { /* skip */ }
      }
    }

    // Single commit
    const count = copied.length;
    const titles = copied.slice(0, 3).map(c => c.title.slice(0, 50));
    const msg = count === 1
      ? `observe: ${titles[0]}`
      : `observe: ${count} observations (${titles.join('; ')}${count > 3 ? '...' : ''})`;

    try {
      git(`commit -m "${msg.replace(/"/g, '\\"')}"`, vaultDir);
    } catch (err) {
      // Nothing to commit (files may already be tracked)
      if (!err.message.includes('nothing to commit')) {
        throw err;
      }
    }

    // Push
    try { git('push', vaultDir); } catch { /* may fail if no remote */ }

    // Clean up staging files
    for (const { filepath, filename } of copied) {
      try {
        await cleanupStaged(filepath);
        promoted.push(filename);
        console.log(`[promoter] Promoted ${filename}`);
      } catch {
        promoted.push(filename); // File is in vault even if cleanup fails
      }
    }
  } catch (err) {
    console.error(`[promoter] Batch commit failed: ${err.message}`);
    // Files are copied to vault but not committed — they'll be picked up next time
    for (const { filename } of copied) {
      failed.push(filename);
    }
    // Abort any stuck rebase
    try { git('rebase --abort', vaultDir); } catch { /* ignore */ }
  }

  return { promoted, failed };
}

// Keep for backward compat but prefer promoteAll
export async function promoteOne(stagingFile, vaultDir, obsSubdir = 'observations') {
  const result = await promoteAll(
    join(stagingFile, '..'),
    vaultDir,
  );
  return result.promoted.length > 0;
}
