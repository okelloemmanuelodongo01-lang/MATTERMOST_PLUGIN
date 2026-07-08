import assert from 'node:assert/strict';

import {
  collectTranslatableStrings,
  hasMarkdownMarkup,
  isInlineCodeOnlyMessage,
  joinMarkdownSegments,
  markupStructurePreserved,
  repairTranslatedMarkup,
  splitMarkdownSegments,
  stripMarkdownForScoring,
} from './markdown_translate.js';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`fail ${name}`);
    throw error;
  }
}

test('detects common Mattermost markup', () => {
  assert.equal(hasMarkdownMarkup('plain text'), false);
  assert.equal(hasMarkdownMarkup('This is **bold** text'), true);
  assert.equal(hasMarkdownMarkup('See [docs](https://example.com)'), true);
  assert.equal(hasMarkdownMarkup('Use `code` here'), true);
});

test('splits bold into translatable formatted segment', () => {
  const segments = splitMarkdownSegments('Hello **world** today');
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], {kind: 'text', value: 'Hello '});
  assert.deepEqual(segments[1], {kind: 'formatted', open: '**', close: '**', inner: 'world'});
  assert.deepEqual(segments[2], {kind: 'text', value: ' today'});
});

test('collects translatable strings including formatted inner text', () => {
  const segments = splitMarkdownSegments('Read **the guide** now');
  assert.deepEqual(collectTranslatableStrings(segments), ['Read ', 'the guide', ' now']);
});

test('splits links into translatable text and preserved URL', () => {
  const segments = splitMarkdownSegments('Read [the guide](https://example.com/guide) now');
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[1], {
    kind: 'link',
    text: 'the guide',
    url: 'https://example.com/guide',
    image: false,
  });
  assert.equal(joinMarkdownSegments(segments), 'Read [the guide](https://example.com/guide) now');
});

test('preserves fenced code blocks without translating', () => {
  const input = 'Before\n```js\nconst x = 1;\n```\nAfter';
  const segments = splitMarkdownSegments(input);
  const code = segments.find((segment) => segment.kind === 'literal' && segment.value.startsWith('```'));
  assert.ok(code);
  assert.equal(joinMarkdownSegments(segments), input);
  assert.deepEqual(collectTranslatableStrings(segments), ['Before\n', '\nAfter']);
});

test('strips markup for scoring', () => {
  const plain = stripMarkdownForScoring('**Hello** [world](https://x.com) `code`');
  assert.equal(plain, 'Hello world');
});

test('translates blockquote inner text only', () => {
  const segments = splitMarkdownSegments('> Important update');
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], {
    kind: 'formatted',
    open: '> ',
    close: '',
    inner: 'Important update',
  });
});

test('preserves leading and trailing spaces in text chunks', async () => {
  const {translatePreservingMarkupBatch} = await import('./markdown_translate.js');

  const translated = await translatePreservingMarkupBatch(
    'Please check **the urgent report** today',
    async (chunks) => chunks.map((chunk) => {
      if (chunk === 'Please check') {
        return 'Vérifiez';
      }
      if (chunk === 'the urgent report') {
        return 'le rapport urgent';
      }
      if (chunk === 'today') {
        return "aujourd'hui";
      }
      return chunk;
    }),
  );

  assert.equal(translated, "Vérifiez **le rapport urgent** aujourd'hui");
});

test('preserves space before link label', async () => {
  const {translatePreservingMarkupBatch} = await import('./markdown_translate.js');

  const translated = await translatePreservingMarkupBatch(
    'See [our documentation](https://example.com)',
    async (chunks) => chunks.map((chunk) => {
      if (chunk === 'See') {
        return 'Voir';
      }
      if (chunk === 'our documentation') {
        return 'notre documentation';
      }
      return chunk;
    }),
  );

  assert.equal(translated, 'Voir [notre documentation](https://example.com)');
});

test('repairTranslatedMarkup fixes glued bold text', () => {
  const fixed = repairTranslatedMarkup("Vérifiez s'il vous plaît**le rapport urgent**aujourd'hui");
  assert.equal(fixed, "Vérifiez s'il vous plaît **le rapport urgent** aujourd'hui");
});

test('detects inline-code-only messages', () => {
  assert.equal(isInlineCodeOnlyMessage('Run `npm install` first'), true);
  assert.equal(isInlineCodeOnlyMessage('Please check **the report** today'), false);
});

test('join inserts spaces between translated words and markup', () => {
  const fixed = joinMarkdownSegments([
    {kind: 'text', value: "Vérifiez s'il vous plaît"},
    {kind: 'formatted', open: '**', close: '**', inner: 'le rapport urgent'},
    {kind: 'text', value: "aujourd'hui"},
  ]);
  assert.equal(fixed, "Vérifiez s'il vous plaît **le rapport urgent** aujourd'hui");
});

test('join inserts spaces around inline code literals', () => {
  const fixed = joinMarkdownSegments([
    {kind: 'text', value: 'Exécutez'},
    {kind: 'literal', value: '`npm install`'},
    {kind: 'text', value: "d'abord"},
  ]);
  assert.equal(fixed, "Exécutez `npm install` d'abord");
});

test('markupStructurePreserved checks urls and code literals', () => {
  const source = 'See [docs](https://example.com) and `npm install` **bold**';
  assert.equal(
    markupStructurePreserved(source, 'Voir [docs](https://example.com) et `npm install` **gras**'),
    true,
  );
  assert.equal(
    markupStructurePreserved(source, 'Voir [docs](https://broken.com) et `npm install` **gras**'),
    false,
  );
});
