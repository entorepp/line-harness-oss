import assert from 'node:assert/strict';
import { extractSingleQuoteReference } from '../src/services/quote-reference.js';

assert.equal(extractSingleQuoteReference('FTQ-20260825-AB12CD34'), 'FTQ-20260825-AB12CD34');
assert.equal(extractSingleQuoteReference('Application ID: ftq-20260825-ab12cd34.'), 'FTQ-20260825-AB12CD34');
assert.equal(extractSingleQuoteReference('申込ID FT-20260825-AB12CD34 です'), 'FT-20260825-AB12CD34');
assert.equal(extractSingleQuoteReference('FTQ-20260825-AB12CD34 FTQ-20260825-ZZ99YY88'), null);
assert.equal(extractSingleQuoteReference('AB12CD34'), null);

console.log('quote reference parser: ok');
