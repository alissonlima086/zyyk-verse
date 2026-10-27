use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub type MediaRegistry = Arc<Mutex<HashMap<String, PathBuf>>>;

pub struct MediaServer {
    pub port: u16,
    running: Arc<AtomicBool>,
}

impl MediaServer {
    pub fn start(registry: MediaRegistry) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("Falha ao iniciar servidor local de áudio: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();
        let running = Arc::new(AtomicBool::new(true));
        let thread_running = running.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                if !thread_running.load(Ordering::Relaxed) {
                    break;
                }
                if let Ok(stream) = stream {
                    let registry = registry.clone();
                    thread::spawn(move || {
                        let _ = Self::serve(stream, &registry);
                    });
                }
            }
        });
        Ok(Self { port, running })
    }

    fn serve(mut stream: TcpStream, registry: &MediaRegistry) -> std::io::Result<()> {
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
        let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(30)));
        let mut reader = BufReader::new(&mut stream);
        let mut request_line = String::new();
        if reader.read_line(&mut request_line)? == 0 || request_line.len() > 8192 {
            return Ok(());
        }
        let mut range = None;
        let mut header_bytes = request_line.len();
        for _ in 0..64 {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
                break;
            }
            header_bytes = header_bytes.saturating_add(line.len());
            if line.len() > 8192 || header_bytes > 32 * 1024 {
                return Ok(());
            }
            if line.to_ascii_lowercase().starts_with("range:") {
                range = Some(line.trim().to_owned());
            }
        }
        drop(reader);

        let parts: Vec<_> = request_line.split_whitespace().collect();
        let method = parts.first().copied().unwrap_or_default();
        let route = parts.get(1).copied().unwrap_or_default();
        if method != "GET" && method != "HEAD" {
            return Self::empty_response(&mut stream, "405 Method Not Allowed");
        }
        let token = route.strip_prefix("/audio/").unwrap_or_default();
        if token.is_empty() || token.contains('/') {
            return Self::empty_response(&mut stream, "400 Bad Request");
        }
        let path = registry
            .lock()
            .ok()
            .and_then(|entries| entries.get(token).cloned());
        let Some(path) = path.filter(|path| path.is_file()) else {
            return Self::empty_response(&mut stream, "404 Not Found");
        };
        let mut file = File::open(&path)?;
        let total = file.metadata()?.len();
        let mime = mime_type(&path);
        let parsed_range = range.as_deref().and_then(|value| parse_range(value, total));
        let (status, start, end) = parsed_range
            .map(|(start, end)| ("206 Partial Content", start, end))
            .unwrap_or(("200 OK", 0, total.saturating_sub(1)));
        let length = if total == 0 { 0 } else { end - start + 1 };
        let content_range = if status.starts_with("206") {
            format!("Content-Range: bytes {start}-{end}/{total}\r\n")
        } else {
            String::new()
        };
        let header = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nAccept-Ranges: bytes\r\n{content_range}Content-Length: {length}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(header.as_bytes())?;
        if method == "HEAD" || length == 0 {
            return Ok(());
        }
        file.seek(SeekFrom::Start(start))?;
        let mut limited = file.take(length);
        let mut buffer = [0u8; 128 * 1024];
        loop {
            let read = limited.read(&mut buffer)?;
            if read == 0 || stream.write_all(&buffer[..read]).is_err() {
                break;
            }
        }
        Ok(())
    }

    fn empty_response(stream: &mut TcpStream, status: &str) -> std::io::Result<()> {
        stream.write_all(
            format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
    }
}

impl Drop for MediaServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let value = header.split_once(':')?.1.trim();
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>().ok()?.min(total - 1)
    };
    (start <= end && start < total).then_some((start, end))
}

fn mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("ogg") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_and_bounded_ranges() {
        assert_eq!(parse_range("Range: bytes=2-5", 10), Some((2, 5)));
        assert_eq!(parse_range("Range: bytes=4-", 10), Some((4, 9)));
        assert_eq!(parse_range("Range: bytes=20-", 10), None);
    }

    #[test]
    fn streams_registered_audio_with_range_support() {
        let path = std::env::temp_dir().join(format!("zyyk-media-{}.wav", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"0123456789").unwrap();
        let registry = Arc::new(Mutex::new(HashMap::new()));
        registry
            .lock()
            .unwrap()
            .insert("test-token".to_owned(), path.clone());
        let server = MediaServer::start(registry).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
        stream
            .write_all(b"GET /audio/test-token HTTP/1.1\r\nRange: bytes=2-5\r\n\r\n")
            .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        let response = String::from_utf8_lossy(&response);
        assert!(response.starts_with("HTTP/1.1 206 Partial Content"));
        assert!(response.ends_with("2345"));
        let _ = std::fs::remove_file(path);
    }
}
