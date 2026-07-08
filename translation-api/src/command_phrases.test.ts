import assert from 'node:assert/strict';

import {normalizeCommandPhrases} from './command_phrases.js';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`fail ${name}`);
    throw error;
  }
}

test('rewrites Run code first into Execute for better translation', () => {
  assert.equal(
    normalizeCommandPhrases('Run `npm install` first'),
    'Execute `npm install` first',
  );
});

test('leaves normal sentences unchanged', () => {
  const input = 'Please check **the urgent report** today';
  assert.equal(normalizeCommandPhrases(input), input);
});
