import type { VaultEntry } from '../types/project.ts';

function ordered(entries: VaultEntry[]): VaultEntry[] {
  return [...entries].sort((left, right) => {
    const rank = Number(left.kind === 'project') - Number(right.kind === 'project');
    return rank || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export function insertVaultEntry(
  entries: VaultEntry[],
  rootPath: string,
  parentPath: string | null,
  entry: VaultEntry,
): VaultEntry[] {
  if (!parentPath || parentPath === rootPath) return ordered([...entries, entry]);
  return entries.map((candidate) => candidate.path === parentPath && candidate.kind === 'folder'
    ? { ...candidate, children: ordered([...candidate.children, entry]) }
    : candidate.kind === 'folder'
      ? { ...candidate, children: insertVaultEntry(candidate.children, rootPath, parentPath, entry) }
      : candidate);
}

export function removeVaultEntry(entries: VaultEntry[], path: string): VaultEntry[] {
  return entries
    .filter((entry) => entry.path !== path)
    .map((entry) => entry.kind === 'folder'
      ? { ...entry, children: removeVaultEntry(entry.children, path) }
      : entry);
}

export function moveVaultEntryInTree(
  entries: VaultEntry[],
  rootPath: string,
  sourcePath: string,
  targetDirectory: string,
  destinationPath: string,
): VaultEntry[] {
  const source = findVaultEntry(entries, sourcePath);
  if (!source) return entries;
  const moved = rewritePath(source, sourcePath, destinationPath);
  return insertVaultEntry(removeVaultEntry(entries, sourcePath), rootPath, targetDirectory, moved);
}

export function renameVaultEntryInTree(
  entries: VaultEntry[],
  sourcePath: string,
  destinationPath: string,
  name: string,
): VaultEntry[] {
  return ordered(entries.map((entry) => {
    if (entry.path === sourcePath) {
      return rewritePath({ ...entry, name }, sourcePath, destinationPath);
    }
    return entry.kind === 'folder'
      ? { ...entry, children: renameVaultEntryInTree(entry.children, sourcePath, destinationPath, name) }
      : entry;
  }));
}

function findVaultEntry(entries: VaultEntry[], path: string): VaultEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.kind === 'folder') {
      const found = findVaultEntry(entry.children, path);
      if (found) return found;
    }
  }
  return null;
}

function rewritePath(entry: VaultEntry, sourcePath: string, destinationPath: string): VaultEntry {
  return {
    ...entry,
    path: entry.path === sourcePath ? destinationPath : entry.path.replace(`${sourcePath}/`, `${destinationPath}/`),
    children: entry.children.map((child) => rewritePath(child, sourcePath, destinationPath)),
  };
}
