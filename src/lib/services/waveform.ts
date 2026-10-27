export async function decodeWaveform(
  url: string,
  signal: AbortSignal,
  peakCount = 1_400,
): Promise<number[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / peakCount));
    const peaks: number[] = [];
    for (let index = 0; index < peakCount; index += 1) {
      const start = index * block;
      const end = Math.min(channel.length, start + block);
      let peak = 0;
      const stride = Math.max(1, Math.floor(block / 80));
      for (let sample = start; sample < end; sample += stride) {
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
      }
      peaks.push(Math.max(0.025, peak));
    }
    return peaks;
  } finally {
    await context.close();
  }
}
