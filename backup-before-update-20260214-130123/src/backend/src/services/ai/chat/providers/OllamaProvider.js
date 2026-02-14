import axios from 'axios';
import { default as openai } from 'openai';
import { Context } from '../../../../util/context.js';
import { kv } from '../../../../util/kvSingleton.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
export class OllamaChatProvider {
    #apiBaseUrl;
    #openai;
    #meteringService;
    constructor (config, meteringService) {
        this.#apiBaseUrl = config?.api_base_url || 'http://localhost:11434';
        this.#openai = new openai.OpenAI({
            apiKey: 'ollama',
            baseURL: `${config?.api_base_url}/v1`,
        });
        this.#meteringService = meteringService;
    }
    async models () {
        let models = kv.get('ollamaChat:models');
        if ( ! models ) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: `${this.#apiBaseUrl}/api/tags`,
                });
                models = resp.data.models || [];
                if ( models.length > 0 ) {
                    kv.set('ollamaChat:models', models);
                }
            }
            catch ( error ) {
                console.error('Failed to fetch models from Ollama:', error.message);
                return [];
            }
        }
        if ( !models || models.length === 0 ) {
            return [];
        }
        const coerced_models = [];
        for ( const model of models ) {
            const modelName = model.name || model.model || 'unknown';
            coerced_models.push({
                id: `ollama:ollama/${modelName}`,
                name: `${modelName} (Ollama)`,
                max_tokens: model.size || model.max_context || 8192,
                costs_currency: 'usd-cents',
                costs: {
                    tokens: 1_000_000,
                    input_token: 0,
                    output_token: 0,
                },
            });
        }
        return coerced_models;
    }
    async list () {
        const models = await this.models();
        const model_names = [];
        for ( const model of models ) {
            model_names.push(model.id);
        }
        return model_names;
    }
    async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
        if ( model.startsWith('ollama:') ) {
            model = model.slice('ollama:'.length);
        }
        const actor = Context.get('actor');
        messages = await OpenAIUtil.process_input_messages(messages);
        const completion = await this.#openai.chat.completions.create({
            messages,
            model: model ?? this.getDefaultModel(),
            ...(tools ? { tools } : {}),
            max_tokens,
            temperature: temperature,
            stream: !!stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        });
        const modelDetails = (await this.models()).find(m => m.id === `ollama:${model}`);
        const modelIdForMetering = modelDetails?.id ?? (model ? (model.startsWith('ollama/') ? `ollama:${model}` : `ollama:ollama/${model}`) : undefined);
        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt: (usage.prompt_tokens ?? 1) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion: usage.completion_tokens ?? 1,
                    input_cache_read: usage.prompt_tokens_details?.cached_tokens ?? 0,
                };
                const costOverwrites = Object.fromEntries(Object.keys(trackedUsage).map((k) => {
                    return [k, 0];
                }));
                if ( modelIdForMetering ) {
                    this.#meteringService.utilRecordUsageObject(trackedUsage, actor, modelIdForMetering, costOverwrites);
                }
                return trackedUsage;
            },
            stream,
            completion,
        });
    }
    checkModeration (_text) {
        throw new Error('Method not implemented.');
    }
    getDefaultModel () {
        return 'gpt-oss:20b';
    }
}
//# sourceMappingURL=OllamaProvider.js.map