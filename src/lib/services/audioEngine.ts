export interface DecodedAudioBuffer {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export function extractWaveformPeaks(
  buffer: DecodedAudioBuffer,
  peakCount = 1_400,
  samplesPerPeak = 256,
): number[] {
  const count = Math.max(1, Math.min(5_000, Math.round(peakCount)));
  const sampleBudget = Math.max(16, Math.round(samplesPerPeak));
  const channels = Array.from(
    { length: Math.max(1, buffer.numberOfChannels) },
    (_, channel) => buffer.getChannelData(channel),
  );
  const peaks = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * buffer.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * buffer.length / count));
    const stride = Math.max(1, Math.floor((end - start) / sampleBudget));
    let peak = 0;
    for (let sample = start; sample < end; sample += stride) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
    }
    peaks[index] = Math.max(0.025, Math.min(1, peak));
  }
  return peaks;
}

class VerseAudioEngine {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private offsetSeconds = 0;
  private startedAt = 0;
  private operation = 0;
  private ended: (() => void) | null = null;

  private getContext(): AudioContext {
    if (!this.context) {
      const AudioContextClass = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio API indisponível.');
      this.context = new AudioContextClass();
    }
    return this.context;
  }

  async load(
    url: string,
    signal?: AbortSignal,
    fallback?: () => Promise<ArrayBuffer>,
  ): Promise<AudioBuffer> {
    const operation = ++this.operation;
    this.stopVoice();
    this.buffer = null;
    this.offsetSeconds = 0;
    let decoded: AudioBuffer;
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Falha ao carregar o áudio: HTTP ${response.status}`);
      const encoded = await response.arrayBuffer();
      if (signal?.aborted || operation !== this.operation) throw new DOMException('Operação cancelada.', 'AbortError');
      decoded = await this.getContext().decodeAudioData(encoded);
    } catch (error) {
      if (signal?.aborted || operation !== this.operation || !fallback) throw error;
      const wav = await fallback();
      if (signal?.aborted || operation !== this.operation) throw new DOMException('Operação cancelada.', 'AbortError');
      decoded = await this.getContext().decodeAudioData(wav);
    }
    if (signal?.aborted || operation !== this.operation) throw new DOMException('Operação cancelada.', 'AbortError');
    this.buffer = decoded;
    return decoded;
  }

  async play(offsetSeconds = this.offsetSeconds, onEnded?: () => void): Promise<boolean> {
    if (!this.buffer) return false;
    const operation = ++this.operation;
    const context = this.getContext();
    if (context.state === 'suspended') await context.resume();
    if (operation !== this.operation || !this.buffer) return false;
    this.startVoice(offsetSeconds, onEnded);
    return true;
  }

  pause(): number {
    const position = this.currentTime();
    this.operation += 1;
    this.stopVoice();
    this.offsetSeconds = position;
    return position;
  }

  seek(seconds: number): number {
    const shouldResume = this.isPlaying();
    const onEnded = this.ended ?? undefined;
    this.operation += 1;
    this.stopVoice();
    this.offsetSeconds = this.clamp(seconds);
    if (shouldResume && this.offsetSeconds < this.duration) this.startVoice(this.offsetSeconds, onEnded);
    return this.offsetSeconds;
  }

  clear(): void {
    this.operation += 1;
    this.stopVoice();
    this.buffer = null;
    this.offsetSeconds = 0;
  }

  currentTime(): number {
    if (!this.source || !this.context) return this.clamp(this.offsetSeconds);
    return this.clamp(this.offsetSeconds + (this.context.currentTime - this.startedAt));
  }

  isLoaded(): boolean {
    return this.buffer !== null;
  }

  isPlaying(): boolean {
    return this.source !== null;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  waveform(peakCount = 1_400): number[] {
    return this.buffer ? extractWaveformPeaks(this.buffer, peakCount) : [];
  }

  private startVoice(offsetSeconds: number, onEnded?: () => void): void {
    const buffer = this.buffer;
    if (!buffer) return;
    this.stopVoice();
    const context = this.getContext();
    const offset = this.clamp(offsetSeconds);
    if (offset >= buffer.duration) {
      this.offsetSeconds = buffer.duration;
      return;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);
    this.source = source;
    this.gain = gain;
    this.offsetSeconds = offset;
    this.startedAt = context.currentTime;
    this.ended = onEnded ?? null;
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect();
      gain.disconnect();
      this.source = null;
      this.gain = null;
      this.offsetSeconds = buffer.duration;
      const ended = this.ended;
      this.ended = null;
      ended?.();
    };
    source.start(0, Math.min(offset, Math.max(0, buffer.duration - 0.001)));
  }

  private stopVoice(): void {
    const source = this.source;
    this.source = null;
    this.ended = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* a voz já terminou */ }
      source.disconnect();
    }
    this.gain?.disconnect();
    this.gain = null;
  }

  private clamp(seconds: number): number {
    const finite = Number.isFinite(seconds) ? seconds : 0;
    return Math.max(0, Math.min(this.duration || Math.max(0, finite), finite));
  }
}

export const audioEngine = new VerseAudioEngine();
