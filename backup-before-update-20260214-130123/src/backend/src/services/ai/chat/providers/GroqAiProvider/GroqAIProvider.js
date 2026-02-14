import Groq from 'groq-sdk';
import { Context } from '../../../../../util/context.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { GROQ_MODELS } from './models.js';
export class GroqAIProvider {
    #client;
    #meteringService;
    constructor (config, meteringService) {
        this.#client = new Groq({
            apiKey: config.apiKey,
        });
        this.#meteringService = meteringService;
    }
    getDefaultModel () {
        return 'llama-3.1-8b-instant';
    }
    models () {
        return GROQ_MODELS;
    }
    async list () {
        const models = this.models();
        const modelNames = [];
        for ( const model of models ) {
            modelNames.push(model.id);
            if ( model.aliases ) {
                modelNames.push(...model.aliases);
            }
        }
        return modelNames;
    }
    async complete ({ messages, model, stream, tools, max_tokens, temperature }) {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed = availableModels.find(m => [m.id, ...(m.aliases || [])].includes(model)) || availableModels.find(m => m.id === this.getDefaultModel());
        messages = await OpenAIUtil.process_input_messages(messages);
        for ( const message of messages ) {
            if ( message.tool_calls && Array.isArray(message.content) ) {
                message.content = '';
            }
        }
        const completion = await this.#client.chat.completions.create({
            messages,
            model: modelUsed.id,
            stream,
            tools,
            max_completion_tokens: max_tokens,
            temperature,
        });
        return OpenAIUtil.handle_completion_output({
            deviations: {
                index_usage_from_stream_chunk: chunk => chunk.x_groq?.usage,
            },
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverride = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k])];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `groq:${modelUsed.id}`, costsOverride);
                return trackedUsage;
            },
            stream,
            completion,
        });
    }
    checkModeration (_text) {
        throw new Error('Method not implemented.');
    }
}
//# sourceMappingURL=GroqAIProvider.js.map