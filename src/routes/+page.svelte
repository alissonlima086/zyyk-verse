<script lang="ts">
  import { onMount } from 'svelte';
  import {
    cloneProject,
    createEmptyProject,
    createEmptyTranslation,
    createVariant,
    newId,
    parseLyricsLocally,
    selectedVariant,
    syncExactDuplicateTranslations,
    translationLines,
  } from '#lib/domain/lyrics.ts';
  import {
    cueNeighborLimits,
    cueContextAtTime,
    createTimelineTicks,
    findAvailableCueRange,
    formatClock,
    moveCueWithinNeighbors,
    projectToSrt,
    snapTimelineMicroseconds,
    sortedCues,
  } from '#lib/domain/sync.ts';
  import {
    chooseAudioFile,
    chooseVaultFolder,
    createVaultFolder,
    createVaultProject,
    deleteVaultEntry,
    exportTextFile,
    importProjectAudio,
    listVault,
    loadWaveformCache,
    moveVaultEntry,
    openProject,
    parseLyrics,
    renameVaultEntry,
    resolveProjectAudio,
    saveWaveformCache,
    saveProject,
  } from '#lib/services/projectBackend.ts';
  import { decodeWaveform } from '#lib/services/waveform.ts';
  import { insertVaultEntry, moveVaultEntryInTree, removeVaultEntry, renameVaultEntryInTree } from '#lib/domain/vault.ts';
  import {
    createHistoryEntry,
    restoreHistoryEntry,
    sameProjectContent,
    trimHistory,
    type ProjectHistoryEntry,
  } from '#lib/domain/history.ts';
  import type {
    AlignmentGroup,
    ProgressStatus,
    SourceSegment,
    SyncCue,
    SyncRole,
    SyncTrack,
    TranslationUnit,
    VaultEntry,
    VerseProject,
  } from '#lib/types/project.ts';

  let project = $state<VerseProject>(createEmptyProject('Nova música'));
  let filePath = $state<string | null>(null);
  let dirty = $state(false);
  let saving = $state(false);
  let vaultOpen = $state(true);
  let detailsOpen = $state(false);
  let showImport = $state(false);
  let importText = $state('');
  let importTitle = $state('Nova música');
  let importError = $state('');
  let selectedGroupId = $state<string | null>(null);
  let editingKey: string | null = null;
  let editingStartVersion = 0;
  let editingTranslationUnit: TranslationUnit | null = null;
  // History snapshots are immutable. Keeping them raw avoids Svelte wrapping
  // every field of every historical project in reactive proxies.
  let undoStack = $state.raw<ProjectHistoryEntry[]>([]);
  let redoStack = $state.raw<ProjectHistoryEntry[]>([]);
  let toast = $state('');
  let vaultPath = $state<string | null>(null);
  let vaultEntries = $state<VaultEntry[]>([]);
  let vaultReady = $state(false);
  let vaultSearch = $state('');
  let selectedFolderPath = $state<string | null>(null);
  let expandedFolderPaths = $state<string[]>([]);
  let renameTarget = $state<VaultEntry | null>(null);
  let renameName = $state('');
  let draggedVaultPath = $state<string | null>(null);
  let audioUrl = $state('');
  let audioDropActive = $state(false);
  let newMenuOpen = $state(false);
  let createMode = $state<'project' | 'folder' | null>(null);
  let createName = $state('');
  let vaultDragActive = $state(false);
  let vaultDropTarget = $state<string | null>(null);
  let audioError = $state('');
  let contextMenu = $state<{ x: number; y: number; entry: VaultEntry | null } | null>(null);
  let dragStart: { x: number; y: number; path: string } | null = null;
  let suppressVaultClick = false;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveRequested = false;
  let activeSave: Promise<boolean> | null = null;
  let changeVersion = 0;
  let playbackAnimationFrame: number | null = null;
  let lastPlaybackPaint = 0;
  const TIMELINE_FPS = 30;
  const FRAME_US = Math.round(1_000_000 / TIMELINE_FPS);
  let audioElement = $state<HTMLAudioElement>();
  let timelineContent: HTMLDivElement;
  let audioDuration = $state(0);
  let currentTime = $state(0);
  let audioPlaying = $state(false);
  let waveformPeaks = $state<number[]>([]);
  let waveformLoading = $state(false);
  let waveformPending = $state(false);
  let waveformTimer: ReturnType<typeof setTimeout> | null = null;
  let waveformAbort: AbortController | null = null;
  let waveformGeneration = 0;
  let textareaResizeFrame: number | null = null;
  const pendingTextareaResizes = new Set<HTMLTextAreaElement>();
  let timelineZoom = $state(1);
  let editorZoom = $state(1);
  const syncRole: SyncRole = 'translation';
  let draggingCue: {
    cue: SyncCue;
    boundary: 'start' | 'end' | 'move';
    grabOffsetUs?: number;
    pointerStartX?: number;
    started?: boolean;
  } | null = null;
  let scrubbingPlayhead = $state(false);
  let snapGuideUs = $state<number | null>(null);
  let lastAutoScrolledCueId: string | null = null;

  const completedCount = $derived(project.translations.filter((unit) => unit.status === 'completed').length);
  const canUndo = $derived(undoStack.length > 0);
  const canRedo = $derived(redoStack.length > 0);
  const undoLabel = $derived(undoStack.at(-1)?.label ?? 'alteração');
  const redoLabel = $derived(redoStack.at(-1)?.label ?? 'alteração');
  const progress = $derived(project.translations.length ? Math.round((completedCount / project.translations.length) * 100) : 0);
  const sourceIndex = $derived.by(() => new Map(project.sourceSegments.map((segment) => [segment.id, segment])));
  const translationIndex = $derived.by(() => new Map(project.translations.map((unit) => [unit.id, unit])));
  const groupByTarget = $derived.by(() => {
    const index = new Map<string, AlignmentGroup>();
    for (const group of project.alignmentGroups) {
      for (const id of [...group.sourceSegmentIds, ...group.translationUnitIds]) index.set(id, group);
      for (const unitId of group.translationUnitIds) {
        for (const lineId of translationIndex.get(unitId)?.lineIds ?? []) index.set(lineId, group);
      }
    }
    return index;
  });
  const cueByTarget = $derived.by(() => {
    const index: Record<SyncRole, Map<string, SyncCue>> = { source: new Map(), translation: new Map() };
    for (const track of project.syncTracks ?? []) {
      for (const cue of track.cues) for (const id of cue.targetIds) index[track.role].set(id, cue);
    }
    return index;
  });
  const lineLabels = $derived.by(() => {
    const labels = new Map<string, string>();
    let count = 0;
    for (const group of project.alignmentGroups) {
      const size = group.sourceSegmentIds.filter((id) => sourceIndex.get(id)?.kind === 'line').length;
      if (!size) continue;
      const first = count + 1;
      count += size;
      labels.set(group.id, size > 1 ? `${String(first).padStart(2, '0')}–${String(count).padStart(2, '0')}` : String(count).padStart(2, '0'));
    }
    return labels;
  });
  const importPreview = $derived.by(() => {
    if (!importText.trim()) return { lineCount: 0, sectionCount: 0 };
    const parsed = parseLyricsLocally(importText);
    return { lineCount: parsed.lineCount, sectionCount: parsed.sectionCount };
  });
  const selectedGroup = $derived(project.alignmentGroups.find((group) => group.id === selectedGroupId) ?? null);
  const selectedUnit = $derived(translationFor(selectedGroup));
  const activeTrack = $derived(project.syncTracks?.find((track) => track.role === syncRole) ?? null);
  const activeCuesSorted = $derived.by(() => sortedCues(activeTrack?.cues ?? []));
  const playheadContext = $derived.by(() => {
    return cueContextAtTime(activeCuesSorted, currentTime);
  });
  const timelineTicks = $derived.by(() => createTimelineTicks(audioDuration, timelineZoom));
  const waveformPath = $derived.by(() => {
    if (!waveformPeaks.length) return '';
    const top = waveformPeaks.map((peak, index) => `${index},${1 - peak}`).join(' L');
    const bottom = waveformPeaks.map((peak, index) => `${waveformPeaks.length - index - 1},${1 + waveformPeaks[waveformPeaks.length - index - 1]}`).join(' L');
    return `M${top} L${bottom} Z`;
  });
  const flatVaultEntries = $derived.by(() => {
    const result: Array<{ entry: VaultEntry; depth: number; expanded: boolean }> = [];
    const query = vaultSearch.trim().toLowerCase();
    const visit = (entries: VaultEntry[], depth: number) => {
      for (const entry of entries) {
        if (query && !vaultEntryMatches(entry, query)) continue;
        const expanded = entry.kind === 'folder' && (Boolean(query) || expandedFolderPaths.includes(entry.path));
        result.push({ entry, depth, expanded });
        if (entry.kind === 'folder' && expanded) visit(entry.children, depth + 1);
      }
    };
    visit(vaultEntries, 0);
    return result;
  });

  function vaultEntryMatches(entry: VaultEntry, query: string): boolean {
    return entry.name.toLowerCase().includes(query)
      || (entry.kind === 'folder' && entry.children.some((child) => vaultEntryMatches(child, query)));
  }

  $effect(() => {
    if (!audioPlaying) return;
    const focusCue = playheadContext.current ?? playheadContext.previous;
    if (!focusCue) return;
    if (focusCue.id === lastAutoScrolledCueId) return;
    lastAutoScrolledCueId = focusCue.id;
    const group = groupForCue(focusCue);
    if (!group) return;
    requestAnimationFrame(() => {
      const scroller = document.querySelector<HTMLElement>('.editor-scroll');
      if (!scroller) return;
      const rows = Array.from(scroller.querySelectorAll<HTMLElement>('.lyric-row'));
      const activeIndex = rows.findIndex((row) => row.dataset.groupId === group.id);
      if (activeIndex < 0) return;
      const activeRow = rows[activeIndex];
      const bufferedRow = rows[Math.min(rows.length - 1, activeIndex + 2)];
      const viewport = scroller.getBoundingClientRect();
      const activeBounds = activeRow.getBoundingClientRect();
      const bufferedBounds = bufferedRow.getBoundingClientRect();
      if (activeBounds.top < viewport.top + 8) {
        scroller.scrollBy({ top: activeBounds.top - viewport.top - 8, behavior: 'smooth' });
      } else if (bufferedBounds.bottom > viewport.bottom - 10) {
        scroller.scrollBy({ top: bufferedBounds.bottom - viewport.bottom + 10, behavior: 'smooth' });
      }
    });
  });

  $effect(() => {
    // Recalcula a altura quando o destaque muda a tipografia, quando o zoom
    // muda ou quando uma nova estrutura de linhas é renderizada.
    playheadContext.current?.id;
    editorZoom;
    project.alignmentGroups.length;
    requestAnimationFrame(resizeEditorTextareas);
  });

  function resizeTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = '0px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function scheduleTextareaResize(textarea: HTMLTextAreaElement) {
    pendingTextareaResizes.add(textarea);
    if (textareaResizeFrame !== null) return;
    textareaResizeFrame = requestAnimationFrame(() => {
      for (const pending of pendingTextareaResizes) resizeTextarea(pending);
      pendingTextareaResizes.clear();
      textareaResizeFrame = null;
    });
  }

  function resizeEditorTextareas() {
    document.querySelectorAll<HTMLTextAreaElement>('.lyric-row textarea').forEach(resizeTextarea);
  }

  function sourceFor(id: string): SourceSegment | null {
    return sourceIndex.get(id) ?? null;
  }

  function sourcesFor(group: AlignmentGroup | null): SourceSegment[] {
    if (!group) return [];
    return group.sourceSegmentIds.map(sourceFor).filter((segment): segment is SourceSegment => Boolean(segment));
  }

  function translationFor(group: AlignmentGroup | null): TranslationUnit | null {
    const id = group?.translationUnitIds[0];
    return id ? translationIndex.get(id) ?? null : null;
  }

  function translationTargetId(unit: TranslationUnit, lineIndex: number): string {
    return unit.lineIds?.[lineIndex] ?? (lineIndex === 0 ? unit.id : '');
  }

  function ensureTranslationLineIds(unit: TranslationUnit, count = translationLines(unit).length) {
    unit.lineIds ??= [];
    while (unit.lineIds.length < Math.max(1, count)) unit.lineIds.push(newId());
    if (count > 1) {
      const track = trackFor('translation');
      const legacyCue = track?.cues.find((cue) => cue.targetIds.includes(unit.id));
      if (legacyCue) legacyCue.targetIds = legacyCue.targetIds.map((id) => id === unit.id ? unit.lineIds[0] : id);
    }
  }

  function targetIdsFor(group: AlignmentGroup, role: SyncRole, translationLineIndex = 0): string[] {
    const unit = translationFor(group);
    return role === 'source'
      ? group.sourceSegmentIds.filter((id) => sourceFor(id)?.kind === 'line')
      : unit ? [translationTargetId(unit, translationLineIndex)].filter(Boolean) : [];
  }

  function syncGroups(role = syncRole): AlignmentGroup[] {
    return project.alignmentGroups.filter((group) => targetIdsFor(group, role).length > 0);
  }

  function trackFor(role: SyncRole, create = false): SyncTrack | null {
    project.syncTracks ??= [];
    let track = project.syncTracks.find((candidate) => candidate.role === role) ?? null;
    if (!track && create) {
      track = { id: newId(), role, cues: [] };
      project.syncTracks.push(track);
    }
    return track;
  }

  function cueForGroup(group: AlignmentGroup | null, role = syncRole): SyncCue | null {
    if (!group) return null;
    const unit = translationFor(group);
    const ids = role === 'translation' && unit
      ? [unit.id, ...(unit.lineIds ?? [])]
      : targetIdsFor(group, role);
    for (const id of ids) {
      const cue = cueByTarget[role].get(id);
      if (cue) return cue;
    }
    return null;
  }

  function cueForTranslationLine(group: AlignmentGroup, lineIndex: number): SyncCue | null {
    const unit = translationFor(group);
    if (!unit) return null;
    return cueByTarget.translation.get(translationTargetId(unit, lineIndex))
      ?? (lineIndex === 0 ? cueByTarget.translation.get(unit.id) ?? null : null);
  }

  function groupForCue(cue: SyncCue | null | undefined): AlignmentGroup | null {
    if (!cue) return null;
    return cue.targetIds.map((id) => groupByTarget.get(id)).find(Boolean) ?? null;
  }

  function lineNumber(groupIndex: number): string {
    return lineLabels.get(project.alignmentGroups[groupIndex]?.id) ?? '00';
  }

  function cuePreview(group: AlignmentGroup | null, cue?: SyncCue | null): string {
    if (!group) return 'Verso sem texto';
    const unit = translationFor(group);
    const lineIndex = unit && cue
      ? (unit.lineIds ?? []).findIndex((id) => cue.targetIds.includes(id))
      : -1;
    const translated = lineIndex >= 0
      ? translationLines(unit)[lineIndex]?.trim()
      : selectedVariant(unit)?.text.trim();
    const original = sourcesFor(group)
      .filter((source) => source.kind === 'line')
      .map((source) => source.text.trim())
      .filter(Boolean)
      .join(' / ');
    return (translated || original || 'Verso sem texto').replace(/\s+/g, ' ');
  }

  function historyWithCheckpoint(stack: ProjectHistoryEntry[], label: string): ProjectHistoryEntry[] {
    const next = [...stack, createHistoryEntry(project, selectedGroupId, label)];
    trimHistory(next);
    return next;
  }

  function finishEdit() {
    if (!editingKey) return;
    if (editingTranslationUnit && editingStartVersion !== changeVersion) {
      syncExactDuplicates(editingTranslationUnit);
    }
    if (editingStartVersion === changeVersion) undoStack = undoStack.slice(0, -1);
    editingKey = null;
    editingTranslationUnit = null;
  }

  function discardUnchangedCheckpoint(): boolean {
    const checkpoint = undoStack.at(-1);
    if (!checkpoint || !sameProjectContent(checkpoint.project, project)) return false;
    undoStack = undoStack.slice(0, -1);
    return true;
  }

  function remember(label = 'alteração') {
    finishEdit();
    undoStack = historyWithCheckpoint(undoStack, label);
    redoStack = [];
  }

  function beginEdit(key: string, label = 'edição de texto') {
    if (editingKey === key) return;
    finishEdit();
    undoStack = historyWithCheckpoint(undoStack, label);
    redoStack = [];
    editingKey = key;
    editingStartVersion = changeVersion;
  }

  function beginTranslationEdit(unit: TranslationUnit, key: string) {
    if (editingKey === key) return;
    beginEdit(key, 'edição da tradução');
    editingTranslationUnit = unit;
  }

  function endEdit() {
    finishEdit();
  }

  function touch() {
    project.metadata.updatedAt = new Date().toISOString();
    dirty = true;
    changeVersion += 1;
    // Qualquer alteração nova cria uma linha do tempo diferente.
    if (redoStack.length) redoStack = [];
    scheduleAutosave();
  }

  function scheduleAutosave() {
    if (!vaultPath) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void saveCurrent(true), 850);
  }

  function undo() {
    finishEdit();
    const previous = undoStack.at(-1);
    if (!previous) return;
    undoStack = undoStack.slice(0, -1);
    redoStack = historyWithCheckpoint(redoStack, previous.label);
    const restored = restoreHistoryEntry(previous, project);
    project = restored.project;
    selectedGroupId = restored.selectedGroupId;
    dirty = true;
    changeVersion += 1;
    scheduleAutosave();
  }

  function redo() {
    finishEdit();
    const next = redoStack.at(-1);
    if (!next) return;
    redoStack = redoStack.slice(0, -1);
    undoStack = historyWithCheckpoint(undoStack, next.label);
    const restored = restoreHistoryEntry(next, project);
    project = restored.project;
    selectedGroupId = restored.selectedGroupId;
    dirty = true;
    changeVersion += 1;
    scheduleAutosave();
  }

  function updateOriginal(segment: SourceSegment, text: string) {
    segment.text = text;
    touch();
  }

  function updateTranslation(unit: TranslationUnit, text: string) {
    let variant = selectedVariant(unit);
    if (!variant) {
      variant = createVariant();
      unit.variants.push(variant);
      unit.selectedVariantId = variant.id;
    }
    variant.text = text;
    variant.updatedAt = new Date().toISOString();
    // Digitar e validar são ações independentes: uma tradução pode existir e
    // continuar pendente até o usuário marcar revisão ou conclusão.
    if (!text.trim() && unit.status === 'completed') unit.status = 'pending';
    touch();
  }

  function updateTranslationLine(unit: TranslationUnit, lineIndex: number, text: string) {
    const lines = translationLines(unit);
    while (lines.length <= lineIndex) lines.push('');
    lines[lineIndex] = text.replace(/\r?\n/g, ' ');
    updateTranslation(unit, lines.join('\n'));
  }

  function addTranslationLine(group: AlignmentGroup, afterIndex: number) {
    const unit = translationFor(group);
    if (!unit) return;
    remember('quebra da tradução');
    const lines = translationLines(unit);
    ensureTranslationLineIds(unit, lines.length);
    lines.splice(afterIndex + 1, 0, '');
    unit.lineIds.splice(afterIndex + 1, 0, newId());
    ensureTranslationLineIds(unit, lines.length);
    updateTranslation(unit, lines.join('\n'));
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(`[data-translation-line-id="${unit.lineIds[afterIndex + 1]}"]`)?.focus();
    });
  }

  function deleteTranslationLine(group: AlignmentGroup, lineIndex: number) {
    const unit = translationFor(group);
    const lines = translationLines(unit);
    if (!unit || lines.length <= 1) return;
    ensureTranslationLineIds(unit, lines.length);
    remember('remoção de quebra da tradução');
    const removedId = unit.lineIds[lineIndex];
    lines.splice(lineIndex, 1);
    unit.lineIds.splice(lineIndex, 1);
    const track = trackFor('translation');
    if (track) track.cues = track.cues.filter((cue) => !cue.targetIds.includes(removedId));
    updateTranslation(unit, lines.join('\n'));
  }

  async function copyLine(text: string, label: string) {
    if (!text.trim()) {
      notify(`A ${label.toLowerCase()} está vazia.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand('copy');
      helper.remove();
      if (!copied) return notify(`Não foi possível copiar a ${label.toLowerCase()}.`);
    }
    notify(`${label} copiada.`);
  }

  function syncExactDuplicates(sourceUnit: TranslationUnit) {
    for (const candidate of syncExactDuplicateTranslations(project, sourceUnit.id)) {
      ensureTranslationLineIds(candidate);
    }
  }

  function setStatus(unit: TranslationUnit, target: ProgressStatus) {
    if (target === 'completed' && !selectedVariant(unit)?.text.trim()) {
      notify('Escreva uma tradução antes de concluir.');
      return;
    }
    remember('mudança de estado');
    unit.status = target;
    syncExactDuplicates(unit);
    touch();
  }

  function statusLabel(status: ProgressStatus): string {
    if (status === 'completed') return 'Concluído';
    if (status === 'review') return 'Em revisão';
    return 'Pendente';
  }

  function addLine(afterGroupId?: string) {
    remember('adição de verso');
    const source: SourceSegment = { id: newId(), kind: 'line', text: '', label: null };
    const unit = createEmptyTranslation();
    const group: AlignmentGroup = {
      id: newId(),
      sourceSegmentIds: [source.id],
      translationUnitIds: [unit.id],
    };
    const groupIndex = afterGroupId
      ? project.alignmentGroups.findIndex((candidate) => candidate.id === afterGroupId) + 1
      : project.alignmentGroups.length;
    const previousGroup = project.alignmentGroups[Math.max(0, groupIndex - 1)];
    const previousSourceId = previousGroup?.sourceSegmentIds.at(-1);
    const sourceIndex = previousSourceId
      ? project.sourceSegments.findIndex((segment) => segment.id === previousSourceId) + 1
      : project.sourceSegments.length;
    project.sourceSegments.splice(sourceIndex, 0, source);
    project.translations.push(unit);
    project.alignmentGroups.splice(groupIndex, 0, group);
    selectedGroupId = group.id;
    touch();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-source-id="${source.id}"]`)?.focus());
  }

  function deleteGroup(group: AlignmentGroup) {
    const units = group.translationUnitIds
      .map((id) => project.translations.find((unit) => unit.id === id))
      .filter((unit): unit is TranslationUnit => Boolean(unit));
    const hasAuthoredWork = units.some((unit) => unit.variants.some((variant) => variant.text.trim()) || unit.notes.trim());
    if (hasAuthoredWork && !confirm('Este verso possui tradução ou observações. Excluir o original também removerá esses dados. Continuar?')) return;
    remember('exclusão de verso');
    const sourceIds = new Set(group.sourceSegmentIds);
    const translationIds = new Set([
      ...group.translationUnitIds,
      ...units.flatMap((unit) => unit.lineIds ?? []),
    ]);
    project.sourceSegments = project.sourceSegments.filter((segment) => !sourceIds.has(segment.id));
    project.translations = project.translations.filter((unit) => !translationIds.has(unit.id));
    project.syncTracks = (project.syncTracks ?? []).map((track) => ({
      ...track,
      cues: track.cues.filter((cue) => !cue.targetIds.some((id) => sourceIds.has(id) || translationIds.has(id))),
    }));
    project.alignmentGroups = project.alignmentGroups.filter((candidate) => candidate.id !== group.id);
    selectedGroupId = project.alignmentGroups.find((candidate) => translationFor(candidate))?.id ?? null;
    touch();
    notify('Verso removido. Use Ctrl+Z para desfazer.');
  }

  async function confirmImport() {
    importError = '';
    try {
      if (project.sourceSegments.length && !confirm('Substituir a letra atual? Traduções e alinhamentos existentes serão removidos, mas a ação poderá ser desfeita.')) return;
      const parsed = await parseLyrics(importText);
      remember('importação da letra');
      project.metadata.title = importTitle.trim() || 'Nova música';
      project.sourceSegments = parsed.sourceSegments;
      project.translations = parsed.translations;
      project.alignmentGroups = parsed.alignmentGroups;
      project.syncTracks = [];
      selectedGroupId = parsed.alignmentGroups.find((group) => group.translationUnitIds.length)?.id ?? null;
      showImport = false;
      importText = '';
      await ensureProjectFile();
      touch();
      notify(`${parsed.lineCount} versos organizados por linha.`);
    } catch (error) {
      importError = String(error instanceof Error ? error.message : error);
    }
  }

  function addVariant(unit: TranslationUnit) {
    remember('adição de variante');
    const variant = createVariant();
    unit.variants.push(variant);
    unit.selectedVariantId = variant.id;
    touch();
  }

  function selectVariant(unit: TranslationUnit, variantId: string) {
    remember('seleção de variante');
    unit.selectedVariantId = variantId;
    ensureTranslationLineIds(unit);
    touch();
  }

  function deleteVariant(unit: TranslationUnit, variantId: string) {
    remember('exclusão de variante');
    unit.variants = unit.variants.filter((variant) => variant.id !== variantId);
    if (unit.selectedVariantId === variantId) unit.selectedVariantId = unit.variants[0]?.id ?? null;
    if (!selectedVariant(unit)?.text.trim() && unit.status === 'completed') unit.status = 'review';
    touch();
  }

  async function ensureProjectFile(): Promise<boolean> {
    if (filePath) return true;
    if (!vaultPath) return false;
    const created = await createVaultProject(vaultPath, selectedFolderPath, project.metadata.title);
    filePath = created.path;
    localStorage.setItem('zyykVerse.lastProject', filePath);
    await refreshVault();
    return true;
  }

  async function saveCurrent(silent = false): Promise<boolean> {
    if (activeSave) {
      saveRequested = true;
      return activeSave;
    }
    activeSave = (async () => {
      if (!(await ensureProjectFile())) return false;
      saving = true;
      let saved = false;
      try {
        do {
          saveRequested = false;
          const savingVersion = changeVersion;
          const result = await saveProject(cloneProject(project), filePath);
          if (!result) return false;
          saved = true;
          filePath = result.path;
          project.revision = result.project.revision;
          project.metadata.updatedAt = result.project.metadata.updatedAt;
          if (savingVersion === changeVersion && !saveRequested) dirty = false;
          localStorage.setItem('zyykVerse.lastProject', filePath);
        } while (saveRequested || dirty);
        if (!silent) notify('Projeto salvo.');
        return saved;
      } catch (error) {
        notify(`Falha ao salvar: ${String(error)}`);
        return false;
      } finally {
        saving = false;
      }
    })();
    try {
      return await activeSave;
    } finally {
      activeSave = null;
    }
  }

  async function openVaultFile(path: string) {
    try {
      if (dirty && !(await saveCurrent(true))) return;
      project = await openProject(path);
      project.syncTracks ??= [];
      filePath = path;
      dirty = false;
      undoStack = [];
      redoStack = [];
      selectedGroupId = project.alignmentGroups.find((group) => group.translationUnitIds.length)?.id ?? null;
      localStorage.setItem('zyykVerse.lastProject', path);
      await loadProjectAudio();
    } catch (error) {
      notify(`Falha ao abrir: ${String(error)}`);
    }
  }

  async function refreshVault() {
    if (!vaultPath) return;
    vaultEntries = await listVault(vaultPath);
  }

  async function selectVault() {
    const selected = await chooseVaultFolder();
    if (!selected) return;
    if (dirty && !(await saveCurrent(true))) return;
    vaultPath = selected;
    selectedFolderPath = null;
    localStorage.setItem('zyykVerse.vaultPath', selected);
    vaultReady = true;
    await refreshVault();
    const firstProject = flattenProjects(vaultEntries)[0];
    if (firstProject) {
      revealVaultEntry(firstProject.path);
      await openVaultFile(firstProject.path);
    } else {
      project = createEmptyProject('Nova música');
      filePath = null;
      dirty = false;
      undoStack = [];
      redoStack = [];
      selectedGroupId = null;
      resetWaveform();
      audioUrl = '';
      localStorage.removeItem('zyykVerse.lastProject');
    }
  }

  function flattenProjects(entries: VaultEntry[]): VaultEntry[] {
    return entries.flatMap((entry) => entry.kind === 'project' ? [entry] : flattenProjects(entry.children));
  }

  function ancestorFolders(entries: VaultEntry[], targetPath: string): string[] | null {
    for (const entry of entries) {
      if (entry.path === targetPath) return [];
      if (entry.kind === 'folder') {
        const nested = ancestorFolders(entry.children, targetPath);
        if (nested) return [entry.path, ...nested];
      }
    }
    return null;
  }

  function revealVaultEntry(path: string) {
    const ancestors = ancestorFolders(vaultEntries, path) ?? [];
    expandedFolderPaths = [...new Set([...expandedFolderPaths, ...ancestors])];
  }

  function beginCreate(mode: 'project' | 'folder', parent?: string | null) {
    if (parent !== undefined) selectedFolderPath = parent;
    if (parent && !expandedFolderPaths.includes(parent)) expandedFolderPaths = [...expandedFolderPaths, parent];
    createMode = mode;
    createName = mode === 'project' ? 'Nova música' : '';
    newMenuOpen = false;
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.vault-create-input input')?.select());
  }

  async function confirmCreate() {
    if (!createMode || !createName.trim()) return;
    const mode = createMode;
    const name = createName.trim();
    createMode = null;
    createName = '';
    if (mode === 'project') await createNewProject(name);
    else await createNewFolder(name);
  }

  async function createNewProject(title: string) {
    if (!vaultPath) return;
    if (dirty && !(await saveCurrent(true))) return;
    const created = await createVaultProject(vaultPath, selectedFolderPath, title);
    project = created.project;
    filePath = created.path;
    dirty = false;
    selectedGroupId = null;
    undoStack = [];
    redoStack = [];
    resetWaveform();
    audioUrl = '';
    localStorage.setItem('zyykVerse.lastProject', filePath);
    vaultEntries = insertVaultEntry(vaultEntries, vaultPath, selectedFolderPath, {
      name: created.path.split(/[\\/]/).at(-1)?.replace(/\.zyykverse$/, '') ?? title,
      path: created.path,
      kind: 'project',
      children: [],
    });
  }

  async function createNewFolder(name: string) {
    if (!vaultPath) return;
    try {
      const path = await createVaultFolder(vaultPath, selectedFolderPath, name);
      vaultEntries = insertVaultEntry(vaultEntries, vaultPath, selectedFolderPath, {
        name: path.split(/[\\/]/).at(-1) ?? name,
        path,
        kind: 'folder',
        children: [],
      });
    } catch (error) {
      notify(String(error));
    }
  }

  function toggleVaultFolder(path: string) {
    selectedFolderPath = path;
    expandedFolderPaths = expandedFolderPaths.includes(path)
      ? expandedFolderPaths.filter((candidate) => candidate !== path)
      : [...expandedFolderPaths, path];
  }

  function beginRename(entry: VaultEntry) {
    contextMenu = null;
    renameTarget = entry;
    renameName = entry.name;
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.vault-rename-row input')?.select());
  }

  function cancelRename() {
    renameTarget = null;
    renameName = '';
  }

  async function confirmRename(entry: VaultEntry) {
    if (!vaultPath || renameTarget?.path !== entry.path) return;
    const name = renameName.trim();
    cancelRename();
    if (!name || name === entry.name) return;
    const activeInsideEntry = filePath === entry.path || Boolean(filePath?.startsWith(`${entry.path}/`));
    if (activeInsideEntry && dirty && !(await saveCurrent(true))) return;
    try {
      const renamedPath = await renameVaultEntry(vaultPath, entry.path, name);
      const rewrite = (path: string | null) => path && (path === entry.path || path.startsWith(`${entry.path}/`))
        ? path.replace(entry.path, renamedPath)
        : path;
      filePath = rewrite(filePath);
      selectedFolderPath = rewrite(selectedFolderPath);
      expandedFolderPaths = expandedFolderPaths.map((path) => rewrite(path) ?? path);
      if (filePath) localStorage.setItem('zyykVerse.lastProject', filePath);
      vaultEntries = renameVaultEntryInTree(vaultEntries, entry.path, renamedPath, name);
      notify(entry.kind === 'folder' ? 'Pasta renomeada.' : 'Projeto renomeado.');
    } catch (error) {
      notify(`Não foi possível renomear: ${String(error)}`);
    }
  }

  async function dropVaultEntry(targetDirectory: string) {
    if (!vaultPath || !draggedVaultPath || draggedVaultPath === targetDirectory) return;
    const source = draggedVaultPath;
    draggedVaultPath = null;
    try {
      const moved = await moveVaultEntry(vaultPath, source, targetDirectory);
      if (filePath === source || filePath?.startsWith(`${source}/`)) {
        filePath = filePath.replace(source, moved);
        localStorage.setItem('zyykVerse.lastProject', filePath);
      }
      vaultEntries = moveVaultEntryInTree(vaultEntries, vaultPath, source, targetDirectory, moved);
      if (!expandedFolderPaths.includes(targetDirectory)) expandedFolderPaths = [...expandedFolderPaths, targetDirectory];
    } catch (error) {
      notify(String(error));
    }
  }

  function openVaultContextMenu(event: MouseEvent, entry: VaultEntry | null) {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = {
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 220),
      entry,
    };
  }

  async function deleteVaultItem(entry: VaultEntry) {
    if (!vaultPath) return;
    contextMenu = null;
    const message = entry.kind === 'folder'
      ? `Excluir a pasta “${entry.name}” e todo o conteúdo dentro dela? Esta ação não pode ser desfeita.`
      : `Excluir o projeto “${entry.name}” e seus recursos de áudio? Esta ação não pode ser desfeita.`;
    if (!confirm(message)) return;
    try {
      await deleteVaultEntry(vaultPath, entry.path);
      const activeWasDeleted = filePath === entry.path || Boolean(filePath?.startsWith(`${entry.path}/`));
      if (activeWasDeleted) {
        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = null;
        project = createEmptyProject('Nova música');
        filePath = null;
        dirty = false;
        selectedGroupId = null;
        undoStack = [];
        redoStack = [];
        resetWaveform();
        audioUrl = '';
        audioError = '';
        localStorage.removeItem('zyykVerse.lastProject');
      }
      if (selectedFolderPath === entry.path || selectedFolderPath?.startsWith(`${entry.path}/`)) selectedFolderPath = null;
      vaultEntries = removeVaultEntry(vaultEntries, entry.path);
      notify(entry.kind === 'folder' ? 'Pasta excluída.' : 'Projeto excluído.');
    } catch (error) {
      notify(`Não foi possível excluir: ${String(error)}`);
    }
  }

  function beginVaultDrag(event: PointerEvent, path: string) {
    if (event.button !== 0) return;
    dragStart = { x: event.clientX, y: event.clientY, path };
  }

  function handleVaultPointerMove(event: PointerEvent) {
    if (!dragStart) return;
    if (!vaultDragActive && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 5) return;
    draggedVaultPath = dragStart.path;
    vaultDragActive = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-vault-drop]');
    vaultDropTarget = target?.dataset.vaultDrop ?? null;
  }

  function handleVaultPointerUp() {
    if (vaultDragActive && vaultDropTarget) {
      suppressVaultClick = true;
      void dropVaultEntry(vaultDropTarget);
      setTimeout(() => suppressVaultClick = false, 0);
    }
    dragStart = null;
    vaultDragActive = false;
    vaultDropTarget = null;
  }

  async function addAudio(sourcePath?: string) {
    try {
      audioError = '';
      if (!(await ensureProjectFile()) || !filePath) return;
      const source = sourcePath ?? await chooseAudioFile();
      if (!source) return;
      const imported = await importProjectAudio(source, filePath, project.metadata.id);
      project.audio = { relativePath: imported.relativePath, originalName: imported.originalName, managed: true };
      resetWaveform();
      audioUrl = await resolveProjectAudio(filePath, imported.relativePath);
      touch();
      notify(`Áudio adicionado: ${imported.originalName}`);
    } catch (error) {
      audioError = String(error);
      notify(`Não foi possível adicionar o áudio: ${audioError}`);
    }
  }

  async function loadProjectAudio() {
    resetWaveform();
    audioUrl = '';
    audioDuration = 0;
    currentTime = 0;
    audioPlaying = false;
    audioError = '';
    if (!filePath || !project.audio) return;
    try {
      const path = await resolveProjectAudio(filePath, project.audio.relativePath);
      audioUrl = path;
      const cached = await loadWaveformCache(filePath, project.audio.relativePath);
      if (cached?.length) waveformPeaks = cached;
    } catch (error) {
      audioError = String(error);
      notify(audioError);
    }
  }

  function handleLoadedMetadata() {
    if (!audioElement) return;
    audioError = '';
    audioDuration = Number.isFinite(audioElement.duration) ? audioElement.duration : 0;
  }

  function cancelWaveformWork() {
    if (waveformTimer) clearTimeout(waveformTimer);
    waveformTimer = null;
    waveformAbort?.abort();
    waveformAbort = null;
    waveformGeneration += 1;
    waveformLoading = false;
    waveformPending = false;
  }

  function resetWaveform() {
    cancelWaveformWork();
    waveformPeaks = [];
    waveformPending = false;
  }

  function scheduleWaveform(delay = 1800) {
    if (!audioUrl || !audioDuration || waveformPeaks.length || audioPlaying) return;
    if (waveformTimer || waveformLoading) return;
    waveformPending = true;
    const expectedUrl = audioUrl;
    waveformTimer = setTimeout(() => {
      waveformTimer = null;
      if (!audioPlaying && expectedUrl === audioUrl) void loadWaveform(expectedUrl);
    }, delay);
  }

  function handleAudioCanPlay() {
    scheduleWaveform();
  }

  async function loadWaveform(expectedUrl: string) {
    if (!expectedUrl || expectedUrl !== audioUrl || waveformLoading || audioPlaying) return;
    const generation = ++waveformGeneration;
    const controller = new AbortController();
    waveformAbort = controller;
    waveformLoading = true;
    waveformPending = false;
    try {
      const peaks = await decodeWaveform(expectedUrl, controller.signal);
      if (generation !== waveformGeneration || expectedUrl !== audioUrl || audioPlaying) return;
      waveformPeaks = peaks;
      if (filePath && project.audio && expectedUrl === audioUrl) {
        void saveWaveformCache(filePath, project.audio.relativePath, peaks).catch(() => undefined);
      }
    } catch (error) {
      // A reprodução continua disponível mesmo quando o codec não pode ser
      // decodificado pela Web Audio API para desenhar a waveform.
      if (!(error instanceof DOMException && error.name === 'AbortError') && generation === waveformGeneration) waveformPeaks = [];
    } finally {
      if (generation === waveformGeneration) {
        waveformAbort = null;
        waveformLoading = false;
      }
    }
  }

  function togglePlayback() {
    if (!audioElement) return;
    if (audioElement.paused) void audioElement.play();
    else audioElement.pause();
  }

  function stopPlaybackClock() {
    if (playbackAnimationFrame !== null) cancelAnimationFrame(playbackAnimationFrame);
    playbackAnimationFrame = null;
  }

  function startPlaybackClock() {
    stopPlaybackClock();
    lastPlaybackPaint = 0;
    const paint = (timestamp: number) => {
      if (!audioElement || audioElement.paused || audioElement.ended) {
        stopPlaybackClock();
        return;
      }
      // Atualizar a 60 Hz deixa o playhead preciso sem depender do `timeupdate`,
      // que em WebKit costuma entregar somente cerca de quatro eventos por segundo.
      if (timestamp - lastPlaybackPaint >= 16) {
        currentTime = audioElement.currentTime;
        lastPlaybackPaint = timestamp;
      }
      playbackAnimationFrame = requestAnimationFrame(paint);
    };
    playbackAnimationFrame = requestAnimationFrame(paint);
  }

  function handleAudioPlay() {
    // A waveform é decorativa; nunca deve disputar leitura/decodificação com
    // a reprodução que o usuário acabou de iniciar.
    if (!waveformPeaks.length) cancelWaveformWork();
    audioPlaying = true;
    startPlaybackClock();
  }

  function handleAudioPause() {
    if (audioElement) currentTime = audioElement.currentTime;
    audioPlaying = false;
    stopPlaybackClock();
    scheduleWaveform(500);
  }

  function seekTo(seconds: number) {
    if (!audioElement || !audioDuration) return;
    audioElement.currentTime = Math.max(0, Math.min(audioDuration, seconds));
    currentTime = audioElement.currentTime;
  }

  function seekToGroup(group: AlignmentGroup) {
    selectedGroupId = group.id;
    const cue = cueForGroup(group, syncRole);
    if (!cue) {
      notify('Esta linha ainda não foi adicionada à timeline.');
      return;
    }
    if (!audioElement || !audioDuration) {
      notify('O áudio ainda não está pronto para navegar.');
      return;
    }
    // Alterar currentTime mantém o estado atual do player: se estiver tocando,
    // a reprodução continua imediatamente a partir do novo ponto.
    seekTo(cue.startUs / 1_000_000);
  }

  function stepAudioFrame(direction: -1 | 1) {
    if (!audioElement || !audioDuration) return;
    audioElement.pause();
    const currentFrame = Math.round(audioElement.currentTime * TIMELINE_FPS);
    seekTo((currentFrame + direction) / TIMELINE_FPS);
  }

  function timelinePositionAt(clientX: number): number {
    if (!timelineContent || !audioDuration) return 0;
    const bounds = timelineContent.getBoundingClientRect();
    return Math.max(0, Math.min(audioDuration, ((clientX - bounds.left) / bounds.width) * audioDuration));
  }

  function snapTimelinePosition(seconds: number, targetsUs: number[]) {
    const width = timelineContent?.getBoundingClientRect().width ?? 0;
    return snapTimelineMicroseconds(
      seconds * 1_000_000,
      audioDuration * 1_000_000,
      width,
      TIMELINE_FPS,
      targetsUs,
    );
  }

  function cueSnapTargets(excludedCue?: SyncCue): number[] {
    return (activeTrack?.cues ?? []).flatMap((cue) => cue === excludedCue ? [] : [cue.startUs, cue.endUs]);
  }

  function updatePlayheadFromPointer(clientX: number) {
    const snapped = snapTimelinePosition(timelinePositionAt(clientX), cueSnapTargets());
    snapGuideUs = snapped.magneticTargetUs;
    seekTo(snapped.microseconds / 1_000_000);
  }

  function startTimelineScrub(event: PointerEvent) {
    if (!audioDuration || draggingCue || event.button !== 0 || (event.target as Element | null)?.closest('.timeline-cue')) return;
    scrubbingPlayhead = true;
    updatePlayheadFromPointer(event.clientX);
  }

  function handleTimelineWheel(event: WheelEvent) {
    const scroller = event.currentTarget as HTMLElement;
    if (event.ctrlKey) {
      event.preventDefault();
      const previousZoom = timelineZoom;
      const direction = event.deltaY < 0 ? 1 : -1;
      const increment = previousZoom >= 8 ? 1 : 0.5;
      const nextZoom = Math.max(1, Math.min(32, Math.round((previousZoom + direction * increment) * 2) / 2));
      if (nextZoom === previousZoom) return;
      const bounds = scroller.getBoundingClientRect();
      const playheadRatio = audioDuration ? currentTime / audioDuration : 0;
      const playheadX = playheadRatio * scroller.scrollWidth;
      const playheadVisible = playheadX >= scroller.scrollLeft && playheadX <= scroller.scrollLeft + bounds.width;
      const viewportAnchor = playheadVisible ? playheadX - scroller.scrollLeft : bounds.width / 2;
      timelineZoom = nextZoom;
      requestAnimationFrame(() => {
        scroller.scrollLeft = playheadRatio * scroller.scrollWidth - viewportAnchor;
      });
    } else if (event.shiftKey) {
      event.preventDefault();
      scroller.scrollLeft += event.deltaX || event.deltaY;
    }
  }

  function ensureCue(group: AlignmentGroup, role: SyncRole, atSeconds: number, translationLineIndex = 0): SyncCue {
    const track = trackFor(role, true) as SyncTrack;
    let cue = role === 'translation'
      ? cueForTranslationLine(group, translationLineIndex)
      : cueForGroup(group, role);
    if (!cue) {
      const startUs = Math.round(Math.max(0, atSeconds) * 1_000_000);
      const maximum = audioDuration ? Math.round(audioDuration * 1_000_000) : startUs + 1_000_000;
      cue = {
        id: newId(),
        targetIds: targetIdsFor(group, role, translationLineIndex),
        startUs: Math.min(startUs, Math.max(0, maximum - FRAME_US)),
        endUs: Math.min(maximum, startUs + 1_000_000),
        textMode: role === 'source' ? 'source' : 'selected-variant',
      };
      track.cues.push(cue);
      const limits = cueNeighborLimits(track.cues, cue, maximum);
      cue.startUs = Math.max(limits.minimumStartUs, cue.startUs);
      cue.endUs = Math.min(limits.maximumEndUs, Math.max(cue.startUs + FRAME_US, cue.endUs));
      if (cue.endUs <= cue.startUs) {
        cue.startUs = Math.max(limits.minimumStartUs, limits.maximumEndUs - FRAME_US);
        cue.endUs = Math.min(maximum, cue.startUs + FRAME_US);
      }
    }
    return cue;
  }

  function setCueBoundary(group: AlignmentGroup, boundary: 'start' | 'end', translationLineIndex = 0) {
    if (!audioDuration) return notify('Adicione um áudio antes de marcar o timing.');
    remember(`ajuste de ${boundary === 'start' ? 'entrada' : 'saída'}`);
    const unit = translationFor(group);
    if (unit) ensureTranslationLineIds(unit);
    const cue = ensureCue(group, syncRole, currentTime, translationLineIndex);
    const position = Math.round(currentTime * 1_000_000);
    const track = trackFor(syncRole) as SyncTrack;
    const limits = cueNeighborLimits(track.cues, cue, Math.round(audioDuration * 1_000_000));
    if (boundary === 'start') {
      cue.startUs = Math.max(limits.minimumStartUs, Math.min(position, cue.endUs - FRAME_US));
      if (cue.endUs <= cue.startUs) cue.endUs = Math.min(Math.round(audioDuration * 1_000_000), cue.startUs + 1_000_000);
    } else {
      cue.endUs = Math.min(limits.maximumEndUs, Math.max(position, cue.startUs + FRAME_US));
    }
    track.cues.sort((a, b) => a.startUs - b.startUs);
    selectedGroupId = group.id;
    touch();
  }

  function removeCue(group: AlignmentGroup, translationLineIndex = 0) {
    const cue = cueForTranslationLine(group, translationLineIndex);
    if (!cue) return;
    remember('remoção de timing');
    const track = trackFor(syncRole);
    if (track) track.cues = track.cues.filter((candidate) => candidate.id !== cue.id);
    touch();
  }

  function addTextAtPlayhead() {
    if (!audioDuration) return notify('Adicione um áudio antes de inserir textos na timeline.');
    const items = syncGroups().flatMap((group) => {
      const unit = translationFor(group);
      return translationLines(unit).map((_, lineIndex) => ({ group, lineIndex }));
    });
    if (!items.length) return notify('Importe a letra antes de inserir textos na timeline.');
    const track = trackFor(syncRole, true) as SyncTrack;
    const context = cueContextAtTime(sortedCues(track.cues), currentTime);
    const anchorGroup = context.current ? groupForCue(context.current) : context.previous ? groupForCue(context.previous) : null;
    const anchorCue = context.current ?? context.previous;
    const anchorIndex = anchorGroup && anchorCue
      ? items.findIndex((item) => item.group.id === anchorGroup.id && cueForTranslationLine(item.group, item.lineIndex)?.id === anchorCue.id)
      : -1;
    const untimed = (item: { group: AlignmentGroup; lineIndex: number }) => !cueForTranslationLine(item.group, item.lineIndex);
    const item = items.slice(anchorIndex + 1).find(untimed) ?? items.find(untimed);
    if (!item) return notify('Todos os textos já estão na timeline.');
    const { group, lineIndex } = item;
    const unit = translationFor(group);
    if (unit) ensureTranslationLineIds(unit);

    const range = findAvailableCueRange(
      track.cues,
      Math.round(currentTime * 1_000_000),
      Math.round(audioDuration * 1_000_000),
      1_000_000,
      FRAME_US,
    );
    if (!range) return notify('Não há espaço livre depois da agulha para adicionar outro texto.');

    remember('adição de texto na timeline');
    track.cues.push({
      id: newId(),
      targetIds: targetIdsFor(group, syncRole, lineIndex),
      startUs: range.startUs,
      endUs: range.endUs,
      textMode: 'selected-variant',
    });
    track.cues.sort((left, right) => left.startUs - right.startUs);
    selectedGroupId = group.id;
    touch();
    seekTo(range.startUs / 1_000_000);
  }

  function startCueDrag(event: PointerEvent, cue: SyncCue, boundary: 'start' | 'end') {
    event.preventDefault();
    event.stopPropagation();
    remember(`ajuste do ${boundary === 'start' ? 'início' : 'fim'} do cue`);
    draggingCue = { cue, boundary };
  }

  function startCueMove(event: PointerEvent, cue: SyncCue) {
    if (event.button !== 0 || (event.target as Element | null)?.closest('.cue-handle')) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerUs = Math.round(timelinePositionAt(event.clientX) * 1_000_000);
    draggingCue = {
      cue,
      boundary: 'move',
      grabOffsetUs: pointerUs - cue.startUs,
      pointerStartX: event.clientX,
      started: false,
    };
    selectedGroupId = groupForCue(cue)?.id ?? selectedGroupId;
  }

  function handleTimelinePointerMove(event: PointerEvent) {
    if (!timelineContent || !audioDuration) return;
    if (scrubbingPlayhead) {
      updatePlayheadFromPointer(event.clientX);
      return;
    }
    if (!draggingCue) return;
    const position = timelinePositionAt(event.clientX);
    if (draggingCue.boundary === 'move') {
      if (!draggingCue.started) {
        if (Math.abs(event.clientX - (draggingCue.pointerStartX ?? event.clientX)) < 3) return;
        remember('movimento de cue');
        draggingCue.started = true;
      }
      const desiredStartUs = Math.round(position * 1_000_000) - (draggingCue.grabOffsetUs ?? 0);
      const snapped = snapTimelinePosition(desiredStartUs / 1_000_000, [
        Math.round(currentTime * 1_000_000),
        ...cueSnapTargets(draggingCue.cue),
      ]);
      const moved = moveCueWithinNeighbors(
        activeTrack?.cues ?? [],
        draggingCue.cue,
        snapped.microseconds,
        Math.round(audioDuration * 1_000_000),
      );
      draggingCue.cue.startUs = moved.startUs;
      draggingCue.cue.endUs = moved.endUs;
      snapGuideUs = snapped.magneticTargetUs;
      return;
    }
    const snapped = snapTimelinePosition(position, [
      Math.round(currentTime * 1_000_000),
      ...cueSnapTargets(draggingCue.cue),
    ]);
    snapGuideUs = snapped.magneticTargetUs;
    const limits = cueNeighborLimits(
      activeTrack?.cues ?? [],
      draggingCue.cue,
      Math.round(audioDuration * 1_000_000),
    );
    if (draggingCue.boundary === 'start') {
      draggingCue.cue.startUs = Math.max(limits.minimumStartUs, Math.min(snapped.microseconds, draggingCue.cue.endUs - FRAME_US));
    } else {
      draggingCue.cue.endUs = Math.min(
        limits.maximumEndUs,
        Math.max(snapped.microseconds, draggingCue.cue.startUs + FRAME_US),
      );
    }
  }

  function finishTimelineInteraction() {
    if (draggingCue) {
      const changed = draggingCue.boundary !== 'move' || draggingCue.started;
      if (changed) trackFor(syncRole)?.cues.sort((a, b) => a.startUs - b.startUs);
      draggingCue = null;
      if (changed && !discardUnchangedCheckpoint()) touch();
    }
    scrubbingPlayhead = false;
    snapGuideUs = null;
  }

  async function exportCurrentTrack() {
    try {
      const contents = projectToSrt(project, syncRole);
      const base = project.metadata.title.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/g, '') || 'legenda';
      try {
        const saved = await exportTextFile(`${base}-traducao.srt`, contents);
        if (saved) notify('SRT exportado com os timings da timeline.');
      } catch {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([contents], { type: 'application/x-subrip;charset=utf-8' }));
        link.download = `${base}.srt`;
        link.click();
        URL.revokeObjectURL(link.href);
        notify('SRT exportado.');
      }
    } catch (error) {
      notify(String(error instanceof Error ? error.message : error));
    }
  }

  function notify(message: string) {
    toast = message;
    window.setTimeout(() => {
      if (toast === message) toast = '';
    }, 2600);
  }

  function updateEditorZoom(value: number) {
    editorZoom = Math.max(1, Math.min(1.4, Number.isFinite(value) ? value : 1));
    localStorage.setItem('zyykVerse.editorZoom', String(editorZoom));
  }

  onMount(() => {
    const storedEditorZoom = Number(localStorage.getItem('zyykVerse.editorZoom'));
    if (Number.isFinite(storedEditorZoom)) editorZoom = Math.max(1, Math.min(1.4, storedEditorZoom));
    const handleKeydown = (event: KeyboardEvent) => {
      const primary = event.ctrlKey || event.metaKey;
      if (primary && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveCurrent();
      } else if (primary && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (primary && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (!(event.target as Element | null)?.matches('input, textarea, [contenteditable="true"]')) {
        if (event.code === 'Space' && audioUrl) {
          event.preventDefault();
          togglePlayback();
        } else if (event.key === 'ArrowLeft' && audioUrl) {
          event.preventDefault();
          stepAudioFrame(-1);
        } else if (event.key === 'ArrowRight' && audioUrl) {
          event.preventDefault();
          stepAudioFrame(1);
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);
    const handlePointerMove = (event: PointerEvent) => {
      handleVaultPointerMove(event);
      handleTimelinePointerMove(event);
    };
    const handlePointerUp = () => {
      handleVaultPointerUp();
      finishTimelineInteraction();
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    const closeContextMenu = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest('.vault-context-menu')) contextMenu = null;
    };
    window.addEventListener('pointerdown', closeContextMenu);
    let unlistenDrop: (() => void) | undefined;
    void (async () => {
      const storedVault = localStorage.getItem('zyykVerse.vaultPath');
      if (storedVault) {
        vaultPath = storedVault;
        try {
          await refreshVault();
          vaultReady = true;
          const projects = flattenProjects(vaultEntries);
          const last = localStorage.getItem('zyykVerse.lastProject');
          const initial = projects.find((entry) => entry.path === last) ?? projects[0];
          if (initial) {
            revealVaultEntry(initial.path);
            await openVaultFile(initial.path);
          }
        } catch {
          localStorage.removeItem('zyykVerse.vaultPath');
          vaultPath = null;
        }
      }
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === 'enter') audioDropActive = event.payload.paths.some(isAudioPath);
          if (event.payload.type === 'leave') audioDropActive = false;
          if (event.payload.type === 'drop') {
            audioDropActive = false;
            const audio = event.payload.paths.find(isAudioPath);
            if (audio) void addAudio(audio);
          }
        });
      } catch { /* navegador de desenvolvimento sem API Tauri */ }
    })();
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointerdown', closeContextMenu);
      unlistenDrop?.();
      if (autosaveTimer) clearTimeout(autosaveTimer);
      cancelWaveformWork();
      stopPlaybackClock();
    };
  });

  function isAudioPath(path: string): boolean {
    return /\.(mp3|flac|wav|ogg)$/i.test(path);
  }

  function handleAudioError(event: Event) {
    const media = event.currentTarget as HTMLAudioElement;
    const messages: Record<number, string> = {
      1: 'A reprodução foi interrompida.',
      2: 'O WebKit não conseguiu ler o arquivo de áudio.',
      3: 'O WebKit não conseguiu decodificar este áudio.',
      4: 'Formato ou URL de áudio não suportado pelo WebKit.',
    };
    audioError = messages[media.error?.code ?? 0] ?? 'Falha desconhecida ao carregar o áudio.';
  }
</script>

<svelte:head><title>{project.metadata.title} — ZYYK Verse</title></svelte:head>

<main class="app-shell" class:vault-closed={!vaultOpen} class:details-open={detailsOpen}>
  <header class="topbar">
    <div class="brand">
      <button class="icon-button" onclick={() => vaultOpen = !vaultOpen} aria-label="Mostrar ou ocultar vault" title="Mostrar ou ocultar vault">☰</button>
      <strong>ZYYK VERSE</strong>
    </div>
    <div class="top-actions">
      <div class="history-actions" aria-label="Histórico de alterações">
        <button onclick={undo} disabled={!canUndo} aria-label={`Desfazer ${undoLabel}`} title={`Desfazer ${undoLabel} (Ctrl+Z)`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" /></svg>
        </button>
        <button onclick={redo} disabled={!canRedo} aria-label={`Refazer ${redoLabel}`} title={`Refazer ${redoLabel} (Ctrl+Shift+Z / Ctrl+Y)`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6" /></svg>
        </button>
      </div>
      <span class:dirty class="save-state"><i></i>{saving ? 'Salvando…' : dirty ? 'Alterações' : 'Salvo'}</span>
      <button class="button quiet" class:active={detailsOpen} onclick={() => detailsOpen = !detailsOpen}>Detalhes</button>
      <button class="button quiet" onclick={() => saveCurrent(false)} disabled={saving}>Salvar agora</button>
    </div>
  </header>

  {#if vaultOpen}
    <aside class="vault-panel">
      <div class="panel-title"><strong>{vaultPath?.split('/').at(-1) ?? 'Vault'}</strong><div class="vault-create"><button class="icon-button" onclick={() => newMenuOpen = !newMenuOpen} title="Criar na vault" aria-label="Criar arquivo ou pasta">＋</button>{#if newMenuOpen}<div class="vault-new-menu"><button onclick={() => beginCreate('project')}>Novo projeto</button><button onclick={() => beginCreate('folder')}>Nova pasta</button></div>{/if}</div></div>
      <div class="vault-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.25"/><path d="m12.5 12.5 4 4"/></svg><input bind:value={vaultSearch} aria-label="Buscar no vault" placeholder="Buscar" /></div>
      <nav class="file-tree" class:dragging={vaultDragActive} class:drop-target={vaultDropTarget === vaultPath} aria-label="Arquivos da vault" data-vault-drop={vaultPath ?? undefined} oncontextmenu={(event) => openVaultContextMenu(event, null)}>
        {#if createMode}<div class="vault-create-input"><input bind:value={createName} placeholder={createMode === 'project' ? 'Nome do projeto' : 'Nome da pasta'} onkeydown={(event) => { if (event.key === 'Enter') void confirmCreate(); if (event.key === 'Escape') createMode = null; }} onblur={() => { if (!createName.trim()) createMode = null; }} /><button onclick={() => createMode = null} aria-label="Cancelar">×</button></div>{/if}
        {#if flatVaultEntries.length === 0}<p class="vault-empty">A vault está vazia.</p>{/if}
        {#each flatVaultEntries as item (item.entry.path)}
          {#if renameTarget?.path === item.entry.path}
            <div class="tree-row vault-rename-row">
              <span class="tree-guides" style={`width:${item.depth * 15}px`}></span>
              <span class="tree-spacer"></span>
              <input bind:value={renameName} aria-label={`Renomear ${item.entry.name}`} onkeydown={(event) => { if (event.key === 'Enter') void confirmRename(item.entry); if (event.key === 'Escape') cancelRename(); }} onblur={() => void confirmRename(item.entry)} />
            </div>
          {:else if item.entry.kind === 'folder'}
            <button class="tree-row folder" class:selected-folder={selectedFolderPath === item.entry.path} class:drop-target={vaultDropTarget === item.entry.path} class:drag-source={draggedVaultPath === item.entry.path && vaultDragActive} data-vault-drop={item.entry.path} aria-expanded={item.expanded} onpointerdown={(event) => beginVaultDrag(event, item.entry.path)} oncontextmenu={(event) => openVaultContextMenu(event, item.entry)} onclick={() => { if (!suppressVaultClick) toggleVaultFolder(item.entry.path); }}><span class="tree-guides" style={`width:${item.depth * 15}px`}></span><span class:expanded={item.expanded} class="folder-chevron">›</span><span class="tree-name">{item.entry.name}</span></button>
          {:else}
            <button class="tree-row project-file" class:selected={filePath === item.entry.path} class:drag-source={draggedVaultPath === item.entry.path && vaultDragActive} onpointerdown={(event) => beginVaultDrag(event, item.entry.path)} oncontextmenu={(event) => openVaultContextMenu(event, item.entry)} onclick={() => { if (!suppressVaultClick) void openVaultFile(item.entry.path); }}><span class="tree-guides" style={`width:${item.depth * 15}px`}></span><span class="tree-spacer"></span><span class="tree-name">{item.entry.name}</span>{#if filePath === item.entry.path}<i class:dirty></i>{/if}</button>
          {/if}
        {/each}
      </nav>
      <button class="vault-action" onclick={selectVault}>Trocar pasta da vault</button>
    </aside>
  {/if}

  <section class="editor-panel" style={`--editor-zoom:${editorZoom}`}>
    <header class="document-header">
      <div class="title-group">
        <input bind:value={project.metadata.title} onfocus={() => beginEdit('title', 'edição do título')} onbeforeinput={() => beginEdit('title', 'edição do título')} onblur={endEdit} oninput={touch} aria-label="Título da música" />
        {#if project.metadata.artist || project.metadata.album}<span>{[project.metadata.artist, project.metadata.album].filter(Boolean).join(' · ')}</span>{/if}
      </div>
      <div class="progress"><span>{completedCount} de {project.translations.length} concluídos</span><strong>{progress}%</strong><i><b style:width={`${progress}%`}></b></i></div>
    </header>

    {#if project.alignmentGroups.length === 0}
      <div class="empty-state">
        <div class="empty-icon">≡</div>
        <h1>Comece pela letra original</h1>
        <p>Cole a letra inteira em um único campo. O Verse separará e alinhará cada linha automaticamente.</p>
        <button class="button primary" onclick={() => { importTitle = project.metadata.title; showImport = true; }}>Colar letra completa</button>
      </div>
    {:else}
      <div class="column-headings">
        <div><span>{project.languages.source.toUpperCase()}</span><strong>Original</strong></div>
        <div><span>{project.languages.target.toUpperCase()}</span><strong>Tradução</strong><label class="editor-zoom-control" title="Ampliar textos e controles do editor">Zoom <input type="range" min="1" max="1.4" step="0.05" value={editorZoom} oninput={(event) => updateEditorZoom(Number(event.currentTarget.value))} aria-label="Zoom da área de edição" /><output>{Math.round(editorZoom * 100)}%</output></label></div>
      </div>
      <div class="editor-scroll">
        {#each project.alignmentGroups as group, index (group.id)}
          {@const sources = sourcesFor(group)}
          {@const unit = translationFor(group)}
          {#if index > 0 && (sources[0]?.kind === 'line' || sourceFor(project.alignmentGroups[index - 1].sourceSegmentIds[0])?.kind === 'line')}
            <div class="row-insert">
              <button onclick={() => addLine(project.alignmentGroups[index - 1].id)} title="Adicionar uma linha aqui" aria-label="Adicionar uma linha original entre estas duas linhas">＋</button>
            </div>
          {/if}
          {#if sources[0]?.kind === 'section'}
            <div class="section-row">
              <span></span>
              <input value={sources[0].label ?? ''} placeholder="Seção" onfocus={() => beginEdit(`section-${sources[0].id}`, 'edição da seção')} onbeforeinput={() => beginEdit(`section-${sources[0].id}`, 'edição da seção')} onblur={endEdit} oninput={(event) => { sources[0].label = (event.currentTarget as HTMLInputElement).value; touch(); }} />
              <span></span>
              <button onclick={() => deleteGroup(group)} aria-label="Excluir seção">×</button>
            </div>
          {:else if unit}
            <article class="lyric-row" class:selected={selectedGroupId === group.id} class:playhead-current={groupForCue(playheadContext.current)?.id === group.id} class:playhead-previous={groupForCue(playheadContext.previous)?.id === group.id} data-status={unit.status} data-group-id={group.id}>
              <div class="line-gutter">
                <button onclick={(event) => { event.stopPropagation(); seekToGroup(group); }} title="Ir para esta linha na timeline" aria-label={`Ir para a linha ${lineNumber(index)} na timeline`}>{lineNumber(index)}</button>
              </div>
              <div class="original-cell">
                <div class="original-lines">
                  {#each sources as source (source.id)}
                    <div class="line-text original-text">
                      <textarea data-source-id={source.id} rows="1" value={source.text} onfocus={(event) => { selectedGroupId = group.id; beginEdit(`source-${source.id}`, 'edição do original'); scheduleTextareaResize(event.currentTarget); }} onbeforeinput={() => beginEdit(`source-${source.id}`, 'edição do original')} onblur={endEdit} oninput={(event) => { updateOriginal(source, event.currentTarget.value); scheduleTextareaResize(event.currentTarget); }} aria-label={`Texto original ${lineNumber(index)}`}></textarea>
                      <button class="copy-line" onclick={(event) => { event.stopPropagation(); void copyLine(source.text, 'Original'); }} title="Copiar linha original" aria-label={`Copiar original ${lineNumber(index)}`}>⧉</button>
                    </div>
                  {/each}
                </div>
                <button class="row-delete" onclick={(event) => { event.stopPropagation(); deleteGroup(group); }} title="Excluir verso" aria-label="Excluir verso">×</button>
              </div>
              <div class="translation-cell">
                <button class="add-translation-line" onclick={(event) => { event.stopPropagation(); addTranslationLine(group, translationLines(unit).length - 1); }} title="Adicionar sublinha à tradução" aria-label={`Adicionar sublinha à tradução ${lineNumber(index)}`}>＋</button>
                <div class="translation-content">
                  <div class="translation-sublines">
                    {#each translationLines(unit) as translationLine, translationLineIndex}
                      {@const translationLineId = translationTargetId(unit, translationLineIndex)}
                      {@const translationLineCue = cueForTranslationLine(group, translationLineIndex)}
                      <div class="translation-subline" class:timed={Boolean(translationLineCue)}>
                        <div class="line-text translation-text">
                          <textarea data-translation-line-id={translationLineId} rows="1" value={translationLine} placeholder={translationLineIndex === 0 ? 'Escreva uma tradução…' : 'Continue a tradução…'} onfocus={(event) => { selectedGroupId = group.id; beginTranslationEdit(unit, `translation-${unit.id}-${translationLineIndex}`); scheduleTextareaResize(event.currentTarget); }} onbeforeinput={() => beginTranslationEdit(unit, `translation-${unit.id}-${translationLineIndex}`)} onblur={endEdit} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTranslationLine(group, translationLineIndex); } }} oninput={(event) => { const value = event.currentTarget.value.replace(/\r?\n/g, ' '); event.currentTarget.value = value; updateTranslationLine(unit, translationLineIndex, value); scheduleTextareaResize(event.currentTarget); }} aria-label={`Tradução ${lineNumber(index)}, sublinha ${translationLineIndex + 1}`}></textarea>
                          <button class="copy-line" onclick={(event) => { event.stopPropagation(); void copyLine(translationLine, 'Tradução'); }} title="Copiar sublinha" aria-label={`Copiar sublinha ${translationLineIndex + 1}`}>⧉</button>
                        </div>
                        <div class="row-timing" class:timed={Boolean(translationLineCue)}>
                          {#if translationLineCue}<button class="time-readout" onclick={(event) => { event.stopPropagation(); seekTo(translationLineCue.startUs / 1_000_000); }}>{formatClock(translationLineCue.startUs / 1_000_000, true)} → {formatClock(translationLineCue.endUs / 1_000_000, true)}</button>{:else}<span class="time-placeholder" aria-hidden="true">Sem timing</span>{/if}
                          <div class="timing-controls">
                            <button onclick={(event) => { event.stopPropagation(); setCueBoundary(group, 'start', translationLineIndex); }} title="Definir entrada desta sublinha no playhead">In</button>
                            <button onclick={(event) => { event.stopPropagation(); setCueBoundary(group, 'end', translationLineIndex); }} title="Definir saída desta sublinha no playhead">Out</button>
                            {#if translationLineCue}<button class="remove-timing" onclick={(event) => { event.stopPropagation(); removeCue(group, translationLineIndex); }} title="Remover timing" aria-label="Remover timing">×</button>{/if}
                          </div>
                        </div>
                        {#if translationLines(unit).length > 1}<button class="remove-translation-line" onclick={(event) => { event.stopPropagation(); deleteTranslationLine(group, translationLineIndex); }} title="Remover esta sublinha" aria-label={`Remover sublinha ${translationLineIndex + 1}`}>×</button>{/if}
                        <button class="insert-translation-line" onclick={(event) => { event.stopPropagation(); addTranslationLine(group, translationLineIndex); }} title="Adicionar sublinha abaixo" aria-label={`Adicionar sublinha após ${translationLineIndex + 1}`}>＋</button>
                      </div>
                    {/each}
                  </div>
                  <div class="row-meta">
                    <div class="line-state-actions"><button class:active={unit.status === 'review'} onclick={(event) => { event.stopPropagation(); setStatus(unit, unit.status === 'review' ? 'pending' : 'review'); }}>Em revisão</button><button class:active={unit.status === 'completed'} onclick={(event) => { event.stopPropagation(); setStatus(unit, unit.status === 'completed' ? 'pending' : 'completed'); }}>✓ Concluído</button></div>
                  </div>
                </div>
              </div>
            </article>
          {/if}
        {/each}
        <div class="add-row"><button onclick={() => addLine(selectedGroupId ?? undefined)}>＋ Adicionar verso</button></div>
      </div>
    {/if}
  </section>

  {#if detailsOpen}
    <aside class="details-panel">
      <div class="panel-title"><strong>Detalhes</strong><button class="icon-button" onclick={() => detailsOpen = false} aria-label="Fechar detalhes">×</button></div>
      {#if selectedUnit && selectedGroup}
        <section>
          <h2>Original</h2>
          <blockquote>{sourcesFor(selectedGroup).map((source) => source.text).join(' / ')}</blockquote>
        </section>
        <section>
          <div class="section-title"><h2>Variantes</h2><button onclick={() => addVariant(selectedUnit)}>＋ Nova</button></div>
          {#if selectedUnit.variants.length === 0}
            <p class="muted">Nenhuma variante criada.</p>
          {/if}
          <div class="variant-list">
            {#each selectedUnit.variants as variant, variantIndex (variant.id)}
              <div class="variant" class:selected={variant.id === selectedUnit.selectedVariantId}>
                <button class="variant-select" onclick={() => selectVariant(selectedUnit, variant.id)}>{String.fromCharCode(65 + variantIndex)}</button>
                <textarea rows="3" bind:value={variant.text} onfocus={() => beginEdit(`variant-${variant.id}`, 'edição de variante')} onbeforeinput={() => beginEdit(`variant-${variant.id}`, 'edição de variante')} onblur={endEdit} oninput={() => { variant.updatedAt = new Date().toISOString(); if (variant.id === selectedUnit.selectedVariantId) ensureTranslationLineIds(selectedUnit); touch(); }} aria-label={`Variante ${variantIndex + 1}`}></textarea>
                <button class="variant-delete" onclick={() => deleteVariant(selectedUnit, variant.id)} aria-label="Excluir variante">×</button>
              </div>
            {/each}
          </div>
        </section>
        <section>
          <h2>Estado</h2>
          <div class="status-options">
            {#each ['pending', 'review', 'completed'] as status}
              <button class:active={selectedUnit.status === status} onclick={() => { if (selectedUnit.status !== status) setStatus(selectedUnit, status as ProgressStatus); }}>{statusLabel(status as ProgressStatus)}</button>
            {/each}
          </div>
        </section>
        <section>
          <h2>Observações</h2>
          <textarea class="notes" rows="6" bind:value={selectedUnit.notes} onfocus={() => beginEdit(`notes-${selectedUnit.id}`, 'edição das observações')} onbeforeinput={() => beginEdit(`notes-${selectedUnit.id}`, 'edição das observações')} onblur={endEdit} oninput={touch} placeholder="Sentido, contexto ou escolhas linguísticas…"></textarea>
        </section>
      {:else}
        <div class="details-empty">Selecione um verso.</div>
      {/if}
    </aside>
  {/if}

  <footer class="timeline-panel">
    <div class="transport-bar">
      <div class="audio-identity"><span>♫</span><strong>{project.audio?.originalName ?? 'Nenhum áudio carregado'}</strong></div>
      <button class="transport-play" onclick={togglePlayback} disabled={!audioUrl} aria-label={audioPlaying ? 'Pausar' : 'Reproduzir'}>{audioPlaying ? '❚❚' : '▶'}</button>
      <span class="transport-time">{formatClock(currentTime, true)} <i>/</i> {formatClock(audioDuration, true)}</span>
      <span class="frame-hint" title="Use as setas esquerda e direita para avançar um frame">← 1 frame · {TIMELINE_FPS} fps · 1 frame →</span>
      <button class="add-text-button" onclick={addTextAtPlayhead} disabled={!audioUrl || syncGroups().length === 0}>＋ Adicionar texto</button>
      <label class="zoom-control">Zoom <input type="range" min="1" max="32" step="0.5" bind:value={timelineZoom} /></label>
      <button class="button quiet" onclick={exportCurrentTrack} disabled={!activeTrack?.cues.length}>Exportar tradução SRT</button>
      <button class="button quiet" onclick={() => addAudio()}>Adicionar áudio</button>
    </div>
    {#if audioError}<div class="audio-error" title={audioError}>{audioError}</div>{/if}
    <div class="timeline-scroll" onwheel={handleTimelineWheel} title="Ctrl + scroll: zoom · Shift + scroll: navegar horizontalmente">
      <div class="timeline-content" bind:this={timelineContent} class:scrubbing={scrubbingPlayhead} style={`width:${timelineZoom * 100}%`} onpointerdown={startTimelineScrub} role="slider" aria-label="Timeline do áudio" aria-valuemin="0" aria-valuemax={audioDuration} aria-valuenow={currentTime} tabindex="0">
        <div class="timeline-ruler">
          {#each timelineTicks as tick}<span style={`left:${audioDuration ? (tick / audioDuration) * 100 : 0}%`}><i></i>{formatClock(tick)}</span>{/each}
        </div>
        <div class="waveform" class:loading={waveformLoading}>
          {#if waveformPeaks.length}
            <svg viewBox={`0 0 ${waveformPeaks.length - 1} 2`} preserveAspectRatio="none" aria-hidden="true"><path d={waveformPath}></path></svg>
          {:else}<span>{audioUrl ? (waveformLoading ? 'Gerando waveform…' : waveformPending ? 'Áudio pronto — preparando waveform…' : 'Waveform indisponível — a timeline continua editável') : 'Adicione ou arraste um áudio para começar'}</span>{/if}
        </div>
        <div class="cue-lane">
          {#each activeTrack?.cues ?? [] as cue (cue.id)}
            {@const cueGroup = groupForCue(cue)}
            <div class="timeline-cue" class:selected={cueGroup?.id === selectedGroupId} style={`left:${audioDuration ? (cue.startUs / 1_000_000 / audioDuration) * 100 : 0}%;width:${audioDuration ? ((cue.endUs - cue.startUs) / 1_000_000 / audioDuration) * 100 : 0}%`} onpointerdown={(event) => startCueMove(event, cue)} onclick={(event) => { event.stopPropagation(); if (cueGroup) selectedGroupId = cueGroup.id; }} onkeydown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && cueGroup) selectedGroupId = cueGroup.id; }} title={`${cuePreview(cueGroup, cue)} · ${formatClock(cue.startUs / 1_000_000, true)} — ${formatClock(cue.endUs / 1_000_000, true)}`} role="button" tabindex="0">
              <button class="cue-handle start" onpointerdown={(event) => startCueDrag(event, cue, 'start')} aria-label="Ajustar início do cue"></button>
              <b>{cuePreview(cueGroup, cue)}</b>
              <button class="cue-handle end" onpointerdown={(event) => startCueDrag(event, cue, 'end')} aria-label="Ajustar fim do cue"></button>
            </div>
          {/each}
        </div>
        {#if snapGuideUs !== null}<div class="snap-guide" style={`left:${audioDuration ? (snapGuideUs / 1_000_000 / audioDuration) * 100 : 0}%`}><span>SNAP</span></div>{/if}
        <div class="playhead" style={`left:${audioDuration ? (currentTime / audioDuration) * 100 : 0}%`}><i></i></div>
      </div>
    </div>
    {#if audioUrl}<audio bind:this={audioElement} src={audioUrl} preload="auto" crossorigin="anonymous" onloadedmetadata={handleLoadedMetadata} oncanplay={handleAudioCanPlay} ontimeupdate={(event) => { if (!audioPlaying) currentTime = event.currentTarget.currentTime; }} onplay={handleAudioPlay} onpause={handleAudioPause} onended={handleAudioPause} onerror={handleAudioError}></audio>{/if}
  </footer>
</main>

{#if contextMenu}
  <div class="vault-context-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px`} role="menu">
    {#if !contextMenu.entry}
      <button onclick={() => { contextMenu = null; beginCreate('project', null); }}>Novo projeto</button>
      <button onclick={() => { contextMenu = null; beginCreate('folder', null); }}>Nova pasta</button>
    {:else if contextMenu.entry.kind === 'folder'}
      <button onclick={() => { const path = contextMenu?.entry?.path ?? null; contextMenu = null; beginCreate('project', path); }}>Novo projeto aqui</button>
      <button onclick={() => { const path = contextMenu?.entry?.path ?? null; contextMenu = null; beginCreate('folder', path); }}>Nova pasta aqui</button>
      <i></i>
      <button onclick={() => { const entry = contextMenu?.entry; if (entry) beginRename(entry); }}>Renomear</button>
      <i></i>
      <button class="danger" onclick={() => { const entry = contextMenu?.entry; if (entry) void deleteVaultItem(entry); }}><span>×</span>Excluir pasta</button>
    {:else}
      <button onclick={() => { const entry = contextMenu?.entry; if (entry) beginRename(entry); }}>Renomear</button>
      <i></i>
      <button class="danger" onclick={() => { const entry = contextMenu?.entry; if (entry) void deleteVaultItem(entry); }}><span>×</span>Excluir projeto</button>
    {/if}
  </div>
{/if}

{#if audioDropActive}<div class="audio-drop-overlay"><div><strong>Solte para adicionar o áudio</strong><span>O arquivo será copiado para os recursos deste projeto.</span></div></div>{/if}

{#if showImport}
  <div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) showImport = false; }}>
    <div class="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" tabindex="-1">
      <header><div><span>Importar original</span><h1 id="import-title">Cole a letra completa</h1></div><button class="icon-button" onclick={() => showImport = false} aria-label="Fechar">×</button></header>
      <div class="modal-content">
        <p>Use uma linha para cada verso. Linhas vazias criam separadores; títulos como <code>[Chorus]</code> criam seções.</p>
        <label class="project-name-field"><span>Nome do projeto</span><input bind:value={importTitle} placeholder="Nome da música" /></label>
        <textarea bind:value={importText} placeholder={'[Verse 1]\nFirst line of the song\nSecond line of the song\n\n[Chorus]\n...'}></textarea>
        <div class="import-summary"><span>{importPreview.lineCount} versos</span><span>{importPreview.sectionCount} seções</span></div>
        {#if importError}<div class="error-banner">{importError}</div>{/if}
      </div>
      <footer><button class="button quiet" onclick={() => showImport = false}>Cancelar</button><button class="button primary" onclick={confirmImport} disabled={!importPreview.lineCount || !importTitle.trim()}>Criar e organizar</button></footer>
    </div>
  </div>
{/if}

{#if !vaultReady}
  <div class="modal-backdrop vault-setup-backdrop">
    <div class="vault-setup" role="dialog" aria-modal="true" aria-labelledby="vault-setup-title">
      <div class="empty-icon">▰</div>
      <span>PRIMEIRO ACESSO</span>
      <h1 id="vault-setup-title">Escolha a pasta da sua vault</h1>
      <p>Projetos, pastas e recursos de áudio ficarão organizados nesse local. O Verse lembrará sua escolha nas próximas vezes.</p>
      <button class="button primary" onclick={selectVault}>Escolher pasta</button>
    </div>
  </div>
{/if}

{#if toast}<div class="toast" role="status">{toast}</div>{/if}
