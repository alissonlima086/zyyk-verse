use crate::model::VerseProject;
use chrono::Utc;
use std::fs;
use std::io::Write;
use std::path::Path;
use uuid::Uuid;

pub fn save_project(mut project: VerseProject, path: &Path) -> Result<VerseProject, String> {
    ensure_project_extension(path)?;
    project.validate()?;
    ensure_current_revision(&project, path)?;
    project.revision = project.revision.saturating_add(1);
    project.metadata.updated_at = Utc::now();
    project.validate()?;

    let parent = path
        .parent()
        .ok_or_else(|| "O destino do projeto não possui uma pasta válida.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível criar a pasta do projeto: {error}"))?;
    let temporary = parent.join(format!(".zyyk-verse-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(&project)
        .map_err(|error| format!("Não foi possível serializar o projeto: {error}"))?;

    let mut file = fs::File::create(&temporary)
        .map_err(|error| format!("Não foi possível criar o arquivo temporário: {error}"))?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Não foi possível gravar o projeto: {error}"));
    }
    drop(file);
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível publicar o projeto salvo: {error}"
        ));
    }
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| {
            format!("O projeto foi salvo, mas a pasta não pôde ser sincronizada: {error}")
        })?;
    Ok(project)
}

fn ensure_current_revision(project: &VerseProject, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let persisted = load_project(path).map_err(|error| {
        format!("O arquivo existente não pode ser verificado e não será sobrescrito: {error}")
    })?;
    if persisted.metadata.id != project.metadata.id {
        return Err(
            "O destino já contém outro projeto. Escolha outro nome para evitar sobrescrevê-lo."
                .to_owned(),
        );
    }
    if persisted.revision != project.revision {
        return Err(format!(
            "Conflito de edição: o arquivo está na revisão {}, mas esta janela editava a revisão {}. Reabra o projeto antes de salvar.",
            persisted.revision, project.revision
        ));
    }
    Ok(())
}

pub fn load_project(path: &Path) -> Result<VerseProject, String> {
    ensure_project_extension(path)?;
    let bytes =
        fs::read(path).map_err(|error| format!("Não foi possível ler o projeto: {error}"))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("O arquivo não é um projeto ZYYK Verse válido: {error}"))?;
    let value = migrate_project(value)?;
    let project: VerseProject = serde_json::from_value(value)
        .map_err(|error| format!("O arquivo não é um projeto ZYYK Verse válido: {error}"))?;
    project.validate()?;
    Ok(project)
}

fn ensure_project_extension(path: &Path) -> Result<(), String> {
    if path.extension().and_then(|value| value.to_str()) == Some("zyykverse") {
        Ok(())
    } else {
        Err("O projeto precisa usar a extensão .zyykverse.".to_owned())
    }
}

fn migrate_project(value: serde_json::Value) -> Result<serde_json::Value, String> {
    let format = value.get("format").and_then(serde_json::Value::as_str);
    if format != Some(crate::model::PROJECT_FORMAT) {
        return Err("Formato de projeto não suportado.".to_owned());
    }
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "O projeto não informa uma versão válida.".to_owned())?;
    match version {
        1 => Ok(value),
        other => Err(format!("Versão de projeto não suportada: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics::parse_pasted_lyrics;

    #[test]
    fn saves_and_loads_a_valid_project_atomically() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-test-{}", Uuid::new_v4()));
        let path = root.join("song.zyykverse");
        let mut project = VerseProject::new("Song");
        let parsed = parse_pasted_lyrics("First line\nSecond line");
        project.source_segments = parsed.source_segments;
        project.translations = parsed.translations;
        project.alignment_groups = parsed.alignment_groups;

        let saved = save_project(project, &path).unwrap();
        let loaded = load_project(&path).unwrap();
        assert_eq!(saved, loaded);
        assert_eq!(loaded.revision, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn opens_projects_created_before_sync_tracks_existed() {
        let mut project = VerseProject::new("Legacy song");
        let parsed = parse_pasted_lyrics("Legacy line");
        project.source_segments = parsed.source_segments;
        project.translations = parsed.translations;
        project.alignment_groups = parsed.alignment_groups;
        let mut json = serde_json::to_value(project).unwrap();
        json.as_object_mut().unwrap().remove("syncTracks");
        json["translations"][0]
            .as_object_mut()
            .unwrap()
            .remove("lineIds");

        let loaded: VerseProject = serde_json::from_value(json).unwrap();

        assert!(loaded.sync_tracks.is_empty());
        assert!(loaded.translations[0].line_ids.is_empty());
        loaded.validate().unwrap();
    }

    #[test]
    fn rejects_unknown_future_project_versions() {
        let project = VerseProject::new("Future song");
        let mut json = serde_json::to_value(project).unwrap();
        json["version"] = serde_json::json!(99);

        assert!(migrate_project(json).is_err());
    }

    #[test]
    fn rejects_a_stale_save_instead_of_overwriting_newer_work() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-test-{}", Uuid::new_v4()));
        let path = root.join("song.zyykverse");
        let first = save_project(VerseProject::new("Song"), &path).unwrap();
        let stale = first.clone();

        let mut newer = first;
        newer.metadata.title = "Newer edit".to_owned();
        let newer = save_project(newer, &path).unwrap();
        let error = save_project(stale, &path).unwrap_err();

        assert!(error.contains("Conflito de edição"));
        assert_eq!(load_project(&path).unwrap(), newer);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_overwriting_a_different_project_with_the_same_revision() {
        let root = std::env::temp_dir().join(format!("zyyk-verse-test-{}", Uuid::new_v4()));
        let path = root.join("song.zyykverse");
        let saved = save_project(VerseProject::new("First"), &path).unwrap();
        let mut other = VerseProject::new("Other");
        other.revision = saved.revision;

        let error = save_project(other, &path).unwrap_err();

        assert!(error.contains("outro projeto"));
        assert_eq!(load_project(&path).unwrap(), saved);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_the_project_contract_fixture_shared_with_typescript() {
        let project: VerseProject =
            serde_json::from_str(include_str!("../../tests/fixtures/project-v1.json")).unwrap();
        project.validate().unwrap();
        assert_eq!(project.version, 1);
        assert_eq!(project.source_segments[0].text, "First line");
    }
}
