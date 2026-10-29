use std::fs::File;
use std::io::ErrorKind;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};

pub const CANCELLED_ERROR: &str = "Geração da waveform cancelada.";

pub fn decode_to_wav(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path)
        .map_err(|error| format!("Não foi possível abrir o áudio para decodificação: {error}"))?;
    let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let probed = get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Formato de áudio não reconhecido: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .filter(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "O áudio não possui uma trilha decodificável.".to_owned())?;
    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("Codec de áudio indisponível: {error}"))?;
    let mut sample_rate = None;
    let mut channel_count = None;
    let mut pcm = Vec::<i16>::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => return Err(format!("Falha ao ler o áudio: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => return Err(format!("Falha ao decodificar o áudio: {error}")),
        };
        let rate = decoded.spec().rate;
        let channels = decoded.spec().channels.count();
        if sample_rate.is_some_and(|current| current != rate)
            || channel_count.is_some_and(|current| current != channels)
        {
            return Err("O formato interno do áudio muda durante o arquivo.".to_owned());
        }
        sample_rate = Some(rate);
        channel_count = Some(channels);
        let mut samples = SampleBuffer::<i16>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        pcm.extend_from_slice(samples.samples());
    }

    let rate = sample_rate.ok_or_else(|| "O áudio não contém amostras.".to_owned())?;
    let channels = u16::try_from(channel_count.unwrap_or(0))
        .map_err(|_| "Quantidade de canais inválida.".to_owned())?;
    if channels == 0 {
        return Err("O áudio não contém canais.".to_owned());
    }
    encode_pcm_wav(&pcm, rate, channels)
}

fn encode_pcm_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    let data_len = samples
        .len()
        .checked_mul(2)
        .and_then(|length| u32::try_from(length).ok())
        .ok_or_else(|| "O áudio decodificado excede o limite do formato WAV.".to_owned())?;
    let riff_len = 36_u32
        .checked_add(data_len)
        .ok_or_else(|| "O áudio decodificado excede o limite do formato WAV.".to_owned())?;
    let block_align = channels
        .checked_mul(2)
        .ok_or_else(|| "Configuração de canais inválida.".to_owned())?;
    let byte_rate = sample_rate
        .checked_mul(u32::from(block_align))
        .ok_or_else(|| "Taxa de áudio inválida.".to_owned())?;
    let mut wav = Vec::with_capacity(data_len as usize + 44);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&riff_len.to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(wav)
}

#[cfg(test)]
pub fn decode(path: &Path, peak_count: usize) -> Result<Vec<f32>, String> {
    decode_with_cancel(path, peak_count, &|| false)
}

pub fn decode_with_cancel(
    path: &Path,
    peak_count: usize,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<f32>, String> {
    let peak_count = peak_count.clamp(100, 5_000);
    let file = File::open(path).map_err(|error| {
        format!("Não foi possível abrir o áudio para gerar a waveform: {error}")
    })?;
    let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let probed = get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Formato de áudio não reconhecido para a waveform: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .filter(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "O áudio não possui uma trilha decodificável.".to_owned())?;
    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("Codec de áudio indisponível para a waveform: {error}"))?;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44_100) as usize;
    let bucket_frames = (sample_rate / 100).max(1);
    let mut coarse = Vec::new();
    let mut bucket_peak = 0.0_f32;
    let mut frames_in_bucket = 0_usize;

    loop {
        if cancelled() {
            return Err(CANCELLED_ERROR.to_owned());
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => {
                break
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => return Err(format!("Falha ao ler o áudio para a waveform: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "Falha ao decodificar o áudio para a waveform: {error}"
                ))
            }
        };
        let channels = decoded.spec().channels.count().max(1);
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        for frame in samples.samples().chunks(channels) {
            let frame_peak = frame
                .iter()
                .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
            bucket_peak = bucket_peak.max(frame_peak);
            frames_in_bucket += 1;
            if frames_in_bucket >= bucket_frames {
                coarse.push(bucket_peak);
                bucket_peak = 0.0;
                frames_in_bucket = 0;
            }
        }
    }
    if frames_in_bucket > 0 {
        coarse.push(bucket_peak);
    }
    if coarse.is_empty() {
        return Err("O áudio não contém amostras para gerar a waveform.".to_owned());
    }
    Ok(resample_peaks(&coarse, peak_count))
}

fn resample_peaks(source: &[f32], target_len: usize) -> Vec<f32> {
    (0..target_len)
        .map(|index| {
            let start = index * source.len() / target_len;
            let end = ((index + 1) * source.len())
                .div_ceil(target_len)
                .max(start + 1);
            source[start..end.min(source.len())]
                .iter()
                .copied()
                .fold(0.0_f32, f32::max)
                .clamp(0.025, 1.0)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn decodes_pcm_wav_into_bounded_peaks() {
        let path = std::env::temp_dir().join(format!("zyyk-waveform-{}.wav", uuid::Uuid::new_v4()));
        let samples: Vec<i16> = (0..8_000)
            .map(|index| (((index as f32 / 20.0).sin()) * i16::MAX as f32 * 0.5) as i16)
            .collect();
        let data_len = (samples.len() * 2) as u32;
        let mut file = File::create(&path).unwrap();
        file.write_all(b"RIFF").unwrap();
        file.write_all(&(36 + data_len).to_le_bytes()).unwrap();
        file.write_all(b"WAVEfmt ").unwrap();
        file.write_all(&16_u32.to_le_bytes()).unwrap();
        file.write_all(&1_u16.to_le_bytes()).unwrap();
        file.write_all(&1_u16.to_le_bytes()).unwrap();
        file.write_all(&8_000_u32.to_le_bytes()).unwrap();
        file.write_all(&16_000_u32.to_le_bytes()).unwrap();
        file.write_all(&2_u16.to_le_bytes()).unwrap();
        file.write_all(&16_u16.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&data_len.to_le_bytes()).unwrap();
        for sample in samples {
            file.write_all(&sample.to_le_bytes()).unwrap();
        }
        drop(file);

        let decoded_wav = decode_to_wav(&path).unwrap();
        assert_eq!(&decoded_wav[..4], b"RIFF");
        assert_eq!(&decoded_wav[8..12], b"WAVE");
        assert!(decoded_wav.len() > 44);

        let cancelled = decode_with_cancel(&path, 320, &|| true).unwrap_err();
        assert_eq!(cancelled, CANCELLED_ERROR);

        let peaks = decode(&path, 320).unwrap();
        assert_eq!(peaks.len(), 320);
        assert!(peaks.iter().all(|peak| (0.025..=1.0).contains(peak)));
        assert!(peaks.iter().any(|peak| *peak > 0.4));
        let _ = std::fs::remove_file(path);
    }
}
