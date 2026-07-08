import {batchIntoRotations, uniqueSpeechBcp47} from './speech_language_catalog.js';

const codes = uniqueSpeechBcp47(['ja', 'en', 'fr', 'de', 'es', 'ja']);
if (codes.length !== 5) {
  console.error(`Expected 5 unique codes, got ${codes.length}`);
  process.exit(1);
}

const rotations = batchIntoRotations(['ja', 'en', 'fr', 'de', 'es', 'sw', 'lg']);
if (rotations.length < 2) {
  console.error('Expected at least 2 rotation batches');
  process.exit(1);
}

if (rotations[0].length !== 4) {
  console.error('Each rotation must have 4 BCP-47 codes');
  process.exit(1);
}

console.log('speech_language_catalog tests passed');
