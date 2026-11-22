import { restore, listBatches } from './lib/trash.js';
const before = await listBatches();
console.log('batches before:', before.map(b => b.id + ':' + b.count).join(', '));
const r = await restore('mwqmepi0-gbjm28');
console.log(JSON.stringify(r).slice(0, 600));
const after = await listBatches();
console.log('batches after:', after.map(b => b.id + ':' + b.count).join(', ') || '(none)');
