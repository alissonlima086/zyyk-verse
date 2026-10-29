import type { ImportedAudio, ParsedLyrics, VaultEntry, VerseProject } from '../types/project.ts';
import { parseLyricsLocally } from '../domain/lyrics.ts';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function parseLyrics(text: string, emptyLyricsError = 'Cole ao menos uma linha de letra.'): Promise<ParsedLyrics> {
  if (!inTauri()) {
    const parsed = parseLyricsLocally(text);
    if (!parsed.lineCount) throw new Error(emptyLyricsError);
    return parsed;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ParsedLyrics>('parse_lyrics', { text });
}

export async function chooseAndOpenProject(): Promise<{ project: VerseProject; path: string } | null> {
  if (!inTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, filters: [{ name: 'Projeto ZYYK Verse', extensions: ['zyykverse'] }] });
  if (!path || Array.isArray(path)) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const project = await invoke<VerseProject>('open_project', { path });
  return { project, path };
}

export async function openProject(path: string): Promise<VerseProject> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<VerseProject>('open_project', { path });
}

export async function chooseVaultFolder(title = 'Escolha a pasta da sua vault'): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ directory: true, multiple: false, title });
  return typeof path === 'string' ? path : null;
}

export async function listVault(path: string): Promise<VaultEntry[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<VaultEntry[]>('list_vault', { path });
}

export async function createVaultFolder(root: string, parent: string | null, name: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('create_vault_folder', { root, parent, name });
}

export async function createVaultProject(root: string, parent: string | null, title: string): Promise<{ project: VerseProject; path: string }> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<{ project: VerseProject; path: string }>('create_vault_project', { root, parent, title });
}

export async function moveVaultEntry(root: string, source: string, targetDirectory: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('move_vault_entry', { root, source, targetDirectory });
}

export async function renameVaultEntry(root: string, path: string, name: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('rename_vault_entry', { root, path, name });
}

export async function deleteVaultEntry(root: string, path: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('delete_vault_entry', { root, path });
}

export async function chooseAudioFile(labels: { title: string; filterName: string } = {
  title: 'Adicionar áudio ao projeto',
  filterName: 'Áudio',
}): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    title: labels.title,
    filters: [{ name: labels.filterName, extensions: ['mp3', 'flac', 'wav', 'ogg'] }],
  });
  return typeof path === 'string' ? path : null;
}

export async function importProjectAudio(source: string, projectPath: string, projectId: string): Promise<ImportedAudio> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ImportedAudio>('import_project_audio', { source, projectPath, projectId });
}

export async function resolveProjectAudio(projectPath: string, relativePath: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('resolve_project_audio', { projectPath, relativePath });
}

export async function loadWaveformCache(projectPath: string, relativePath: string): Promise<number[] | null> {
  if (!inTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number[] | null>('load_waveform_cache', { projectPath, relativePath });
}

export async function generateProjectWaveform(
  projectPath: string,
  relativePath: string,
  peakCount = 1_400,
): Promise<number[] | null> {
  if (!inTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number[]>('generate_waveform', { projectPath, relativePath, peakCount });
}

export async function cancelProjectWaveform(): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cancel_waveform');
}

export async function saveWaveformCache(projectPath: string, relativePath: string, peaks: number[]): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('save_waveform_cache', { projectPath, relativePath, peaks });
}

export async function chooseExportPath(
  suggestedName: string,
  format: 'srt' | 'vtt' | 'lrc',
): Promise<string | null> {
  if (!inTauri()) return suggestedName;
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({
    defaultPath: suggestedName,
    filters: [{
      name: format === 'srt' ? 'SubRip Subtitle' : format === 'vtt' ? 'WebVTT Subtitle' : 'LRC Lyrics',
      extensions: [format],
    }],
  });
}

export async function writeExportFile(path: string, contents: string): Promise<void> {
  if (!inTauri()) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    link.download = path.split(/[\\/]/).at(-1) || 'legenda.srt';
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('write_export_file', { path, contents });
}


export async function saveProject(
  project: VerseProject,
  currentPath: string | null,
): Promise<{ project: VerseProject; path: string } | null> {
  if (!inTauri()) {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFileName(project.metadata.title)}.zyykverse`;
    anchor.click();
    URL.revokeObjectURL(url);
    return { project, path: anchor.download };
  }
  let path = currentPath;
  if (!path) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    path = await save({
      defaultPath: `${safeFileName(project.metadata.title)}.zyykverse`,
      filters: [{ name: 'Projeto ZYYK Verse', extensions: ['zyykverse'] }],
    });
  }
  if (!path) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const saved = await invoke<VerseProject>('save_project', { project, path });
  return { project: saved, path };
}

function safeFileName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return normalized || 'sem-titulo';
}
