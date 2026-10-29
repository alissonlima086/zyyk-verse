import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLocale, supportedLocales, translate } from '../src/lib/i18n.ts';

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
