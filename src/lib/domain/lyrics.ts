import type {
  AlignmentGroup,
  ParsedLyrics,
  SourceSegment,
  TranslationUnit,
  TranslationVariant,
  VerseProject,
} from '../types/project.ts';

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `verse-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyProject(title = 'Sem título'): VerseProject {
  const now = new Date().toISOString();
  return {
    format: 'zyyk-verse-project',
    version: 1,
    revision: 0,
    metadata: {
      id: newId(),
      title,
      artist: '',
      album: '',
      createdAt: now,
      updatedAt: now,
    },
    languages: { source: 'en', target: 'pt-BR' },
    sourceSegments: [],
    translations: [],
    alignmentGroups: [],
    audio: null,
    syncTracks: [],
  };
}

export function createEmptyTranslation(): TranslationUnit {
  return {
    id: newId(),
    lineIds: [newId()],
    variants: [],
    selectedVariantId: null,
    status: 'pending',
    notes: '',
  };
}

export function createVariant(text = ''): TranslationVariant {
  const now = new Date().toISOString();
  return { id: newId(), text, notes: '', createdAt: now, updatedAt: now };
}

export function parseLyricsLocally(raw: string): ParsedLyrics {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sourceSegments: SourceSegment[] = [];
  const translations: TranslationUnit[] = [];
  const alignmentGroups: AlignmentGroup[] = [];
  let pendingBreak = false;
  let lineCount = 0;
  let sectionCount = 0;

  const pushSection = (label: string | null) => {
    const source: SourceSegment = { id: newId(), kind: 'section', text: '', label };
    sourceSegments.push(source);
    alignmentGroups.push({ id: newId(), sourceSegmentIds: [source.id], translationUnitIds: [] });
    sectionCount += 1;
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      pendingBreak = sourceSegments.length > 0;
      continue;
    }
    const trimmed = line.trim();
    const explicitSection = trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2
      ? trimmed.slice(1, -1).trim()
      : null;
    if (pendingBreak && !explicitSection) pushSection(null);
    pendingBreak = false;
    if (explicitSection) {
      pushSection(explicitSection);
      continue;
    }
    const source: SourceSegment = { id: newId(), kind: 'line', text: line, label: null };
    const translation = createEmptyTranslation();
    sourceSegments.push(source);
    translations.push(translation);
    alignmentGroups.push({
      id: newId(),
      sourceSegmentIds: [source.id],
      translationUnitIds: [translation.id],
    });
    lineCount += 1;
  }
  return { sourceSegments, translations, alignmentGroups, lineCount, sectionCount };
}

export function selectedVariant(unit: TranslationUnit | null | undefined): TranslationVariant | null {
  if (!unit?.selectedVariantId) return null;
  return unit.variants.find((variant) => variant.id === unit.selectedVariantId) ?? null;
}

export function translationLines(unit: TranslationUnit | null | undefined): string[] {
  return selectedVariant(unit)?.text.split('\n') ?? [''];
}

/**
 * Keeps every translation aligned to an exactly repeated original in lockstep.
 * Empty text is intentional here: clearing a translation must also clear its
 * repetitions so a later replacement does not leave stale copies behind.
 */
export function syncExactDuplicateTranslations(
  project: VerseProject,
  sourceUnitId: string,
): TranslationUnit[] {
  const sourceGroup = project.alignmentGroups.find((group) => group.translationUnitIds.includes(sourceUnitId));
  const sourceUnit = project.translations.find((unit) => unit.id === sourceUnitId);
  if (!sourceGroup || !sourceUnit) return [];
  const originalText = sourceGroup.sourceSegmentIds
    .map((id) => project.sourceSegments.find((segment) => segment.id === id))
    .filter((segment): segment is SourceSegment => segment?.kind === 'line')
    .map((segment) => segment.text.trim())
    .join('\n');
  if (!originalText) return [];

  const sourceText = selectedVariant(sourceUnit)?.text ?? '';
  const changed: TranslationUnit[] = [];
  for (const group of project.alignmentGroups) {
    if (group.id === sourceGroup.id) continue;
    const candidateOriginal = group.sourceSegmentIds
      .map((id) => project.sourceSegments.find((segment) => segment.id === id))
      .filter((segment): segment is SourceSegment => segment?.kind === 'line')
      .map((segment) => segment.text.trim())
      .join('\n');
    if (candidateOriginal !== originalText) continue;
    const candidate = project.translations.find((unit) => group.translationUnitIds.includes(unit.id));
    if (!candidate) continue;
    let variant = selectedVariant(candidate);
    if (!variant) {
      variant = createVariant();
      candidate.variants.push(variant);
      candidate.selectedVariantId = variant.id;
    }
    variant.text = sourceText;
    variant.updatedAt = new Date().toISOString();
    candidate.status = sourceUnit.status;
    changed.push(candidate);
  }
  return changed;
}

export function cloneProject(project: VerseProject): VerseProject {
  // Svelte 5 wraps `$state` objects in deeply reactive proxies. The browser's
  // structuredClone rejects those proxies with a DataCloneError, which used to
  // break import, undo/redo and save as soon as they received the live project.
  // The project format is deliberately JSON-only, so a JSON round-trip is the
  // appropriate boundary between reactive UI state and persistent snapshots.
  return JSON.parse(JSON.stringify(project)) as VerseProject;
}
