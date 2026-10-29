#![cfg_attr(
    not(test),
    deny(clippy::expect_used, clippy::panic, clippy::unwrap_used)
)]

mod lyrics;
mod media_server;
mod model;
mod persistence;
mod vault;
mod waveform;

use lyrics::ParsedLyrics;
use model::VerseProject;
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

async fn blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("A operação interna foi interrompida: {error}"))?
}

struct MediaState {
    registry: media_server::MediaRegistry,
    port: u16,
}

struct WaveformState {
    generation: Arc<AtomicU64>,
}

#[tauri::command]
fn new_project(title: String) -> VerseProject {
    VerseProject::new(title)
}

#[tauri::command]
fn parse_lyrics(text: String) -> Result<ParsedLyrics, String> {
    let parsed = lyrics::parse_pasted_lyrics(&text);
    if parsed.line_count == 0 {
        return Err("Cole ao menos uma linha de letra.".to_owned());
    }
    Ok(parsed)
}

#[tauri::command]
async fn save_project(project: VerseProject, path: String) -> Result<VerseProject, String> {
    blocking(move || persistence::save_project(project, Path::new(&path))).await
}

#[tauri::command]
async fn open_project(path: String) -> Result<VerseProject, String> {
    blocking(move || persistence::load_project(Path::new(&path))).await
}

#[tauri::command]
async fn list_vault(path: String) -> Result<Vec<vault::VaultEntry>, String> {
    blocking(move || vault::list(Path::new(&path))).await
}

#[tauri::command]
async fn create_vault_folder(
    root: String,
    parent: Option<String>,
    name: String,
) -> Result<String, String> {
    blocking(move || {
        vault::create_folder(Path::new(&root), parent.as_deref().map(Path::new), &name)
    })
    .await
}

#[tauri::command]
async fn create_vault_project(
    root: String,
    parent: Option<String>,
    title: String,
) -> Result<vault::CreatedProject, String> {
    blocking(move || {
        vault::create_project(Path::new(&root), parent.as_deref().map(Path::new), &title)
    })
    .await
}

#[tauri::command]
async fn move_vault_entry(
    root: String,
    source: String,
    target_directory: String,
) -> Result<String, String> {
    blocking(move || {
        vault::move_entry(
            Path::new(&root),
            Path::new(&source),
            Path::new(&target_directory),
        )
    })
    .await
}

#[tauri::command]
async fn rename_vault_entry(root: String, path: String, name: String) -> Result<String, String> {
    blocking(move || vault::rename_entry(Path::new(&root), Path::new(&path), &name)).await
}

#[tauri::command]
async fn delete_vault_entry(root: String, path: String) -> Result<(), String> {
    blocking(move || vault::delete_entry(Path::new(&root), Path::new(&path))).await
}

#[tauri::command]
async fn import_project_audio(
    source: String,
    project_path: String,
    project_id: String,
) -> Result<vault::ImportedAudio, String> {
    blocking(move || vault::import_audio(Path::new(&source), Path::new(&project_path), &project_id))
        .await
}

#[tauri::command]
fn resolve_project_audio(
    state: tauri::State<'_, MediaState>,
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    let path = vault::resolve_audio(Path::new(&project_path), Path::new(&relative_path))?;
    let token = uuid::Uuid::new_v4().to_string();
    let canonical = std::fs::canonicalize(&path)
        .map_err(|error| format!("Não foi possível localizar o áudio preparado: {error}"))?;
    if state.port == 0 {
        return Err("O servidor local de áudio não está disponível.".to_owned());
    }
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry.insert(token.clone(), canonical);
    Ok(format!("http://127.0.0.1:{}/audio/{token}", state.port))
}

#[tauri::command]
async fn generate_waveform(
    state: tauri::State<'_, WaveformState>,
    project_path: String,
    relative_path: String,
    peak_count: usize,
) -> Result<Vec<f32>, String> {
    let generation = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    let current_generation = state.generation.clone();
    blocking(move || {
        let project_path = Path::new(&project_path);
        let relative_path = Path::new(&relative_path);
        if let Some(cached) = vault::load_waveform_cache(project_path, relative_path)? {
            return Ok(cached);
        }
        let audio = vault::resolve_audio(project_path, relative_path)?;
        let cancelled = || current_generation.load(Ordering::Acquire) != generation;
        let peaks = waveform::decode_with_cancel(Path::new(&audio), peak_count, &cancelled)?;
        if cancelled() {
            return Err(waveform::CANCELLED_ERROR.to_owned());
        }
        vault::save_waveform_cache(project_path, relative_path, &peaks)?;
        Ok(peaks)
    })
    .await
}

#[tauri::command]
async fn decode_project_audio(
    project_path: String,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = blocking(move || {
        let audio = vault::resolve_audio(Path::new(&project_path), Path::new(&relative_path))?;
        waveform::decode_to_wav(Path::new(&audio))
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn cancel_waveform(state: tauri::State<'_, WaveformState>) {
    state.generation.fetch_add(1, Ordering::AcqRel);
}

#[tauri::command]
fn load_waveform_cache(
    project_path: String,
    relative_path: String,
) -> Result<Option<Vec<f32>>, String> {
    vault::load_waveform_cache(Path::new(&project_path), Path::new(&relative_path))
}

#[tauri::command]
fn save_waveform_cache(
    project_path: String,
    relative_path: String,
    peaks: Vec<f32>,
) -> Result<(), String> {
    vault::save_waveform_cache(Path::new(&project_path), Path::new(&relative_path), &peaks)
}

#[tauri::command]
fn write_export_file(path: String, contents: String) -> Result<(), String> {
    let extension = Path::new(&path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("srt" | "vtt" | "lrc")) {
        return Err("A exportação precisa usar a extensão .srt, .vtt ou .lrc.".to_owned());
    }
    if contents.len() > 20 * 1024 * 1024 {
        return Err("O arquivo exportado excede o limite de 20 MB.".to_owned());
    }
    std::fs::write(Path::new(&path), contents)
        .map_err(|error| format!("Não foi possível exportar o arquivo: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let media_server = media_server::MediaServer::start(registry.clone()).ok();
    let media_state = MediaState {
        registry,
        port: media_server.as_ref().map(|server| server.port).unwrap_or(0),
    };
    let waveform_state = WaveformState {
        generation: Arc::new(AtomicU64::new(0)),
    };
    let mut context = tauri::generate_context!();
    if let Some(server) = media_server.as_ref() {
        let origin = format!("http://127.0.0.1:{}", server.port);
        context.config_mut().app.security.csp = Some(tauri::utils::config::Csp::Policy(format!(
            "default-src 'self' ipc: http://ipc.localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: {origin}; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost {origin};"
        )));
    }
    let app = tauri::Builder::default()
        .manage(media_state)
        .manage(waveform_state)
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            new_project,
            parse_lyrics,
            save_project,
            open_project,
            list_vault,
            create_vault_folder,
            create_vault_project,
            move_vault_entry,
            rename_vault_entry,
            delete_vault_entry,
            import_project_audio,
            resolve_project_audio,
            decode_project_audio,
            generate_waveform,
            cancel_waveform,
            load_waveform_cache,
            save_waveform_cache,
            write_export_file,
        ])
        .build(context);

    match app {
        Ok(app) => app.run(move |_handle, _event| {
            let _keep_media_server_alive = &media_server;
        }),
        Err(error) => eprintln!("Erro fatal ao iniciar o ZYYK Verse: {error}"),
    }
}
