export type MediaTranslationStage = 'transcribing' | 'detecting' | 'translating';

export function mediaProgressLabel(stage?: string): string {
    switch (stage) {
    case 'transcribing':
        return 'Transcribing audio…';
    case 'detecting':
        return 'Detecting language…';
    case 'translating':
        return 'Translating…';
    default:
        return 'Transcribing and translating…';
    }
}
