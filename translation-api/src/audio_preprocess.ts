/** Light DSP before STT — helps voice notes and video audio tracks equally. */

export function removeDcOffset(samples: Float32Array): Float32Array {
  if (samples.length === 0) {
    return samples;
  }

  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i];
  }
  const mean = sum / samples.length;
  if (Math.abs(mean) < 1e-6) {
    return samples;
  }

  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] - mean;
  }
  return out;
}

export function normalizePeak(samples: Float32Array, targetPeak = 0.92): Float32Array {
  if (samples.length === 0) {
    return samples;
  }

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }

  if (peak < 1e-5) {
    return samples;
  }

  const gain = Math.min(targetPeak / peak, 8);
  if (Math.abs(gain - 1) < 0.02) {
    return samples;
  }

  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain;
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

export function preprocessForStt(samples: Float32Array): Float32Array {
  return normalizePeak(removeDcOffset(samples));
}
