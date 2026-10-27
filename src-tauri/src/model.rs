use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

pub const PROJECT_FORMAT: &str = "zyyk-verse-project";
pub const PROJECT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePair {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Line,
    Section,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSegment {
    pub id: String,
    pub kind: SourceKind,
    pub text: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgressStatus {
    Pending,
    Review,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationVariant {
    pub id: String,
    pub text: String,
    pub notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationUnit {
    pub id: String,
    #[serde(default)]
    pub line_ids: Vec<String>,
    pub variants: Vec<TranslationVariant>,
    pub selected_variant_id: Option<String>,
    pub status: ProgressStatus,
    pub notes: String,
}

impl TranslationUnit {
    pub fn empty() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            line_ids: vec![Uuid::new_v4().to_string()],
            variants: Vec::new(),
            selected_variant_id: None,
            status: ProgressStatus::Pending,
            notes: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentGroup {
    pub id: String,
    pub source_segment_ids: Vec<String>,
    pub translation_unit_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAsset {
    pub relative_path: String,
    pub original_name: String,
    pub managed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncRole {
    Source,
    Translation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncTextMode {
    Source,
    SelectedVariant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCue {
    pub id: String,
    pub target_ids: Vec<String>,
    pub start_us: u64,
    pub end_us: u64,
    pub text_mode: SyncTextMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTrack {
    pub id: String,
    pub role: SyncRole,
    pub cues: Vec<SyncCue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseProject {
    pub format: String,
    pub version: u32,
    pub revision: u64,
    pub metadata: ProjectMetadata,
    pub languages: LanguagePair,
    pub source_segments: Vec<SourceSegment>,
    pub translations: Vec<TranslationUnit>,
    pub alignment_groups: Vec<AlignmentGroup>,
    #[serde(default)]
    pub audio: Option<AudioAsset>,
    #[serde(default)]
    pub sync_tracks: Vec<SyncTrack>,
}

impl VerseProject {
    pub fn new(title: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            format: PROJECT_FORMAT.to_owned(),
            version: PROJECT_VERSION,
            revision: 0,
            metadata: ProjectMetadata {
                id: Uuid::new_v4().to_string(),
                title: title.into(),
                artist: String::new(),
                album: String::new(),
                created_at: now,
                updated_at: now,
            },
            languages: LanguagePair {
                source: "en".to_owned(),
                target: "pt-BR".to_owned(),
            },
            source_segments: Vec::new(),
            translations: Vec::new(),
            alignment_groups: Vec::new(),
            audio: None,
            sync_tracks: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.format != PROJECT_FORMAT {
            return Err(format!("Formato de projeto não suportado: {}", self.format));
        }
        if self.version != PROJECT_VERSION {
            return Err(format!("Versão de projeto não suportada: {}", self.version));
        }
        if self.metadata.id.trim().is_empty() {
            return Err("O projeto não possui um identificador válido.".to_owned());
        }
        Uuid::parse_str(&self.metadata.id)
            .map_err(|_| "O projeto não possui um identificador UUID válido.".to_owned())?;

        let source_ids = unique_ids(
            self.source_segments
                .iter()
                .map(|segment| segment.id.as_str()),
            "segmento original",
        )?;
        let translation_ids = unique_ids(
            self.translations.iter().map(|unit| unit.id.as_str()),
            "unidade de tradução",
        )?;
        let mut translation_target_ids = translation_ids.clone();
        for unit in &self.translations {
            for line_id in &unit.line_ids {
                if line_id.trim().is_empty() {
                    return Err("Foi encontrada uma sublinha de tradução sem identificador.".to_owned());
                }
                if !translation_target_ids.insert(line_id.as_str()) {
                    return Err(format!("Identificador duplicado de sublinha de tradução: {line_id}"));
                }
            }
        }
        unique_ids(
            self.alignment_groups.iter().map(|group| group.id.as_str()),
            "grupo de alinhamento",
        )?;

        for unit in &self.translations {
            let variant_ids = unique_ids(
                unit.variants.iter().map(|variant| variant.id.as_str()),
                "variante",
            )?;
            if let Some(selected) = unit.selected_variant_id.as_deref() {
                if !variant_ids.contains(selected) {
                    return Err(format!(
                        "A tradução '{}' aponta para uma variante inexistente.",
                        unit.id
                    ));
                }
            }
            if unit.status == ProgressStatus::Completed {
                let selected_text = unit
                    .selected_variant_id
                    .as_deref()
                    .and_then(|id| unit.variants.iter().find(|variant| variant.id == id))
                    .map(|variant| variant.text.trim())
                    .unwrap_or_default();
                if selected_text.is_empty() {
                    return Err("Uma tradução concluída precisa de texto selecionado.".to_owned());
                }
            }
        }

        let mut aligned_source = HashSet::new();
        let mut aligned_translations = HashSet::new();
        for group in &self.alignment_groups {
            if group.source_segment_ids.is_empty() {
                return Err("Um grupo de alinhamento não pode ficar sem original.".to_owned());
            }
            for id in &group.source_segment_ids {
                if !source_ids.contains(id.as_str()) {
                    return Err(format!(
                        "Grupo aponta para segmento original inexistente: {id}"
                    ));
                }
                if !aligned_source.insert(id.as_str()) {
                    return Err(format!(
                        "Segmento original aparece em mais de um grupo: {id}"
                    ));
                }
            }
            for id in &group.translation_unit_ids {
                if !translation_ids.contains(id.as_str()) {
                    return Err(format!("Grupo aponta para tradução inexistente: {id}"));
                }
                if !aligned_translations.insert(id.as_str()) {
                    return Err(format!("Tradução aparece em mais de um grupo: {id}"));
                }
            }
        }
        if aligned_source.len() != source_ids.len() {
            return Err("Existem segmentos originais fora dos grupos de alinhamento.".to_owned());
        }
        if aligned_translations.len() != translation_ids.len() {
            return Err("Existem traduções fora dos grupos de alinhamento.".to_owned());
        }
        for track in &self.sync_tracks {
            for cue in &track.cues {
                if cue.target_ids.is_empty() || cue.start_us >= cue.end_us {
                    return Err("Cue de sincronização com intervalo ou alvo inválido.".to_owned());
                }
                for id in &cue.target_ids {
                    let exists = match track.role {
                        SyncRole::Source => source_ids.contains(id.as_str()),
                        SyncRole::Translation => translation_target_ids.contains(id.as_str()),
                    };
                    if !exists {
                        return Err(format!("Cue aponta para alvo inexistente: {id}"));
                    }
                }
            }
        }
        Ok(())
    }
}

fn unique_ids<'a>(
    values: impl Iterator<Item = &'a str>,
    entity: &str,
) -> Result<HashSet<&'a str>, String> {
    let mut ids = HashSet::new();
    for id in values {
        if id.trim().is_empty() {
            return Err(format!("Foi encontrado {entity} sem identificador."));
        }
        if !ids.insert(id) {
            return Err(format!("Identificador duplicado de {entity}: {id}"));
        }
    }
    Ok(ids)
}
