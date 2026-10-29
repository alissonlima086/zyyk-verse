import type { SyncCue, SyncRole, VerseProject } from '../types/project.ts';
import { selectedVariant, translationLines } from './lyrics.ts';

export interface TimelineSnapResult {
  microseconds: number;
  magneticTargetUs: number | null;
}

export const MIN_CUE_GAP_US = 1_000;

export interface CueNeighborLimits {
  minimumStartUs: number;
  maximumEndUs: number;
}

export function compareCues(left: SyncCue, right: SyncCue): number {
  return left.startUs - right.startUs || left.endUs - right.endUs || left.id.localeCompare(right.id);
}

export function sortedCues(cues: SyncCue[]): SyncCue[] {
  return [...cues].sort(compareCues);
}

export function cueNeighborLimits(
  cues: SyncCue[],
  cue: SyncCue,
  durationUs: number,
  gapUs = MIN_CUE_GAP_US,
): CueNeighborLimits {
  let previous: SyncCue | null = null;
  let next: SyncCue | null = null;
  for (const candidate of cues) {
    if (candidate.id === cue.id) continue;
    const order = compareCues(candidate, cue);
    if (order < 0 && (!previous || compareCues(candidate, previous) > 0)) previous = candidate;
    if (order > 0 && (!next || compareCues(candidate, next) < 0)) next = candidate;
  }
  return {
    minimumStartUs: previous ? previous.endUs + gapUs : 0,
    maximumEndUs: next ? next.startUs - gapUs : Math.max(0, Math.round(durationUs)),
  };
}

export function cueContextAtTime(
  cues: SyncCue[],
  seconds: number,
): { current: SyncCue | null; previous: SyncCue | null } {
  const timeUs = seconds * 1_000_000;
  let low = 0;
  let high = cues.length - 1;
  let previous: SyncCue | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = cues[middle];
    if (timeUs < cue.startUs) {
      high = middle - 1;
    } else if (timeUs >= cue.endUs) {
      previous = cue;
      low = middle + 1;
    } else {
      return { current: cue, previous: null };
    }
  }
  return { current: null, previous };
}

export function createTimelineTicks(duration: number, zoom: number): number[] {
  if (!duration) return [];
  const desired = Math.max(6, Math.round(10 * zoom));
  const rough = duration / desired;
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 0.1)));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let time = 0; time <= duration; time += step) ticks.push(time);
  return ticks;
}

export function moveCueWithinNeighbors(
  cues: SyncCue[],
  cue: SyncCue,
  desiredStartUs: number,
  durationUs: number,
  gapUs = MIN_CUE_GAP_US,
): { startUs: number; endUs: number } {
  const lengthUs = Math.max(0, cue.endUs - cue.startUs);
  const limits = cueNeighborLimits(cues, cue, durationUs, gapUs);
  const maximumStartUs = Math.max(limits.minimumStartUs, limits.maximumEndUs - lengthUs);
  const startUs = Math.max(limits.minimumStartUs, Math.min(maximumStartUs, Math.round(desiredStartUs)));
  return { startUs, endUs: startUs + lengthUs };
}

export function snapTimelineMicroseconds(
  rawMicroseconds: number,
  durationMicroseconds: number,
  contentWidthPixels: number,
  framesPerSecond: number,
  magneticTargets: number[],
  magneticDistancePixels = 8,
): TimelineSnapResult {
  const duration = Math.max(0, Math.round(durationMicroseconds));
  const clamped = Math.max(0, Math.min(duration, rawMicroseconds));
  const frameUs = 1_000_000 / Math.max(1, framesPerSecond);
  const frameAligned = Math.max(0, Math.min(duration, Math.round(clamped / frameUs) * frameUs));
  const thresholdUs = contentWidthPixels > 0
    ? (duration / contentWidthPixels) * Math.max(0, magneticDistancePixels)
    : 0;
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of magneticTargets) {
    if (!Number.isFinite(candidate)) continue;
    const target = Math.max(0, Math.min(duration, Math.round(candidate)));
    const distance = Math.abs(clamped - target);
    if (distance <= thresholdUs && distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  return {
    microseconds: Math.round(nearest ?? frameAligned),
    magneticTargetUs: nearest,
  };
}

export function formatClock(seconds: number, milliseconds = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const fraction = Math.floor((safe % 1) * 1000);
  const base = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return milliseconds ? `${base}.${String(fraction).padStart(3, '0')}` : base;
}

function subtitleTime(microseconds: number, decimalSeparator: ',' | '.'): string {
  const milliseconds = Math.max(0, Math.round(microseconds / 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${decimalSeparator}${String(millis).padStart(3, '0')}`;
}

export function cueText(project: VerseProject, cue: SyncCue, role: SyncRole): string {
  if (role === 'source') {
    return cue.targetIds
      .map((id) => project.sourceSegments.find((segment) => segment.id === id)?.text.trim() ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return cue.targetIds
    .map((id) => {
      const unit = project.translations.find((candidate) => candidate.id === id || candidate.lineIds?.includes(id));
      if (!unit) return '';
      const lineIndex = unit.lineIds?.indexOf(id) ?? -1;
      return lineIndex >= 0
        ? (translationLines(unit)[lineIndex] ?? '').trim()
        : selectedVariant(unit)?.text.trim() ?? '';
    })
    .filter(Boolean)
    .join('\n');
}

export type SubtitleFormat = 'srt' | 'vtt' | 'lrc';

export interface SubtitleValidationMessages {
  emptyTrack: string;
  invalidCue: string;
}

export interface SubtitleExport {
  contents: string;
  totalCueCount: number;
  exportedCueCount: number;
  omittedCueCount: number;
}

const defaultSubtitleValidationMessages: SubtitleValidationMessages = {
  emptyTrack: 'A trilha ainda não possui versos sincronizados.',
  invalidCue: 'Há um cue com duração inválida. Ajuste seus limites antes de exportar.',
};

export function createSubtitleExport(
  project: VerseProject,
  role: SyncRole,
  format: SubtitleFormat,
  messages: SubtitleValidationMessages = defaultSubtitleValidationMessages,
): SubtitleExport {
  const track = project.syncTracks.find((candidate) => candidate.role === role);
  if (!track?.cues.length) throw new Error(messages.emptyTrack);
  if (track.cues.some((cue) => cue.endUs <= cue.startUs)) {
    throw new Error(messages.invalidCue);
  }
  const entries = [...track.cues]
    .sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
    .map((cue) => ({ cue, text: cueText(project, cue, role) }));
  const exportable = entries.filter((entry) => entry.text);
  const blocks = exportable.map(({ cue, text }, index) => {
    if (format === 'srt') return `${index + 1}\n${subtitleTime(cue.startUs, ',')} --> ${subtitleTime(cue.endUs, ',')}\n${text}`;
    if (format === 'vtt') return `${subtitleTime(cue.startUs, '.')} --> ${subtitleTime(cue.endUs, '.')}\n${text}`;
    return `${lrcTime(cue.startUs)}${text.replace(/\n+/g, ' / ')}`;
  });
  const body = blocks.length ? `${blocks.join(format === 'lrc' ? '\n' : '\n\n')}\n` : '';
  const lrcHeader = [
    `[ti:${lrcMetadata(project.metadata.title)}]`,
    project.metadata.artist ? `[ar:${lrcMetadata(project.metadata.artist)}]` : '',
    project.metadata.album ? `[al:${lrcMetadata(project.metadata.album)}]` : '',
    '[by:ZYYK Verse]',
  ].filter(Boolean).join('\n');
  return {
    contents: format === 'vtt' ? `WEBVTT\n\n${body}` : format === 'lrc' ? `${lrcHeader}\n\n${body}` : body,
    totalCueCount: entries.length,
    exportedCueCount: exportable.length,
    omittedCueCount: entries.length - exportable.length,
  };
}

function lrcTime(microseconds: number): string {
  const centiseconds = Math.max(0, Math.round(microseconds / 10_000));
  const minutes = Math.floor(centiseconds / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}]`;
}

function lrcMetadata(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replaceAll(']', ')').trim();
}

export function projectToSrt(
  project: VerseProject,
  role: SyncRole,
  messages: SubtitleValidationMessages = defaultSubtitleValidationMessages,
): string {
  return createSubtitleExport(project, role, 'srt', messages).contents;
}
