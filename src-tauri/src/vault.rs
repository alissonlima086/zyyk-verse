use crate::model::VerseProject;
use crate::persistence;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    name: String,
    path: String,
    kind: &'static str,
    children: Vec<VaultEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    project: VerseProject,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAudio {
    relative_path: String,
    pub(crate) stored_path: String,
    original_name: String,
}

pub fn list(root: &Path) -> Result<Vec<VaultEntry>, String> {
    let root = canonical_directory(root, "A vault")?;
    list_directory(&root)
}

fn list_directory(directory: &Path) -> Result<Vec<VaultEntry>, String> {
    let mut entries = Vec::new();
    let read = fs::read_dir(directory)
        .map_err(|error| format!("Não foi possível ler a vault: {error}"))?;
    for item in read {
        let item =
            item.map_err(|error| format!("Não foi possível ler um item da vault: {error}"))?;
        let path = item.path();
        let file_type = item
            .file_type()
            .map_err(|error| format!("Não foi possível inspecionar um item da vault: {error}"))?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            entries.push(VaultEntry {
                name,
                path: display_path(&path),
                kind: "folder",
                children: list_directory(&path)?,
            });
        } else if path.extension().and_then(|value| value.to_str()) == Some("zyykverse") {
            entries.push(VaultEntry {
                name: name.trim_end_matches(".zyykverse").to_owned(),
                path: display_path(&path),
                kind: "project",
                children: Vec::new(),
            });
        }
    }
    entries.sort_by(|left, right| {
        let left_rank = if left.kind == "folder" { 0 } else { 1 };
        let right_rank = if right.kind == "folder" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn create_folder(root: &Path, parent: Option<&Path>, name: &str) -> Result<String, String> {
    let root = canonical_directory(root, "A vault")?;
    let parent = checked_directory(&root, parent.unwrap_or(&root))?;
    let clean = clean_name(name)?;
    let destination = parent.join(clean);
    if destination.exists() {
        return Err("Já existe um item com esse nome nesta pasta.".to_owned());
    }
    fs::create_dir(&destination)
        .map_err(|error| format!("Não foi possível criar a pasta: {error}"))?;
    Ok(display_path(&destination))
}

pub fn create_project(
    root: &Path,
    parent: Option<&Path>,
    title: &str,
) -> Result<CreatedProject, String> {
    let root = canonical_directory(root, "A vault")?;
    let parent = checked_directory(&root, parent.unwrap_or(&root))?;
    let title = title.trim();
    if title.is_empty() {
        return Err("Informe um nome para o projeto.".to_owned());
    }
    let base = clean_name(title)?;
    let mut destination = parent.join(format!("{base}.zyykverse"));
    let mut suffix = 2;
    while destination.exists() {
        destination = parent.join(format!("{base} {suffix}.zyykverse"));
        suffix += 1;
    }
    let project = persistence::save_project(VerseProject::new(title), &destination)?;
    Ok(CreatedProject {
        project,
        path: display_path(&destination),
    })
}

pub fn move_entry(root: &Path, source: &Path, target_directory: &Path) -> Result<String, String> {
    let root = canonical_directory(root, "A vault")?;
    let source =
        fs::canonicalize(source).map_err(|error| format!("Item de origem inválido: {error}"))?;
    ensure_inside(&root, &source)?;
    if source == root {
        return Err("A própria vault não pode ser movida.".to_owned());
    }
    let target = checked_directory(&root, target_directory)?;
    if target.starts_with(&source) {
        return Err("Uma pasta não pode ser movida para dentro dela mesma.".to_owned());
    }
    let file_name = source
        .file_name()
        .ok_or_else(|| "O item não possui um nome válido.".to_owned())?;
    let destination = target.join(file_name);
    if destination.exists() {
        return Err("Já existe um item com esse nome na pasta de destino.".to_owned());
    }
    fs::rename(&source, &destination)
        .map_err(|error| format!("Não foi possível mover o item: {error}"))?;
    Ok(display_path(&destination))
}

pub fn rename_entry(root: &Path, entry: &Path, name: &str) -> Result<String, String> {
    let root = canonical_directory(root, "A vault")?;
    let entry = fs::canonicalize(entry).map_err(|error| format!("Item inválido: {error}"))?;
    ensure_inside(&root, &entry)?;
    if entry == root {
        return Err("A própria vault não pode ser renomeada.".to_owned());
    }

    let clean = clean_name(name)?;
    let parent = entry
        .parent()
        .ok_or_else(|| "O item não possui uma pasta válida.".to_owned())?;
    let destination = if entry.is_dir() {
        parent.join(clean)
    } else if entry.extension().and_then(|value| value.to_str()) == Some("zyykverse") {
        parent.join(format!("{clean}.zyykverse"))
    } else {
        return Err("Somente projetos e pastas da vault podem ser renomeados.".to_owned());
    };

    if destination == entry {
        return Ok(display_path(&entry));
    }
    if destination.exists() {
        return Err("Já existe um item com esse nome nesta pasta.".to_owned());
    }
    fs::rename(&entry, &destination)
        .map_err(|error| format!("Não foi possível renomear o item: {error}"))?;
    Ok(display_path(&destination))
}

pub fn delete_entry(root: &Path, entry: &Path) -> Result<(), String> {
    let root = canonical_directory(root, "A vault")?;
    let entry = fs::canonicalize(entry).map_err(|error| format!("Item inválido: {error}"))?;
    ensure_inside(&root, &entry)?;
    if entry == root {
        return Err("A própria vault não pode ser excluída.".to_owned());
    }
    if entry.is_dir() {
        fs::remove_dir_all(&entry)
            .map_err(|error| format!("Não foi possível excluir a pasta: {error}"))
    } else if entry.extension().and_then(|value| value.to_str()) == Some("zyykverse") {
        let managed_assets = persistence::load_project(&entry)
            .ok()
            .and_then(|project| managed_assets_directory(&entry, &project.metadata.id).ok());
        fs::remove_file(&entry)
            .map_err(|error| format!("Não foi possível excluir o projeto: {error}"))?;
        if let Some(assets) = managed_assets.filter(|path| path.is_dir()) {
            fs::remove_dir_all(assets).map_err(|error| {
                format!(
                    "O projeto foi excluído, mas seus recursos não puderam ser removidos: {error}"
                )
            })?;
        }
        Ok(())
    } else {
        Err("Somente projetos e pastas da vault podem ser excluídos.".to_owned())
    }
}

pub fn import_audio(
    source: &Path,
    project_path: &Path,
    project_id: &str,
) -> Result<ImportedAudio, String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if !matches!(extension.as_str(), "mp3" | "flac" | "wav" | "ogg") {
        return Err("Formato de áudio não suportado. Use MP3, FLAC, WAV ou OGG.".to_owned());
    }
    if !source.is_file() {
        return Err("O arquivo de áudio não foi encontrado.".to_owned());
    }
    let assets = managed_assets_directory(project_path, project_id)?;
    let project_parent = project_path
        .parent()
        .ok_or_else(|| "O projeto não possui uma pasta válida.".to_owned())?;
    fs::create_dir_all(&assets)
        .map_err(|error| format!("Não foi possível criar a pasta de áudio: {error}"))?;
    let original_name = source
        .file_name()
        .ok_or_else(|| "O áudio não possui um nome válido.".to_owned())?
        .to_string_lossy()
        .into_owned();
    let destination = assets.join(format!("audio.{extension}"));
    if let Ok(entries) = fs::read_dir(&assets) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let obsolete_audio = name.starts_with("audio.") && entry.path() != destination;
            if name.starts_with(".waveform-v1-") || obsolete_audio {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    fs::copy(source, &destination)
        .map_err(|error| format!("Não foi possível copiar o áudio: {error}"))?;
    let relative = destination
        .strip_prefix(project_parent)
        .map_err(|_| "Não foi possível criar a referência relativa do áudio.".to_owned())?;
    Ok(ImportedAudio {
        relative_path: display_path(relative),
        stored_path: display_path(&destination),
        original_name,
    })
}

pub fn resolve_audio(project_path: &Path, relative_path: &Path) -> Result<String, String> {
    let parent = project_path
        .parent()
        .ok_or_else(|| "O projeto não possui uma pasta válida.".to_owned())?;
    let assets_root = parent.join(".zyykverse-assets");
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("A pasta do projeto não foi encontrada: {error}"))?;
    let canonical_assets = fs::canonicalize(&assets_root)
        .map_err(|error| format!("A pasta de recursos do projeto não foi encontrada: {error}"))?;
    if !canonical_assets.starts_with(&canonical_parent) {
        return Err("A pasta de recursos do projeto aponta para fora da vault.".to_owned());
    }
    let resolved = fs::canonicalize(parent.join(relative_path))
        .map_err(|error| format!("O áudio associado ao projeto não foi encontrado: {error}"))?;
    if !resolved.starts_with(&canonical_assets) || !resolved.is_file() {
        return Err("O áudio associado ao projeto não foi encontrado.".to_owned());
    }
    Ok(display_path(&resolved))
}

pub fn load_waveform_cache(
    project_path: &Path,
    relative_path: &Path,
) -> Result<Option<Vec<f32>>, String> {
    let audio = PathBuf::from(resolve_audio(project_path, relative_path)?);
    let cache = waveform_cache_path(&audio)?;
    if !cache.is_file() {
        return Ok(None);
    }
    let canonical_cache = fs::canonicalize(&cache)
        .map_err(|error| format!("Não foi possível validar o cache da waveform: {error}"))?;
    let audio_parent = audio
        .parent()
        .and_then(|path| fs::canonicalize(path).ok())
        .ok_or_else(|| "A pasta do áudio não é válida.".to_owned())?;
    if !canonical_cache.starts_with(audio_parent) {
        return Ok(None);
    }
    let bytes = fs::read(canonical_cache)
        .map_err(|error| format!("Não foi possível ler o cache da waveform: {error}"))?;
    let peaks: Vec<f32> = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Cache de waveform inválido: {error}"))?;
    if peaks.is_empty()
        || peaks.len() > 5_000
        || peaks
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
    {
        return Ok(None);
    }
    Ok(Some(peaks))
}

pub fn save_waveform_cache(
    project_path: &Path,
    relative_path: &Path,
    peaks: &[f32],
) -> Result<(), String> {
    if peaks.is_empty()
        || peaks.len() > 5_000
        || peaks
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
    {
        return Err("Dados de waveform inválidos.".to_owned());
    }
    let audio = PathBuf::from(resolve_audio(project_path, relative_path)?);
    let cache = waveform_cache_path(&audio)?;
    let bytes = serde_json::to_vec(peaks)
        .map_err(|error| format!("Não foi possível serializar a waveform: {error}"))?;
    let parent = audio
        .parent()
        .ok_or_else(|| "A pasta do áudio não é válida.".to_owned())?;
    let temporary = parent.join(format!(".waveform-{}.tmp", Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Não foi possível criar o cache da waveform: {error}"))?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível salvar o cache da waveform: {error}"
        ));
    }
    drop(file);
    if let Err(error) = fs::rename(&temporary, cache) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível publicar o cache da waveform: {error}"
        ));
    }
    Ok(())
}

fn waveform_cache_path(audio: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(audio)
        .map_err(|error| format!("Não foi possível inspecionar o áudio: {error}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    Ok(audio.with_file_name(format!(".waveform-v1-{}-{modified}.json", metadata.len())))
}

fn managed_assets_directory(project_path: &Path, project_id: &str) -> Result<PathBuf, String> {
    let project_id = Uuid::parse_str(project_id)
        .map_err(|_| "O projeto não possui um identificador UUID válido.".to_owned())?;
    let parent = project_path
        .parent()
        .ok_or_else(|| "O projeto não possui uma pasta válida.".to_owned())?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("A pasta do projeto não foi encontrada: {error}"))?;
    let assets_root = parent.join(".zyykverse-assets");
    if assets_root.exists() {
        let canonical_assets = fs::canonicalize(&assets_root)
            .map_err(|error| format!("A pasta de recursos do projeto não é válida: {error}"))?;
        if !canonical_assets.starts_with(&parent) {
            return Err("A pasta de recursos do projeto aponta para fora da vault.".to_owned());
        }
    }
    Ok(assets_root.join(project_id.to_string()))
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let path =
        fs::canonicalize(path).map_err(|error| format!("{label} não foi encontrada: {error}"))?;
    if !path.is_dir() {
        return Err(format!("{label} precisa ser uma pasta."));
    }
    Ok(path)
}

fn checked_directory(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let path = canonical_directory(path, "A pasta de destino")?;
    ensure_inside(root, &path)?;
    Ok(path)
}

fn ensure_inside(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("O caminho precisa permanecer dentro da vault.".to_owned())
    }
}

fn clean_name(name: &str) -> Result<String, String> {
    let clean = name
        .trim()
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
    if clean.is_empty() || clean == "." || clean == ".." {
        Err("Informe um nome válido.".to_owned())
    } else {
        Ok(clean)
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn creates_lists_and_moves_projects_inside_the_vault() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-vault-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let folder = create_folder(&root, None, "Álbum").unwrap();
        let created = create_project(&root, None, "Minha música").unwrap();
        let moved = move_entry(&root, Path::new(&created.path), Path::new(&folder)).unwrap();
        let entries = list(&root).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "folder");
        assert_eq!(entries[0].children.len(), 1);
        assert_eq!(entries[0].children[0].name, "Minha música");
        assert_eq!(entries[0].children[0].path, moved);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn renames_projects_and_folders_without_leaving_the_vault() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-rename-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let folder = create_folder(&root, None, "Rascunhos").unwrap();
        let created = create_project(&root, Some(Path::new(&folder)), "Canção antiga").unwrap();

        let renamed_project = rename_entry(&root, Path::new(&created.path), "Canção nova").unwrap();
        assert!(renamed_project.ends_with("Canção nova.zyykverse"));
        assert!(Path::new(&renamed_project).is_file());

        let renamed_folder = rename_entry(&root, Path::new(&folder), "Finalizadas").unwrap();
        assert!(Path::new(&renamed_folder).is_dir());
        assert!(Path::new(&renamed_folder)
            .join("Canção nova.zyykverse")
            .is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn imports_audio_into_managed_project_assets() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-audio-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let created = create_project(&root, None, "Song").unwrap();
        let source = root.join("source.wav");
        fs::write(&source, b"fake audio bytes").unwrap();

        let imported = import_audio(
            &source,
            Path::new(&created.path),
            &created.project.metadata.id,
        )
        .unwrap();

        assert!(Path::new(&imported.stored_path).is_file());
        assert_eq!(imported.original_name, "source.wav");
        assert!(imported.relative_path.contains(".zyykverse-assets"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deletes_a_project_and_its_managed_assets() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-delete-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let created = create_project(&root, None, "Disposable").unwrap();
        let assets = root
            .join(".zyykverse-assets")
            .join(&created.project.metadata.id);
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("audio.wav"), b"bytes").unwrap();

        delete_entry(&root, Path::new(&created.path)).unwrap();

        assert!(!Path::new(&created.path).exists());
        assert!(!assets.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_project_ids_and_audio_paths_that_escape_managed_assets() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-paths-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let created = create_project(&root, None, "Song").unwrap();
        let source = root.join("source.wav");
        fs::write(&source, b"audio").unwrap();

        assert!(import_audio(&source, Path::new(&created.path), "../../outside").is_err());
        assert!(resolve_audio(Path::new(&created.path), Path::new("../source.wav")).is_err());

        let _ = fs::remove_dir_all(root);
    }
}
