import {scriptLanguageHint, shouldKeepScanningStt} from './spoken_language_hints.js';

const hintCases: Array<{text: string; expected: string}> = [
  {text: 'Arigato.', expected: 'ja'},
  {text: 'arigato gozaimasu', expected: 'ja'},
  {text: 'konnichiwa', expected: 'ja'},
  {text: 'ありがとう', expected: 'ja'},
  {text: 'annyeonghaseyo', expected: 'ko'},
  {text: 'hello world', expected: ''},
];

let failed = 0;
for (const entry of hintCases) {
  const result = scriptLanguageHint(entry.text);
  if (result !== entry.expected) {
    console.error(`scriptLanguageHint("${entry.text}") expected "${entry.expected}", got "${result}"`);
    failed += 1;
  }
}

if (!shouldKeepScanningStt('Arigato.', 'en')) {
  console.error('shouldKeepScanningStt should continue for Arigato labeled English');
  failed += 1;
}

if (shouldKeepScanningStt('ありがとう', 'ja')) {
  console.error('shouldKeepScanningStt should stop when Japanese matches');
  failed += 1;
}

if (failed > 0) {
  process.exit(1);
}

console.log('spoken_language_hints tests passed');
