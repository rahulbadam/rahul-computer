import Anthropic, { toFile } from '@anthropic-ai/sdk';
import mime from 'mime-types';
import FSNodeParam from '../../../../../api/filesystem/FSNodeParam.js';
import { LLRead } from '../../../../../filesystem/ll_operations/ll_read.js';
import { Context } from '../../../../../util/context.js';
import { make_claude_tools } from '../../../utils/FunctionCalling.js';
import { extract_and_remove_system_messages } from '../../../utils/Messages.js';
import { CLAUDE_MODELS } from './models.js';
export class ClaudeProvider {
    anthropic;
    #meteringService;
    errorService;
    constructor (meteringService, config, errorService) {
        this.#meteringService = meteringService;
        this.errorService = errorService;
        this.anthropic = new Anthropic({
            apiKey: config.apiKey,
            timeout: 10 * 60 * 1001,
        });
    }
    getDefaultModel () {
        return 'claude-haiku-4-5-20251001';
    }
    async list () {
        const models = this.models();
        const model_names = [];
        for ( const model of models ) {
            model_names.push(model.id);
            if ( model.aliases ) {
                model_names.push(...model.aliases);
            }
        }
        return model_names;
    }
    async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
        tools = make_claude_tools(tools);
        let system_prompts;
        [system_prompts, messages] = extract_and_remove_system_messages(messages);
        if ( system_prompts.length > 0 &&
            system_prompts[0].cache_control &&
            system_prompts[0]?.content ) {
            system_prompts[0].content = system_prompts[0].content.map((prompt) => {
                prompt.cache_control = system_prompts[0].cache_control;
                return prompt;
            });
        }
        messages = messages.map(message => {
            if ( message.cache_control ) {
                message.content[0].cache_control = message.cache_control;
            }
            delete message.cache_control;
            return message;
        });
        messages = messages.map(message => {
            if ( message.tool_calls && Array.isArray(message.tool_calls) ) {
                if ( ! Array.isArray(message.content) ) {
                    message.content = message.content ? [message.content] : [];
                }
                for ( const toolCall of message.tool_calls ) {
                    message.content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function?.name,
                        input: toolCall.function?.arguments ?? {},
                    });
                }
                delete message.tool_calls;
            }
            if ( message.role !== 'tool' )
            {
                return message;
            }
            const toolUseId = message.tool_call_id || message.tool_use_id;
            const contentValue = (() => {
                if ( Array.isArray(message.content) ) {
                    const toolResultBlock = message.content.find((part) => part?.type === 'tool_result');
                    if ( toolResultBlock ) {
                        return toolResultBlock.content ?? toolResultBlock.text ?? '';
                    }
                    return message.content.map((part) => {
                        if ( typeof part === 'string' )
                        {
                            return part;
                        }
                        if ( part && typeof part.text === 'string' )
                        {
                            return part.text;
                        }
                        if ( part && typeof part.content === 'string' )
                        {
                            return part.content;
                        }
                        return '';
                    }).join('');
                }
                if ( typeof message.content === 'string' )
                {
                    return message.content;
                }
                if ( message.content && typeof message.content.text === 'string' )
                {
                    return message.content.text;
                }
                if ( message.content && typeof message.content.content === 'string' )
                {
                    return message.content.content;
                }
                return '';
            })();
            return {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUseId,
                        content: contentValue,
                    },
                ],
            };
        });
        messages = messages.map(message => {
            if ( ! Array.isArray(message.content) )
            {
                return message;
            }
            message.content = message.content.map((part) => {
                if ( part?.type !== 'tool_use' )
                {
                    return part;
                }
                if ( typeof part.input === 'string' ) {
                    try {
                        part.input = JSON.parse(part.input);
                    }
                    catch {
                        part.input = {};
                    }
                }
                else if ( part.input === undefined || part.input === null ) {
                    part.input = {};
                }
                return part;
            });
            return message;
        });
        const modelUsed = this.models().find(m => [m.id, ...(m.aliases || [])].includes(model)) || this.models().find(m => m.id === this.getDefaultModel());
        const sdkParams = {
            model: modelUsed.id,
            max_tokens: Math.floor(max_tokens ||
                ((model === 'claude-3-5-sonnet-20241022'
                    || model === 'claude-3-5-sonnet-20240620') ? 8192 : this.models().filter(e => (e.name === model || e.aliases?.includes(model)))[0]?.max_tokens || 4096)),
            temperature: temperature || 0,
            ...((system_prompts && system_prompts[0]?.content) ? {
                system: system_prompts[0]?.content,
            } : {}),
            tool_choice: {
                type: 'auto',
                disable_parallel_tool_use: true,
            },
            messages,
            ...(tools ? { tools } : {}),
        };
        let beta_mode = false;
        const file_delete_tasks = [];
        const actor = Context.get('actor');
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
                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    actor: Context.get('actor'),
                    fsNode: task.node,
                });
                const mimeType = mime.contentType(await task.node.get('name'));
                beta_mode = true;
                const fileUpload = await this.anthropic.beta.files.upload({
                    file: await toFile(stream, undefined, { type: mimeType }),
                }, {
                    betas: ['files-api-2025-04-14'],
                });
                file_delete_tasks.push({ file_id: fileUpload.id });
                const contentBlockTypeForFileBasedOnMime = (() => {
                    if ( mimeType && mimeType.startsWith('image/') ) {
                        return 'image';
                    }
                    if ( mimeType && mimeType.startsWith('text/') ) {
                        return 'document';
                    }
                    if ( mimeType && mimeType === 'application/pdf' || mimeType === 'application/x-pdf' ) {
                        return 'document';
                    }
                    return 'container_upload';
                })();
                delete task.contentPart.puter_path;
                task.contentPart.type = contentBlockTypeForFileBasedOnMime;
                task.contentPart.source = {
                    type: 'file',
                    file_id: fileUpload.id,
                };
            })());
        }
        await Promise.all(promises);
        const cleanup_files = async () => {
            const promises = [];
            for ( const task of file_delete_tasks ) {
                promises.push((async () => {
                    try {
                        await this.anthropic.beta.files.delete(task.file_id, { betas: ['files-api-2025-04-14'] });
                    }
                    catch (e) {
                        this.errorService.report('claude:file-delete-task', {
                            source: e,
                            trace: true,
                            alarm: true,
                            extra: { file_id: task.file_id },
                        });
                    }
                })());
            }
            await Promise.all(promises);
        };
        if ( beta_mode ) {
            sdkParams.betas = ['files-api-2025-04-14'];
        }
        const anthropic = (beta_mode ? this.anthropic.beta : this.anthropic);
        if ( stream ) {
            const init_chat_stream = async ({ chatStream }) => {
                const completion = await anthropic.messages.stream(sdkParams);
                const usageSum = {};
                let message, contentBlock;
                for await ( const event of completion ) {
                    if ( event.type === 'message_delta' ) {
                        const usageObject = (event?.usage ?? {});
                        const meteredData = this.#usageFormatterUtil(usageObject);
                        for ( const key in meteredData ) {
                            if ( ! usageSum[key] )
                            {
                                usageSum[key] = 0;
                            }
                            usageSum[key] += meteredData[key];
                        }
                    }
                    if ( event.type === 'message_start' ) {
                        message = chatStream.message();
                        continue;
                    }
                    if ( event.type === 'message_stop' ) {
                        message.end();
                        message = null;
                        continue;
                    }
                    if ( event.type === 'content_block_start' ) {
                        if ( event.content_block.type === 'tool_use' ) {
                            contentBlock = message.contentBlock({
                                type: event.content_block.type,
                                id: event.content_block.id,
                                name: event.content_block.name,
                            });
                            continue;
                        }
                        contentBlock = message.contentBlock({
                            type: event.content_block.type,
                        });
                        continue;
                    }
                    if ( event.type === 'content_block_stop' ) {
                        contentBlock.end();
                        contentBlock = null;
                        continue;
                    }
                    if ( event.type === 'content_block_delta' ) {
                        if ( event.delta.type === 'input_json_delta' ) {
                            contentBlock.addPartialJSON(event.delta.partial_json);
                            continue;
                        }
                        if ( event.delta.type === 'text_delta' ) {
                            contentBlock.addText(event.delta.text);
                            continue;
                        }
                    }
                }
                chatStream.end(usageSum);
                const costsOverrideFromModel = Object.fromEntries(Object.entries(usageSum).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k])];
                }));
                this.#meteringService.utilRecordUsageObject(usageSum, actor, `claude:${modelUsed.id}`, costsOverrideFromModel);
            };
            return {
                init_chat_stream,
                stream: true,
                finally_fn: cleanup_files,
            };
        }
        let msg;
        try {
            msg = await anthropic.messages.create(sdkParams);
        }
        catch (e) {
            console.log('FUCK! anthropic error: ', e);
            throw e;
        }
        await cleanup_files();
        const usage = this.#usageFormatterUtil(msg.usage);
        const costsOverrideFromModel = Object.fromEntries(Object.entries(usage).map(([k, v]) => {
            return [k, v * (modelUsed.costs[k])];
        }));
        this.#meteringService.utilRecordUsageObject(usage, actor, `claude:${modelUsed.id}`, costsOverrideFromModel);
        return {
            message: msg,
            usage: usage,
            finish_reason: 'stop',
        };
    }
    #usageFormatterUtil (usage) {
        return {
            input_tokens: usage?.input_tokens || 0,
            ephemeral_5m_input_tokens: usage?.cache_creation?.ephemeral_5m_input_tokens || usage.cache_creation_input_tokens || 0,
            ephemeral_1h_input_tokens: usage?.cache_creation?.ephemeral_1h_input_tokens || 0,
            cache_read_input_tokens: usage?.cache_read_input_tokens || 0,
            output_tokens: usage?.output_tokens || 0,
        };
    }
    ;
    models () {
        return CLAUDE_MODELS;
    }
    checkModeration (_text) {
        throw new Error('CheckModeration Not provided.');
    }
}
//# sourceMappingURL=ClaudeProvider.js.map