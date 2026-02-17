import { stat } from 'node:fs/promises';
import { scanEntries } from '../entries.js';
import { queueFile } from '../paths.js';

export async function statusCommand() {
  const entries = await scanEntries();

  // Partition counts
  const mindCount = entries.filter(e => e.partition === 'mind').length;
  const vaultCount = entries.filter(e => e.partition === 'vault').length;

  // Type counts
  const typeCounts = {};
  for (const e of entries) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  console.log('=== Cortex Status ===\n');
  console.log(`Entries: ${entries.length} total`);
  console.log(`  Mind:  ${mindCount}`);
  console.log(`  Vault: ${vaultCount}\n`);

  if (Object.keys(typeCounts).length > 0) {
    console.log('By type:');
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
    console.log('');
  }

  // Queue status
  try {
    const qStat = await stat(queueFile());
    console.log(`Queue: ${queueFile()}`);
    console.log(`  Size: ${qStat.size} bytes`);
    console.log(`  Modified: ${qStat.mtime.toISOString()}`);
  } catch {
    console.log('Queue: no queue file');
  }
}
