export type DiffToken = {
    text: string;
    kind: 'same' | 'removed' | 'added';
};

const MAX_LCS_CELLS = 2_000_000;
const CHUNK_WORDS = 280;

function equalsToken(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

function diffTokenLists(left: string[], right: string[]): DiffToken[] {
    const rows = left.length + 1;
    const cols = right.length + 1;
    const lcs: number[][] = Array.from({length: rows}, () => Array(cols).fill(0));

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            if (equalsToken(left[i - 1], right[j - 1])) {
                lcs[i][j] = lcs[i - 1][j - 1] + 1;
            } else {
                lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
            }
        }
    }

    const tokens: DiffToken[] = [];
    let i = left.length;
    let j = right.length;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && equalsToken(left[i - 1], right[j - 1])) {
            tokens.unshift({text: left[i - 1], kind: 'same'});
            i--;
            j--;
        } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
            tokens.unshift({text: right[j - 1], kind: 'added'});
            j--;
        } else {
            tokens.unshift({text: left[i - 1], kind: 'removed'});
            i--;
        }
    }

    return tokens;
}

function diffWordsChunked(left: string[], right: string[]): DiffToken[] {
    const tokens: DiffToken[] = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < left.length || rightIndex < right.length) {
        const leftRemaining = left.length - leftIndex;
        const rightRemaining = right.length - rightIndex;
        const leftChunkSize = Math.min(CHUNK_WORDS, leftRemaining || CHUNK_WORDS);
        const rightChunkSize = leftRemaining > 0
            ? Math.min(
                Math.max(1, Math.round(leftChunkSize * rightRemaining / leftRemaining)),
                rightRemaining || CHUNK_WORDS,
            )
            : Math.min(CHUNK_WORDS, rightRemaining);

        const leftChunk = left.slice(leftIndex, leftIndex + leftChunkSize);
        const rightChunk = right.slice(rightIndex, rightIndex + rightChunkSize);
        tokens.push(...diffTokenLists(leftChunk, rightChunk));

        leftIndex += leftChunkSize;
        rightIndex += rightChunkSize;
    }

    return tokens;
}

/** Word-level diff for original vs back-translated text (TransChecker-style). */
export function diffWords(original: string, reversed: string): DiffToken[] {
    const left = original.trim().split(/\s+/).filter(Boolean);
    const right = reversed.trim().split(/\s+/).filter(Boolean);

    if (left.length === 0 && right.length === 0) {
        return [];
    }
    if (left.length === 0) {
        return right.map((text) => ({text, kind: 'added' as const}));
    }
    if (right.length === 0) {
        return left.map((text) => ({text, kind: 'removed' as const}));
    }

    if (left.length * right.length > MAX_LCS_CELLS) {
        return diffWordsChunked(left, right);
    }

    return diffTokenLists(left, right);
}
