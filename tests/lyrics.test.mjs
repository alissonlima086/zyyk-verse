import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  cloneProject,
  createEmptyProject,
  createVariant,
  parseLyricsLocally,
  selectedVariant,
  syncExactDuplicateTranslations,
} from '../src/lib/domain/lyrics.ts';
import {
  cueNeighborLimits,
  cueContextAtTime,
  findAvailableCueRange,
  formatClock,
  MIN_CUE_GAP_US,
  moveCueWithinNeighbors,
  projectToSrt,
  snapTimelineMicroseconds,
} from '../src/lib/domain/sync.ts';
import { insertVaultEntry, moveVaultEntryInTree, removeVaultEntry, renameVaultEntryInTree } from '../src/lib/domain/vault.ts';
import {
  createHistoryEntry,
  MAX_HISTORY_ENTRIES,
  restoreHistoryEntry,
  sameProjectContent,
  trimHistory,
} from '../src/lib/domain/history.ts';

test('mantém o contrato v1 compartilhado com o backend Rust', () => {
  const project = JSON.parse(readFileSync(new URL('./fixtures/project-v1.json', import.meta.url), 'utf8'));
  assert.equal(project.format, 'zyyk-verse-project');
  assert.equal(project.version, 1);
  assert.equal(project.sourceSegments[0].id, project.alignmentGroups[0].sourceSegmentIds[0]);
  assert.equal(project.translations[0].id, project.alignmentGroups[0].translationUnitIds[0]);
});

test('separa texto colado por linha e cria traduções vazias', () => {
  const parsed = parseLyricsLocally('First line\nSecond line');
  assert.equal(parsed.lineCount, 2);
  assert.equal(parsed.translations.length, 2);
  assert.equal(parsed.alignmentGroups.length, 2);
  assert.equal(parsed.translations[0].variants.length, 0);
});

test('normaliza CRLF, BOM e linhas em branco consecutivas', () => {
  const parsed = parseLyricsLocally('\uFEFFFirst\r\n\r\n\r\nSecond');
  assert.equal(parsed.lineCount, 2);
  assert.equal(parsed.sectionCount, 1);
  assert.equal(parsed.sourceSegments[1].kind, 'section');
});

test('reconhece cabeçalhos explícitos sem transformá-los em versos', () => {
  const parsed = parseLyricsLocally('[Verse 1]\nLine\n[Chorus]\nOther');
  assert.equal(parsed.lineCount, 2);
  assert.equal(parsed.sectionCount, 2);
  assert.equal(parsed.sourceSegments[0].label, 'Verse 1');
  assert.equal(parsed.sourceSegments[2].label, 'Chorus');
});

test('mantém traduções de originais idênticos sincronizadas após apagar e substituir', () => {
  const project = createEmptyProject('Repeated lines');
  const parsed = parseLyricsLocally('Same line\nDifferent line\nSame line');
  project.sourceSegments = parsed.sourceSegments;
  project.translations = parsed.translations;
  project.alignmentGroups = parsed.alignmentGroups;
  const source = project.translations[0];
  const repeated = project.translations[2];
  const sourceVariant = createVariant('Primeira tradução');
  source.variants = [sourceVariant];
  source.selectedVariantId = sourceVariant.id;

  syncExactDuplicateTranslations(project, source.id);
  assert.equal(selectedVariant(repeated)?.text, 'Primeira tradução');

  sourceVariant.text = '';
  syncExactDuplicateTranslations(project, source.id);
  assert.equal(selectedVariant(repeated)?.text, '');

  sourceVariant.text = 'Tradução substituta';
  syncExactDuplicateTranslations(project, source.id);
  assert.equal(selectedVariant(repeated)?.text, 'Tradução substituta');
});

test('cria snapshot de projeto mesmo quando o estado é um Proxy reativo', () => {
  const project = createEmptyProject('Proxy test');
  const reactiveProject = new Proxy(project, {});

  const snapshot = cloneProject(reactiveProject);

  assert.deepEqual(snapshot, project);
  assert.notEqual(snapshot, reactiveProject);
  assert.notEqual(snapshot.metadata, project.metadata);
});

test('restaura conteúdo sem regredir revisão ou áudio gerenciado', () => {
  const before = createEmptyProject('Antes');
  before.revision = 2;
  before.audio = { relativePath: 'assets/old.mp3', originalName: 'old.mp3', managed: true };
  const entry = createHistoryEntry(before, 'group-1', 'edição do título');
  const current = cloneProject(before);
  current.revision = 7;
  current.audio = { relativePath: 'assets/current.wav', originalName: 'current.wav', managed: true };
  const restored = restoreHistoryEntry(entry, current);

  assert.equal(restored.project.metadata.title, 'Antes');
  assert.equal(restored.project.revision, 7);
  assert.deepEqual(restored.project.audio, current.audio);
  assert.equal(restored.selectedGroupId, 'group-1');
});

test('ignora metadados transitórios ao detectar uma edição vazia', () => {
  const left = createEmptyProject('Mesmo conteúdo');
  const right = cloneProject(left);
  right.revision = 12;
  right.metadata.updatedAt = new Date(Date.now() + 10_000).toISOString();

  assert.equal(sameProjectContent(left, right), true);
  right.metadata.title = 'Conteúdo alterado';
  assert.equal(sameProjectContent(left, right), false);
});

test('limita o histórico sem remover o estado mais recente', () => {
  const entries = [];
  for (let index = 0; index < MAX_HISTORY_ENTRIES + 5; index += 1) {
    entries.push(createHistoryEntry(createEmptyProject(`Projeto ${index}`), null, `ação ${index}`));
  }
  trimHistory(entries);

  assert.equal(entries.length, MAX_HISTORY_ENTRIES);
  assert.equal(entries.at(-1).project.metadata.title, `Projeto ${MAX_HISTORY_ENTRIES + 4}`);
});

test('exporta a trilha traduzida como SRT ordenado e em milissegundos', () => {
  const project = createEmptyProject('Timed song');
  const parsed = parseLyricsLocally('First\nSecond');
  project.sourceSegments = parsed.sourceSegments;
  project.translations = parsed.translations;
  project.alignmentGroups = parsed.alignmentGroups;
  for (const [index, unit] of project.translations.entries()) {
    const variant = createVariant(index === 0 ? 'Primeira' : 'Segunda');
    unit.variants = [variant];
    unit.selectedVariantId = variant.id;
  }
  project.syncTracks = [{
    id: 'track',
    role: 'translation',
    cues: [
      { id: 'later', targetIds: [project.translations[1].id], startUs: 2_000_000, endUs: 3_250_000, textMode: 'selected-variant' },
      { id: 'first', targetIds: [project.translations[0].id], startUs: 125_000, endUs: 1_500_000, textMode: 'selected-variant' },
    ],
  }];

  assert.equal(projectToSrt(project, 'translation'), '1\n00:00:00,125 --> 00:00:01,500\nPrimeira\n\n2\n00:00:02,000 --> 00:00:03,250\nSegunda\n');
  assert.equal(formatClock(65.432, true), '01:05.432');
});

test('exporta sublinhas da mesma tradução como cues independentes', () => {
  const project = createEmptyProject('Split translation');
  const parsed = parseLyricsLocally('Hello, I am a low battery girl');
  project.sourceSegments = parsed.sourceSegments;
  project.translations = parsed.translations;
  project.alignmentGroups = parsed.alignmentGroups;
  const unit = project.translations[0];
  const variant = createVariant('Olá\nEu sou\nUma garota com 1% de bateria\n(Hm-hm)');
  unit.variants = [variant];
  unit.selectedVariantId = variant.id;
  unit.lineIds = ['line-1', 'line-2', 'line-3', 'line-4'];
  project.syncTracks = [{
    id: 'track',
    role: 'translation',
    cues: unit.lineIds.map((id, index) => ({
      id: `cue-${index}`,
      targetIds: [id],
      startUs: index * 1_000_000,
      endUs: (index + 1) * 1_000_000,
      textMode: 'selected-variant',
    })),
  }];

  assert.equal(projectToSrt(project, 'translation'), '1\n00:00:00,000 --> 00:00:01,000\nOlá\n\n2\n00:00:01,000 --> 00:00:02,000\nEu sou\n\n3\n00:00:02,000 --> 00:00:03,000\nUma garota com 1% de bateria\n\n4\n00:00:03,000 --> 00:00:04,000\n(Hm-hm)\n');
});

test('não exporta silenciosamente um cue sem tradução', () => {
  const project = createEmptyProject('Incomplete');
  const parsed = parseLyricsLocally('Only line');
  project.sourceSegments = parsed.sourceSegments;
  project.translations = parsed.translations;
  project.alignmentGroups = parsed.alignmentGroups;
  project.syncTracks = [{
    id: 'track',
    role: 'translation',
    cues: [{ id: 'cue', targetIds: [project.translations[0].id], startUs: 0, endUs: 1_000_000, textMode: 'selected-variant' }],
  }];

  assert.throws(() => projectToSrt(project, 'translation'), /sem tradução selecionada/);
});

test('quantiza a timeline por frame quando não há alvo magnético próximo', () => {
  const result = snapTimelineMicroseconds(1_051_000, 10_000_000, 1_000, 30, [2_000_000]);
  assert.equal(result.microseconds, 1_066_667);
  assert.equal(result.magneticTargetUs, null);
});

test('prioriza um limite magnético dentro da distância visual configurada', () => {
  const result = snapTimelineMicroseconds(1_955_000, 10_000_000, 1_000, 30, [2_000_000]);
  assert.equal(result.microseconds, 2_000_000);
  assert.equal(result.magneticTargetUs, 2_000_000);
});

test('impede sobreposição e mantém um milissegundo entre cues vizinhos', () => {
  const previous = { id: 'previous', targetIds: [], startUs: 0, endUs: 1_000_000, textMode: 'source' };
  const moving = { id: 'moving', targetIds: [], startUs: 2_000_000, endUs: 3_000_000, textMode: 'source' };
  const next = { id: 'next', targetIds: [], startUs: 4_000_000, endUs: 5_000_000, textMode: 'source' };
  const cues = [previous, moving, next];

  assert.deepEqual(cueNeighborLimits(cues, moving, 6_000_000), {
    minimumStartUs: previous.endUs + MIN_CUE_GAP_US,
    maximumEndUs: next.startUs - MIN_CUE_GAP_US,
  });
  assert.deepEqual(moveCueWithinNeighbors(cues, moving, 900_000, 6_000_000), {
    startUs: 1_001_000,
    endUs: 2_001_000,
  });
  assert.deepEqual(moveCueWithinNeighbors(cues, moving, 3_500_000, 6_000_000), {
    startUs: 2_999_000,
    endUs: 3_999_000,
  });
});

test('localiza cue atual e anterior sem reordenar a trilha a cada atualização', () => {
  const cues = [
    { id: 'one', targetIds: [], startUs: 0, endUs: 1_000_000, textMode: 'source' },
    { id: 'two', targetIds: [], startUs: 2_000_000, endUs: 3_000_000, textMode: 'source' },
  ];
  assert.equal(cueContextAtTime(cues, 0.5).current?.id, 'one');
  assert.equal(cueContextAtTime(cues, 1.5).previous?.id, 'one');
  assert.equal(cueContextAtTime(cues, 2.5).current?.id, 'two');
});

test('adiciona texto no playhead ou no primeiro espaço disponível adiante', () => {
  const cues = [
    { id: 'one', targetIds: [], startUs: 1_000_000, endUs: 2_000_000, textMode: 'selected-variant' },
    { id: 'two', targetIds: [], startUs: 3_000_000, endUs: 4_000_000, textMode: 'selected-variant' },
  ];

  assert.deepEqual(findAvailableCueRange(cues, 500_000, 6_000_000), {
    startUs: 500_000,
    endUs: 999_000,
  });
  assert.deepEqual(findAvailableCueRange(cues, 1_500_000, 6_000_000), {
    startUs: 2_001_000,
    endUs: 2_999_000,
  });
  assert.deepEqual(findAvailableCueRange(cues, 3_500_000, 6_000_000), {
    startUs: 4_001_000,
    endUs: 5_001_000,
  });
});

test('atualiza a árvore da vault incrementalmente em criação, movimento, renomeação e remoção', () => {
  const project = { name: 'Song', path: '/vault/Song.zyykverse', kind: 'project', children: [] };
  let entries = insertVaultEntry([], '/vault', null, project);
  const folder = { name: 'Album', path: '/vault/Album', kind: 'folder', children: [] };
  entries = insertVaultEntry(entries, '/vault', null, folder);
  entries = moveVaultEntryInTree(entries, '/vault', project.path, folder.path, '/vault/Album/Song.zyykverse');
  assert.equal(entries[0].children[0].path, '/vault/Album/Song.zyykverse');
  entries = renameVaultEntryInTree(entries, folder.path, '/vault/Archive', 'Archive');
  assert.equal(entries[0].name, 'Archive');
  assert.equal(entries[0].children[0].path, '/vault/Archive/Song.zyykverse');
  entries = removeVaultEntry(entries, '/vault/Archive');
  assert.deepEqual(entries, []);
});
