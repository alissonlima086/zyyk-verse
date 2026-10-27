import { cloneProject } from './lyrics.ts';
import type { VerseProject } from '../types/project.ts';

export const MAX_HISTORY_ENTRIES = 100;
export const MAX_HISTORY_BYTES = 32 * 1024 * 1024;

export interface ProjectHistoryEntry {
  project: VerseProject;
  selectedGroupId: string | null;
  label: string;
  bytes: number;
}

export function createHistoryEntry(
  project: VerseProject,
  selectedGroupId: string | null,
  label: string,
): ProjectHistoryEntry {
  // Serialize once: this function runs when focus enters an editable field.
  // A second stringify here made navigation increasingly noticeable in larger songs.
  const serialized = JSON.stringify(project);
  const snapshot = JSON.parse(serialized) as VerseProject;
  return {
    project: snapshot,
    selectedGroupId,
    label,
    bytes: serialized.length * 2,
  };
}

export function trimHistory(entries: ProjectHistoryEntry[]): void {
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  while (entries.length > 1 && (entries.length > MAX_HISTORY_ENTRIES || bytes > MAX_HISTORY_BYTES)) {
    bytes -= entries.shift()?.bytes ?? 0;
  }
}

export function sameProjectContent(left: VerseProject, right: VerseProject): boolean {
  const normalize = (project: VerseProject) => {
    const snapshot = cloneProject(project);
    snapshot.revision = 0;
    snapshot.metadata.updatedAt = '';
    return snapshot;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function restoreHistoryEntry(
  entry: ProjectHistoryEntry,
  currentProject: VerseProject,
): { project: VerseProject; selectedGroupId: string | null } {
  const restored = cloneProject(entry.project);
  // Revision is a persistence token, not editable document content. Keeping the
  // current token prevents undo from looking like a stale external write.
  restored.revision = currentProject.revision;
  // Managed audio imports change files on disk. They cannot safely be rolled
  // back by an in-memory document snapshot.
  restored.audio = currentProject.audio ? { ...currentProject.audio } : null;
  return { project: restored, selectedGroupId: entry.selectedGroupId };
}
