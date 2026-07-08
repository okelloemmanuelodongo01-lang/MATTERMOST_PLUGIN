import {isPlausibleTranscript} from './transcript_quality.js';

const cases: Array<{text: string; ok: boolean}> = [
  {text: 'Bonjour, comment ça va?', ok: true},
  {text: 'Giratus demenosurnotrenivodisma', ok: false},
  {text: 'hello world', ok: true},
  {text: 'x', ok: false},
  {text: 'bcdfghjklmnpqrst', ok: false},
];

let failed = 0;
for (const entry of cases) {
  const result = isPlausibleTranscript(entry.text);
  if (result !== entry.ok) {
    console.error(`Expected ${entry.ok} for "${entry.text}", got ${result}`);
    failed += 1;
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log('transcript_quality tests passed');
