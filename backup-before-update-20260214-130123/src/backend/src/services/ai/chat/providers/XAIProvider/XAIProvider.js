import { OpenAI } from 'openai';
import { Context } from '../../../../../util/context.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { XAI_MODELS } from './models.js';
export class XAIProvider {
    #openai;
    #meteringService;
    constructor (config, meteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.x.ai/v1',
        });
        this.#meteringService = meteringService;
    }
    getDefaultModel () {
        return 'grok-beta';
    }
    models () {
        return XAI_MODELS;
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
    async complete ({ messages, stream, model, tools }) {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed = availableModels.find(m => [m.id, ...(m.aliases || [])].includes(model)) || availableModels.find(m => m.id === this.getDefaultModel());
        messages = await OpenAIUtil.process_input_messages(messages);
        let completion;
        try {
            completion = await this.#openai.chat.completions.create({
                messages,
                model: modelUsed.id,
                ...(tools ? { tools } : {}),
                max_tokens: 1000,
                stream,
                ...(stream ? {
                    stream_options: { include_usage: true },
                } : {}),
            });
        }
        catch (e) {
            console.log('XAI AI process_input_messages error: ', e);
        }
        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverride = Object.fromEntries(Object.entries(trackedUsage).map(([key, value]) => {
                    return [key, value * (modelUsed.costs[key])];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `xai:${modelUsed.id}`, costsOverride);
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
//# sourceMappingURL=XAIProvider.js.map