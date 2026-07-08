import {

    TRANSLATION_ERROR,

    TRANSLATION_LOADING,

    TRANSLATION_SUCCESS,

    type TranslationRecord,

} from './reducer';



const PLUGIN_ID = 'com.transchecker.translation';

const API_BASE = `/plugins/${PLUGIN_ID}/api/v1`;



type TranslateHttpResult = {

    origin?: string;

    translated?: string;

    from?: string;

    to?: string;

    detected_from?: string;

    engine?: string;

    reversed?: string;

    score?: number;

    semantic_score?: number;

    embedding_score?: number;

    quality_score?: number;

};



function recordFromHttp(postId: string, result: TranslateHttpResult, cached: boolean, sameLanguage: boolean, auto: boolean): TranslationRecord {

    return {

        postId,

        origin: String(result.origin || ''),

        translated: String(result.translated || ''),

        from: String(result.from || ''),

        to: String(result.to || ''),

        detectedFrom: String(result.detected_from || ''),

        engine: String(result.engine || ''),

        reversed: String(result.reversed || ''),

        score: Number(result.score || 0),

        semanticScore: Number(result.semantic_score || 0),

        embeddingScore: Number(result.embedding_score || 0),

        qualityScore: Number(result.quality_score || 0),

        cached,

        sameLanguage,

        auto,

        loading: false,

    };

}



export async function requestPostTranslation(

    dispatch: (action: unknown) => void,

    postId: string,

    text: string,

    auto = true,

): Promise<void> {

    dispatch({type: TRANSLATION_LOADING, postId, auto});



    try {

        const response = await fetch(`${API_BASE}/translate`, {

            method: 'POST',

            credentials: 'same-origin',

            headers: {

                'Content-Type': 'application/json',

                'X-Requested-With': 'XMLHttpRequest',

            },

            body: JSON.stringify({

                post_id: postId,

                text,

            }),

        });



        if (!response.ok) {

            const body = await response.text();

            throw new Error(body || `Request failed (${response.status})`);

        }



        const data = await response.json() as {

            status?: string;

            cached?: boolean;

            same_language?: boolean;

            result?: TranslateHttpResult;

        };



        if (data.status === 'complete' && data.result) {

            dispatch({

                type: TRANSLATION_SUCCESS,

                record: recordFromHttp(

                    postId,

                    data.result,

                    Boolean(data.cached),

                    Boolean(data.same_language),

                    auto,

                ),

            });

        }

    } catch (error) {

        const message = error instanceof Error ? error.message : 'Translation request failed';

        dispatch({type: TRANSLATION_ERROR, postId, error: message});

    }

}



export function recordFromPayload(data: Record<string, string | number | boolean>): TranslationRecord {

    return {

        postId: String(data.post_id),

        origin: String(data.origin || ''),

        translated: String(data.translated || ''),

        from: String(data.from || ''),

        to: String(data.to || ''),

        detectedFrom: String(data.detected_from || ''),

        engine: String(data.engine || ''),

        reversed: String(data.reversed || ''),

        score: Number(data.score || 0),

        semanticScore: Number(data.semantic_score || 0),

        embeddingScore: Number(data.embedding_score || 0),

        qualityScore: Number(data.quality_score || 0),

        cached: Boolean(data.cached),

        sameLanguage: Boolean(data.same_language),

        auto: Boolean(data.auto),

        loading: false,

        languageUncertain: Boolean(data.language_uncertain),

    };

}

