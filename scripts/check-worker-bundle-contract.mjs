import { readFileSync } from 'node:fs';
import { assertMessagingContract } from './worker-release-contract.mjs';

assertMessagingContract(readFileSync(process.argv[2], 'utf8'));
console.log('PASS: compiled Worker preserves message dispatch, cron and channel/private-file routes');
