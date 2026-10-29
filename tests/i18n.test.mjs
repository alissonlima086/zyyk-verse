import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeLocale, supportedLocales, translate, translationKeys } from '../src/lib/i18n.ts';

test('supports Portuguese and English with a safe Portuguese fallback', () => {
  assert.deepEqual(supportedLocales, ['pt-BR', 'en']);
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('pt-PT'), 'pt-BR');
  assert.equal(normalizeLocale('fr'), 'pt-BR');
});

test('translates interface labels and interpolates values', () => {
  assert.equal(translate('pt-BR', 'translation'), 'Tradução');
  assert.equal(translate('en', 'translation'), 'Translation');
  assert.equal(
    translate('en', 'completedProgress', { completed: 3, total: 10 }),
    '3 of 10 completed',
  );
});

test('keeps every catalog key and interpolation placeholder aligned', () => {
  assert.equal(new Set(translationKeys).size, translationKeys.length);
  assert.ok(translationKeys.length > 100);
  for (const key of translationKeys) {
    const placeholders = supportedLocales.map((locale) => (
      [...translate(locale, key).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    ));
    assert.deepEqual(placeholders[1], placeholders[0], `placeholder mismatch for ${key}`);
  }
});

test('keeps visible interface copy in the translation catalog', () => {
  const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
  let markup = page.slice(page.indexOf('</script>') + '</script>'.length);
  for (let pass = 0; pass < 4; pass += 1) markup = markup.replace(/\{[^{}]*\}/gs, '');
  const visibleLiterals = [...markup.matchAll(/>([^<>]+)</g)]
    .map((match) => match[1].replace(/[^A-Za-zÀ-ÿ0-9.[\]()_-]+/g, ' ').trim())
    .filter((value) => /[A-Za-zÀ-ÿ]/.test(value) && value !== '×');
  assert.deepEqual(
    [...new Set(visibleLiterals)].sort(),
    ['1 fps 1', 'LRC (.lrc)', 'SubRip (.srt)', 'WebVTT (.vtt)', 'ZYYK VERSE', 'ZYYK Verse'],
  );
  assert.doesNotMatch(markup, /(?:aria-label|placeholder|title)=["'][^"'{]*[A-Za-zÀ-ÿ]/);
  assert.doesNotMatch(page, /notify\(String\(error\)\)|audioError\s*=\s*String\(error\)/);
});
