export const MAX_MEDIA_DURATION_MS = 5 * 60 * 1000;
export const WARN_MEDIA_DURATION_MS = (4 * 60 + 30) * 1000;
export const MIN_MEDIA_DURATION_MS = 2000;

export function formatRecordingDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function isRecordingNearLimit(elapsedMs: number): boolean {
    return elapsedMs >= WARN_MEDIA_DURATION_MS && elapsedMs < MAX_MEDIA_DURATION_MS;
}

export function isRecordingAtLimit(elapsedMs: number): boolean {
    return elapsedMs >= MAX_MEDIA_DURATION_MS;
}

export function isRecordingTooShort(elapsedMs: number): boolean {
    return elapsedMs > 0 && elapsedMs < MIN_MEDIA_DURATION_MS;
}
