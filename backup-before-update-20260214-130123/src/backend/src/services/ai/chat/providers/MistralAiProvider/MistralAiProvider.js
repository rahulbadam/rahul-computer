import { Mistral } from '@mistralai/mistralai';
import { Context } from '../../../../../util/context.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { MISTRAL_MODELS } from './models.js';
export class MistralAIProvider {
    #client;
    #meteringService;
    constructor (config, meteringService) {
        this.#client = new Mistral({
            apiKey: config.apiKey,
        });
        this.#meteringService = meteringService;
    }
    getDefaultModel () {
        return 'mistral-small-2506';
    }
    async models () {
        return MISTRAL_MODELS;
    }
    async list () {
        const models = await this.models();
        const ids = [];
        for ( const model of models ) {
            ids.push(model.id);
            if ( model.aliases ) {
                ids.push(...model.aliases);
            }
        }
        return ids;
    }
    async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
        messages = await OpenAIUtil.process_input_messages(messages);
        for ( const message of messages ) {
            if ( message.tool_calls ) {
                message.toolCalls = message.tool_calls;
                delete message.tool_calls;
            }
            if ( message.tool_call_id ) {
                message.toolCallId = message.tool_call_id;
                delete message.tool_call_id;
            }
        }
        const selectedModel = (await this.models()).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (await this.models()).find(m => m.id === this.getDefaultModel());
        const actor = Context.get('actor');
        const completion = await this.#client.chat[stream ? 'stream' : 'complete']({
            model: selectedModel.id,
            ...(tools ? { tools: tools } : {}),
            messages,
            maxTokens: max_tokens,
            temperature,
        });
        return await OpenAIUtil.handle_completion_output({
            deviations: {
                index_usage_from_stream_chunk: chunk => {
                    if ( ! chunk.usage )
                    {
                        return;
                    }
                    const snake_usage = {};
                    for ( const key in chunk.usage ) {
                        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
                        snake_usage[snakeKey] = chunk.usage[key];
                    }
                    return snake_usage;
                },
                chunk_but_like_actually: chunk => chunk.data,
                index_tool_calls_from_stream_choice: choice => choice.delta.toolCalls,
                coerce_completion_usage: (completion) => ({
                    prompt_tokens: completion.usage.promptTokens,
                    completion_tokens: completion.usage.completionTokens,
                }),
            },
            completion: completion,
            stream,
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (selectedModel.costs[k])];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `mistral:${selectedModel.id}`, costsOverrideFromModel);
                return trackedUsage;
            },
        });
    }
    checkModeration (_text) {
        throw new Error('Method not implemented.');
    }
}
//# sourceMappingURL=MistralAiProvider.js.map