#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { homedir, userInfo } from 'os';

// --- Config resolution ---

function expandTilde(p) {
  if (p && p.startsWith('~')) return join(homedir(), p.slice(1));
  return p;
}

function loadConfig() {
  // Check local .cortexrc, then ~/.cortexrc
  const candidates = [
    join(process.cwd(), '.cortexrc'),
    join(homedir(), '.cortexrc'),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch { /* skip */ }
  }
  return {};
}

const config = loadConfig();

function getVaultPath() {
  if (process.env.CORTEX_VAULT_PATH) return expandTilde(process.env.CORTEX_VAULT_PATH);
  if (config.vaultPath) return expandTilde(config.vaultPath);
  return process.cwd();
}

function getUser() {
  if (process.env.CORTEX_USER) return process.env.CORTEX_USER;
  if (config.user) return config.user;
  return userInfo().username;
}

function getDefaultStatus() {
  return config.defaultStatus || 'draft';
}

// --- Argument parsing ---

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: vault-promote <source-file> --type <type> [--status <status>] [--tags topic/x,project/y]

Options:
  --type     Document type (e.g., spec, decision, research)
  --status   Document status (default: ${getDefaultStatus()})
  --tags     Additional tags (comma-separated)

Config resolution (highest priority first):
  CORTEX_VAULT_PATH / CORTEX_USER  — environment variables
  .cortexrc (local or ~/.cortexrc) — JSON config file
  Defaults                         — cwd for vault, os username for author

Example:
  vault-promote ~/workspace/research.md --type research --tags topic/ai,project/cortex
`);
  process.exit(0);
}

const sourceFile = args[0];
let type = null;
let status = null;
let additionalTags = [];

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--type' && i + 1 < args.length) {
    type = args[++i];
  } else if (args[i] === '--status' && i + 1 < args.length) {
    status = args[++i];
  } else if (args[i] === '--tags' && i + 1 < args.length) {
    additionalTags = args[++i].split(',').map(t => t.trim());
  }
}

if (!sourceFile) {
  console.error('❌ Error: source file required');
  process.exit(1);
}

if (!type) {
  console.error('❌ Error: --type is required');
  process.exit(1);
}

if (!status) {
  status = getDefaultStatus();
}

// Resolve paths
const vaultPath = getVaultPath();
const author = getUser();
const sourcePath = sourceFile.startsWith('~') 
  ? join(homedir(), sourceFile.slice(2))
  : resolve(sourceFile);

if (!existsSync(sourcePath)) {
  console.error(`❌ Error: source file not found: ${sourcePath}`);
  process.exit(1);
}

// Read source file
const content = readFileSync(sourcePath, 'utf-8');

// Extract title (first heading or filename)
let title = basename(sourcePath, '.md');
const headingMatch = content.match(/^#\s+(.+)$/m);
if (headingMatch) {
  title = headingMatch[1].trim();
}

// Extract description (first paragraph after heading, or first paragraph)
let description = '';
const lines = content.split('\n');
let foundHeading = false;
for (const line of lines) {
  if (line.match(/^#\s+/)) {
    foundHeading = true;
    continue;
  }
  if (foundHeading && line.trim().length > 0 && !line.startsWith('#')) {
    description = line.trim();
    break;
  }
}
if (!description) {
  description = lines.find(l => l.trim().length > 0 && !l.startsWith('#'))?.trim() || 'No description';
}

// Check for duplicates
const contentPreview = content.slice(0, 200).toLowerCase();
const titleLower = title.toLowerCase();

function scanDirectory(dir) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory() && !entry.startsWith('.')) {
        files.push(...scanDirectory(fullPath));
      } else if (entry.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (err) { /* skip */ }
  return files;
}

const vaultFiles = scanDirectory(vaultPath);
let duplicateFound = false;

for (const vaultFile of vaultFiles) {
  try {
    const vaultContent = readFileSync(vaultFile, 'utf-8');
    const vaultTitle = vaultContent.match(/^title:\s*["']?(.+?)["']?$/m)?.[1]?.toLowerCase() || '';
    const vaultPreview = vaultContent.slice(0, 200).toLowerCase();
    
    if (vaultTitle === titleLower || vaultPreview.includes(contentPreview.slice(0, 100))) {
      console.warn(`⚠️  Possible duplicate found: ${vaultFile}`);
      duplicateFound = true;
    }
  } catch (err) { /* skip */ }
}

if (duplicateFound && process.stdin.isTTY) {
  console.log('\n❓ Continue anyway? (y/N)');
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question('', (ans) => { rl.close(); resolve(ans); });
  });
  if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
    console.log('❌ Aborted');
    process.exit(1);
  }
}

// Build tags
const tags = [`type/${type}`, `status/${status}`, ...additionalTags];

// Generate frontmatter
const today = new Date().toISOString().split('T')[0];
const frontmatter = `---
id: ""
hash: ""
title: "${title}"
description: "${description}"
author: ${author}
date: ${today}
tags: [${tags.join(', ')}]
---

`;

// Determine destination
let destDir = vaultPath;
const subdirs = ['decisions', 'research', 'specs', 'guides', 'reviews'];
for (const subdir of subdirs) {
  const subdirPath = join(vaultPath, subdir);
  if (existsSync(subdirPath) && type.includes(subdir.slice(0, -1))) {
    destDir = subdirPath;
    break;
  }
}

// Strip existing frontmatter if present
let bodyContent = content;
if (content.startsWith('---')) {
  const endOfFrontmatter = content.indexOf('---', 3);
  if (endOfFrontmatter !== -1) {
    bodyContent = content.slice(endOfFrontmatter + 3).trim();
  }
}

const finalContent = frontmatter + '\n' + bodyContent;

// Write to vault
const destFile = join(destDir, basename(sourcePath));
writeFileSync(destFile, finalContent, 'utf-8');

console.log(`✅ Promoted to: ${destFile}`);

// Git operations
try {
  process.chdir(vaultPath);
  execSync(`git add "${destFile}"`, { stdio: 'pipe' });
  execSync(`git commit -m "add: ${title}"`, { stdio: 'pipe' });
  execSync('git pull --rebase', { stdio: 'pipe' });
  execSync('git push', { stdio: 'pipe' });
  console.log('✅ Committed and pushed to vault');
} catch (err) {
  console.error(`⚠️  Git operation failed: ${err.message}`);
  console.error('   File was written but not pushed');
  process.exit(1);
}

console.log(`\n📝 Summary:`);
console.log(`   Title: ${title}`);
console.log(`   Type: ${type}`);
console.log(`   Status: ${status}`);
console.log(`   Tags: ${tags.join(', ')}`);
console.log(`   Path: ${destFile.replace(homedir(), '~')}`);
