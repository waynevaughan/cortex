import { resolve } from 'node:path';

// Cortex root is the repo root (where mind/, vault/, queue/ live)
// Default to cwd, override with CORTEX_ROOT env var
export function cortexRoot() {
  return process.env.CORTEX_ROOT || process.cwd();
}

export function queuePath() {
  return resolve(cortexRoot(), 'queue');
}

export function queueFile() {
  return resolve(queuePath(), 'observations.jsonl');
}

export function mindPath() {
  return resolve(cortexRoot(), 'mind');
}

export function vaultPath() {
  return resolve(cortexRoot(), 'vault');
}
