import mime from 'mime-types';
import { OpenAI } from 'openai';
import { FSNodeParam } from '../../../../../api/filesystem/FSNodeParam.js';
import { LLRead } from '../../../../../filesystem/ll_operations/ll_read.js';
import { Context } from '../../../../../util/context.js';
import { stream_to_buffer } from '../../../../../util/streamutil.js';
import * as OpenAiUtil from '../../../utils/OpenAIUtil.js';
import { OPEN_AI_MODELS } from './models.js';
;
const MAX_FILE_SIZE = 5 * 1_000_000;
export class OpenAiResponsesChatProvider {
    #openAi;
    #defaultModel = 'gpt-5-nano';
    #meteringService;
    constructor (meteringService, config) {
        this.#meteringService = meteringService;
        let apiKey = config.apiKey;
        if ( ! apiKey ) {
            apiKey = config?.secret_key;
            console.warn('The `openai.secret_key` configuration format is deprecated. ' +
                'Please use `services.openai.apiKey` instead.');
        }
        if ( ! apiKey ) {
            throw new Error('OpenAI API key is missing in configuration.');
        }
        this.#openAi = new OpenAI({
            apiKey: apiKey,
        });
    }
    models (extra_params) {
        if ( extra_params?.no_restrictions ) {
            return OPEN_AI_MODELS;
        }
        return OPEN_AI_MODELS.filter(e => e.responses_api_only === true);
    }
    list () {
        const models = this.models({ no_restrictions: false });
        const modelNames = [];
        for ( const model of models ) {
            modelNames.push(model.id);
            if ( model.aliases ) {
                modelNames.push(...model.aliases);
            }
        }
        return modelNames;
    }
    getDefaultModel () {
        return this.#defaultModel;
    }
    async complete ({ messages, model, max_tokens, moderation, tools, verbosity, stream, reasoning, reasoning_effort, temperature, text }) {
        if ( ! Array.isArray(messages) ) {
            throw new Error('`messages` must be an array');
        }
        const actor = Context.get('actor');
        model = model ?? this.#defaultModel;
        const modelUsed = (this.models({ no_restrictions: true })).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (this.models(({ no_restrictions: true })).find(m => m.id === this.getDefaultModel()));
        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            console.error(new Error('chat-completion-service:unknown-user - failed to get a user ID for an OpenAI request'));
        }
        const { user } = actor.type;
        const file_input_tasks = [];
        for ( const message of messages ) {
            for ( const contentPart of message.content ) {
                if ( ! contentPart.puter_path )
                {
                    continue;
                }
                file_input_tasks.push({
                    node: await (new FSNodeParam(contentPart.puter_path)).consolidate({
                        req: { user },
                        getParam: () => contentPart.puter_path,
                    }),
                    contentPart,
                });
            }
        }
        const promises = [];
        for ( const task of file_input_tasks ) {
            promises.push((async () => {
                if ( await task.node.get('size') > MAX_FILE_SIZE ) {
                    delete task.contentPart.puter_path;
                    task.contentPart.type = 'text';
                    task.contentPart.text = `{error: input file exceeded maximum of ${MAX_FILE_SIZE} bytes; ` +
                        'the user did not write this message}';
                    return;
                }
                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    actor: Context.get('actor'),
                    fsNode: task.node,
                });
                const mimeType = mime.contentType(await task.node.get('name'));
                const buffer = await stream_to_buffer(stream);
                const base64 = buffer.toString('base64');
                delete task.contentPart.puter_path;
                if ( mimeType && mimeType.startsWith('image/') ) {
                    task.contentPart.type = 'image_url';
                    task.contentPart.image_url = {
                        url: `data:${mimeType};base64,${base64}`,
                    };
                }
                else if ( mimeType && mimeType.startsWith('audio/') ) {
                    task.contentPart.type = 'input_audio';
                    task.contentPart.input_audio = {
                        data: `data:${mimeType};base64,${base64}`,
                        format: mimeType.split('/')[1],
                    };
                }
                else {
                    task.contentPart.type = 'text';
                    task.contentPart.text = '{error: input file has unsupported MIME type; ' +
                        'the user did not write this message}';
                }
            })());
        }
        await Promise.all(promises);
        if ( tools ) {
            tools = tools.map((e) => {
                if ( e.type === 'function' ) {
                    const tool = e.function;
                    tool.type = 'function';
                    return tool;
                }
                else {
                    return e;
                }
            });
        }
        messages = await OpenAiUtil.process_input_messages_responses_api(messages);
        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const supportsReasoningControls = typeof model === 'string' && model.startsWith('gpt-5');
        const completionParams = {
            user: user_private_uid,
            safety_identifier: user_private_uid,
            input: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_output_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream: !!stream,
            ...(supportsReasoningControls ? {} :
                {
                    ...(requestedReasoningEffort ? { reasoning_effort: requestedReasoningEffort } : {}),
                    ...(requestedVerbosity ? { verbosity: requestedVerbosity } : {}),
                }),
        };
        const completion = await this.#openAi.responses.create(completionParams);
        return OpenAiUtil.handle_completion_output_responses_api({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens: (usage.input_tokens ?? 0) - (usage.input_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: usage.output_tokens ?? 0,
                    cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0,
                };
                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k])];
                }));
                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `openai:${modelUsed?.id}`, costsOverrideFromModel);
                return trackedUsage;
            },
            stream,
            completion,
            moderate: moderation ? this.checkModeration.bind(this) : undefined,
        });
    }
    async checkModeration (text) {
        const results = await this.#openAi.moderations.create({
            model: 'omni-moderation-latest',
            input: text,
        });
        let flagged = false;
        for ( const result of results?.results ?? [] ) {
            const veryFlaggedEntries = Object.entries(result.category_scores).filter(e => e[1] > 0.8);
            if ( veryFlaggedEntries.length > 0 ) {
                flagged = true;
                break;
            }
        }
        return {
            flagged,
            results,
        };
    }
}
//# sourceMappingURL=OpenAiChatResponsesProvider.js.map