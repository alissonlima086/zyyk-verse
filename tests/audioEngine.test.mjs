import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWaveformPeaks } from '../src/lib/services/audioEngine.ts';

test('extrai uma waveform compacta dos canais do buffer já decodificado', () => {
  const left = new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  const right = new Float32Array([0, -0.8, 0, 0, 0, 0, -1, 0]);
  const buffer = {
    duration: 1,
    length: left.length,
    numberOfChannels: 2,
    getChannelData: (channel) => channel === 0 ? left : right,
  };

  assert.deepEqual(
    extractWaveformPeaks(buffer, 4, 16).map((peak) => Number(peak.toFixed(3))),
    [0.8, 0.3, 0.5, 1],
  );
});

test('mantém piso visual para trechos silenciosos', () => {
  const silent = new Float32Array(100);
  const peaks = extractWaveformPeaks({
    duration: 1,
    length: silent.length,
    numberOfChannels: 1,
    getChannelData: () => silent,
  }, 5);

  assert.deepEqual(peaks, [0.025, 0.025, 0.025, 0.025, 0.025]);
});
