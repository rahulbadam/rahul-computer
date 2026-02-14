import axios from 'axios';
import { OpenAI } from 'openai';
import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { kv } from '../../../../../util/kvSingleton.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { OPEN_ROUTER_MODEL_OVERRIDES } from './modelOverrides.js';
export class OpenRouterProvider {
    #meteringService;
    #openai;
    #apiBaseUrl = 'https://openrouter.ai/api/v1';
    constructor (config, meteringService) {
        this.#apiBaseUrl = config.apiBaseUrl || 'https://openrouter.ai/api/v1';
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: this.#apiBaseUrl,
        });
        this.#meteringService = meteringService;
    }
    getDefaultModel () {
        return 'openrouter:openai/gpt-5-nano';
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
        const modelUsed = (await this.models()).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (await this.models()).find(m => m.id === this.getDefaultModel());
        const modelIdForParams = modelUsed.id.startsWith('openrouter:') ? modelUsed.id.slice('openrouter:'.length) : modelUsed.id;
        if ( model === 'openrouter/auto' ) {
            throw APIError.create('field_invalid', undefined, {
                key: 'model',
                expected: 'allowed model',
                got: 'disallowed model',
            });
        }
        const actor = Context.get('actor');
        messages = await OpenAIUtil.process_input_messages(messages);
        const completionParams = {
            messages,
            model: modelIdForParams,
            ...(tools ? { tools } : {}),
            max_tokens,
            temperature: temperature,
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
            usage: { include: true },
        };
        let completion;
        try {
            completion = await this.#openai.chat.completions.create(completionParams);
        }
        catch (e) {
            const err = e;
            if ( err && err.error && err.error.message && err.error.message.startsWith("This endpoint's maximum context length is ") ) {
                delete completionParams.max_tokens;
                completion = await this.#openai.chat.completions.create(completionParams);
            }
            else {
                console.log('Openarouter error: ', err.error.message);
                throw e;
            }
        }
        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt: (usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion: usage.completion_tokens ?? 0,
                    input_cache_read: usage.prompt_tokens_details?.cached_tokens ?? 0,
                    request: usage.request || 1,
                };
                const costOverwrites = Object.fromEntries(Object.keys(trackedUsage).map((k) => {
                    return ([k, (modelUsed.costs[k]) * trackedUsage[k]]);
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, modelUsed.id, costOverwrites);
                return trackedUsage;
            },
            stream,
            completion,
        });
    }
    async models () {
        let models = kv.get('openrouterChat:models');
        if ( ! models ) {
            try {
                const resp = await axios.request({
                    method: 'GET',
                    url: `${this.#apiBaseUrl}/models`,
                });
                models = resp.data.data;
                kv.set('openrouterChat:models', models);
            }
            catch (e) {
                console.log(e);
            }
        }
        const coerced_models = [];
        for ( const model of models ) {
            if ( model.id.includes('openrouter/auto') ) {
                continue;
            }
            const overridenModel = OPEN_ROUTER_MODEL_OVERRIDES.find(m => m.id === `openrouter:${model.id}`);
            const microcentCosts = Object.fromEntries(Object.entries(model.pricing).map(([k, v]) => [k, Math.round((v < 0 ? 1 : v) * 1_000_000 * 100)]));
            if ( ! microcentCosts.request ) {
                microcentCosts.request = 0;
            }
            coerced_models.push({
                id: `openrouter:${model.id}`,
                name: `${model.name} (OpenRouter)`,
                aliases: [model.id, model.name, `openrouter/${model.id}`, model.id.split('/').slice(1).join('/')],
                max_tokens: model.top_provider.max_completion_tokens,
                costs_currency: 'usd-cents',
                input_cost_key: 'prompt',
                output_cost_key: 'completion',
                costs: {
                    tokens: 1_000_000,
                    ...microcentCosts,
                },
                ...overridenModel,
            });
        }
        return coerced_models;
    }
    checkModeration (_text) {
        throw new Error('Method not implemented.');
    }
}
//# sourceMappingURL=OpenRouterProvider.js.map