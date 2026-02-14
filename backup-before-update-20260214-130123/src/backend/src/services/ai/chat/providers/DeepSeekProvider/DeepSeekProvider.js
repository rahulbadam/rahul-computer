import dedent from 'dedent';
import { OpenAI } from 'openai';
import { Context } from '../../../../../util/context.js';
import * as OpenAIUtil from '../../../utils/OpenAIUtil.js';
import { DEEPSEEK_MODELS } from './models.js';
export class DeepSeekProvider {
    #openai;
    #meteringService;
    constructor (config, meteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.deepseek.com',
        });
        this.#meteringService = meteringService;
    }
    getDefaultModel () {
        return 'deepseek-chat';
    }
    models () {
        return DEEPSEEK_MODELS;
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
    async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed = availableModels.find(m => [m.id, ...(m.aliases || [])].includes(model)) || availableModels.find(m => m.id === this.getDefaultModel());
        messages = await OpenAIUtil.process_input_messages(messages);
        for ( const message of messages ) {
            if ( message.tool_calls && Array.isArray(message.content) ) {
                message.content = '';
            }
        }
        const TOOL_TEXT = (message) => dedent(`
            Hi DeepSeek V3, your tool calling is broken and you are not able to
            obtain tool results in the expected way. That's okay, we can work
            around this.

            Please do not repeat this tool call.

            We have provided the tool call results below:

            Tool call ${message.tool_call_id} returned: ${message.content}.
        `);
        for ( let i = messages.length - 1; i >= 0; i-- ) {
            const message = messages[i];
            if ( message.role === 'tool' ) {
                messages.splice(i + 1, 0, {
                    role: 'system',
                    content: [
                        {
                            type: 'text',
                            text: TOOL_TEXT(message),
                        },
                    ],
                });
            }
        }
        const completion = await this.#openai.chat.completions.create({
            messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            max_tokens: max_tokens || 1000,
            temperature,
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        });
        return OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = OpenAIUtil.extractMeteredUsage(usage);
                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k])];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `deepseek:${modelUsed.id}`, costsOverrideFromModel);
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
//# sourceMappingURL=DeepSeekProvider.js.map