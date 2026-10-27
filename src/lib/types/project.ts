export type ProgressStatus = 'pending' | 'review' | 'completed';
export type SourceKind = 'line' | 'section';

export interface ProjectMetadata {
  id: string;
  title: string;
  artist: string;
  album: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceSegment {
  id: string;
  kind: SourceKind;
  text: string;
  label: string | null;
}

export interface TranslationVariant {
  id: string;
  text: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranslationUnit {
  id: string;
  /** Stable targets for the visual lines of the selected translation. */
  lineIds: string[];
  variants: TranslationVariant[];
  selectedVariantId: string | null;
  status: ProgressStatus;
  notes: string;
}

export interface AlignmentGroup {
  id: string;
  sourceSegmentIds: string[];
  translationUnitIds: string[];
}

export interface AudioAsset {
  relativePath: string;
  originalName: string;
  managed: boolean;
}

export type SyncRole = 'source' | 'translation';

export interface SyncCue {
  id: string;
  targetIds: string[];
  startUs: number;
  endUs: number;
  textMode: 'source' | 'selected-variant';
}

export interface SyncTrack {
  id: string;
  role: SyncRole;
  cues: SyncCue[];
}

export interface VerseProject {
  format: 'zyyk-verse-project';
  version: 1;
  revision: number;
  metadata: ProjectMetadata;
  languages: { source: string; target: string };
  sourceSegments: SourceSegment[];
  translations: TranslationUnit[];
  alignmentGroups: AlignmentGroup[];
  audio: AudioAsset | null;
  syncTracks: SyncTrack[];
}

export interface VaultEntry {
  name: string;
  path: string;
  kind: 'folder' | 'project';
  children: VaultEntry[];
}

export interface ImportedAudio {
  relativePath: string;
  storedPath: string;
  originalName: string;
}

export interface ParsedLyrics {
  sourceSegments: SourceSegment[];
  translations: TranslationUnit[];
  alignmentGroups: AlignmentGroup[];
  lineCount: number;
  sectionCount: number;
}
