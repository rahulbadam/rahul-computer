import { createId as cuid2 } from '@paralleldrive/cuid2';
import { PassThrough } from 'stream';
import { APIError } from '../../../api/APIError.js';
import { redisClient } from '../../../clients/redis/redisSingleton.js';
import { Context } from '../../../util/context.js';
import BaseService from '../../BaseService.js';
import { TypedValue } from '../../drivers/meta/Runtime.js';
import { AsModeration } from '../moderation/AsModeration.js';
import { normalize_tools_object } from '../utils/FunctionCalling.js';
import { extract_text, normalize_messages, normalize_single_message } from '../utils/Messages.js';
import Streaming from '../utils/Streaming.js';
import { ClaudeProvider } from './providers/ClaudeProvider/ClaudeProvider.js';
import { DeepSeekProvider } from './providers/DeepSeekProvider/DeepSeekProvider.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import { GeminiChatProvider } from './providers/GeminiProvider/GeminiChatProvider.js';
import { GroqAIProvider } from './providers/GroqAiProvider/GroqAIProvider.js';
import { MistralAIProvider } from './providers/MistralAiProvider/MistralAiProvider.js';
import { OllamaChatProvider } from './providers/OllamaProvider.js';
import { OpenAiChatProvider } from './providers/OpenAiProvider/OpenAiChatCompletionsProvider.js';
import { OpenAiResponsesChatProvider } from './providers/OpenAiProvider/OpenAiChatResponsesProvider.js';
import { OpenRouterProvider } from './providers/OpenRouterProvider/OpenRouterProvider.js';
import { TogetherAIProvider } from './providers/TogetherAiProvider/TogetherAIProvider.js';
import { XAIProvider } from './providers/XAIProvider/XAIProvider.js';
const MAX_FALLBACKS = 3 + 1;
export class AIChatService extends BaseService {
    static SERVICE_NAME = 'ai-chat';
    static DEFAULT_PROVIDER = 'openai-completion';
    get meteringService () {
        return this.services.get('meteringService').meteringService;
    }
    get db () {
        return this.services.get('database').get();
    }
    get errorService () {
        return this.services.get('error-service');
    }
    get eventService () {
        return this.services.get('event');
    }
    get driverService () {
        return this.services.get('driver');
    }
    getProvider (name) {
        return this.#providers[name];
    }
    #providers = {};
    #modelIdMap = {};
    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-chat-completion' &&
                    method_name === 'complete';
            },
        },
        ['puter-chat-completion']: {
            async models () {
                return await this.models();
            },
            async list () {
                return await this.list();
            },
            async complete (...parameters) {
                return await this.complete(...parameters);
            },
        },
    };
    getModel ({ modelId, provider }) {
        const models = this.#modelIdMap[modelId];
        if ( ! models ) {
            throw new Error('Model not found, please try one of the following models listed here: https://developer.puter.com/ai/models/');
        }
        if ( ! provider ) {
            return models[0];
        }
        const model = models.find(m => m.provider === provider);
        return model ?? models[0];
    }
    async registerProviders () {
        const claudeConfig = this.config.providers?.['claude'] || this.global_config?.services?.['claude'];
        if ( claudeConfig && claudeConfig.apiKey ) {
            this.#providers['claude'] = new ClaudeProvider(this.meteringService, claudeConfig, this.errorService);
        }
        const openAiConfig = this.config.providers?.['openai-completion'] || this.global_config?.services?.['openai-completion'] || this.global_config?.openai;
        if ( openAiConfig && (openAiConfig.apiKey || openAiConfig.secret_key) ) {
            this.#providers['openai-completion'] = new OpenAiChatProvider(this.meteringService, openAiConfig);
            this.#providers['openai-responses'] = new OpenAiResponsesChatProvider(this.meteringService, openAiConfig);
        }
        const geminiConfig = this.config.providers?.['gemini'] || this.global_config?.services?.['gemini'];
        if ( geminiConfig && geminiConfig.apiKey ) {
            this.#providers['gemini'] = new GeminiChatProvider(this.meteringService, geminiConfig);
        }
        const groqConfig = this.config.providers?.['groq'] || this.global_config?.services?.['groq'];
        if ( groqConfig && groqConfig.apiKey ) {
            this.#providers['groq'] = new GroqAIProvider(groqConfig, this.meteringService);
        }
        const deepSeekConfig = this.config.providers?.['deepseek'] || this.global_config?.services?.['deepseek'];
        if ( deepSeekConfig && deepSeekConfig.apiKey ) {
            this.#providers['deepseek'] = new DeepSeekProvider(deepSeekConfig, this.meteringService);
        }
        const mistralConfig = this.config.providers?.['mistral'] || this.global_config?.services?.['mistral'];
        if ( mistralConfig && mistralConfig.apiKey ) {
            this.#providers['mistral'] = new MistralAIProvider(mistralConfig, this.meteringService);
        }
        const xaiConfig = this.config.providers?.['xai'] || this.global_config?.services?.['xai'];
        if ( xaiConfig && xaiConfig.apiKey ) {
            this.#providers['xai'] = new XAIProvider(xaiConfig, this.meteringService);
        }
        const openrouterConfig = this.config.providers?.['openrouter'] || this.global_config?.services?.['openrouter'];
        if ( openrouterConfig && openrouterConfig.apiKey ) {
            this.#providers['openrouter'] = new OpenRouterProvider(openrouterConfig, this.meteringService);
        }
        const togetherConfig = this.config.providers?.['together-ai'] || this.global_config?.services?.['together-ai'];
        if ( togetherConfig && togetherConfig.apiKey ) {
            this.#providers['together-ai'] = new TogetherAIProvider(togetherConfig, this.meteringService);
        }
        const ollamaConfig = this.config.providers?.['ollama'] || this.global_config?.services?.ollama;
        const ollama_available = await fetch('http://localhost:11434/api/tags').then(resp => resp.json()).then(_data => {
            if ( ollamaConfig?.enabled === undefined ) {
                return true;
            }
            return ollamaConfig?.enabled;
        }).catch(_err => {
            return false;
        });
        if ( ollama_available || ollamaConfig?.enabled ) {
            console.log('🦙 Ollama support detected! Enabling local AI support');
            this.#providers['ollama'] = new OllamaChatProvider(ollamaConfig, this.meteringService);
        }
        this.#providers['fake-chat'] = new FakeChatProvider();
        const extensionProviders = {};
        await this.eventService.emit('ai.chat.registerProviders', extensionProviders);
        for ( const providerName in extensionProviders ) {
            if ( this.#providers[providerName] ) {
                console.warn('AIChatService: provider name conflict for ', providerName, ' registering with -extension suffix');
                this.#providers[`${providerName}-extension`] = extensionProviders[providerName];
                continue;
            }
            this.#providers[providerName] = extensionProviders[providerName];
        }
    }
    async '__on_boot.consolidation' () {
        await this.registerProviders();
        for ( const providerName in this.#providers ) {
            const provider = this.#providers[providerName];
            this.driverService.register_service_alias(AIChatService.SERVICE_NAME, providerName, { iface: 'puter-chat-completion' });
            for ( const model of await provider.models() ) {
                model.id = model.id.trim().toLowerCase();
                if ( ! this.#modelIdMap[model.id] ) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({ ...model, provider: providerName });
                if ( model.puterId ) {
                    if ( model.aliases ) {
                        model.aliases.push(model.puterId);
                    }
                    else {
                        model.aliases = [model.puterId];
                    }
                }
                let exists = false;
                if ( model.aliases ) {
                    for ( let alias of model.aliases ) {
                        if ( this.#modelIdMap[alias] && this.#modelIdMap[alias] !== this.#modelIdMap[model.id] ) {
                            if ( providerName === 'together-ai' || providerName === 'openrouter' ) {
                                if ( this.#modelIdMap[alias].find(m => m.provider === 'gemini') ) {
                                    continue;
                                }
                                delete this.#modelIdMap[model.id];
                                exists = true;
                                break;
                            }
                        }
                    }
                }
                if ( exists ) {
                    continue;
                }
                if ( model.aliases ) {
                    for ( let alias of model.aliases ) {
                        alias = alias.trim().toLowerCase();
                        if ( ! this.#modelIdMap[alias] ) {
                            this.#modelIdMap[alias] = this.#modelIdMap[model.id];
                            continue;
                        }
                        if ( this.#modelIdMap[alias] !== this.#modelIdMap[model.id] ) {
                            this.#modelIdMap[alias].push({ ...model, provider: providerName });
                            this.#modelIdMap[model.id] = this.#modelIdMap[alias];
                            continue;
                        }
                    }
                }
                this.#modelIdMap[model.id].sort((a, b) => {
                    if ( a.provider === 'together-ai' && b.provider !== 'together-ai' ) {
                        return 1;
                    }
                    if ( b.provider === 'together-ai' && a.provider !== 'together-ai' ) {
                        return -1;
                    }
                    if ( a.costs[a.input_cost_key || 'input_tokens'] === b.costs[b.input_cost_key || 'input_tokens'] ) {
                        return a.id.length - b.id.length;
                    }
                    return a.costs[a.input_cost_key || 'input_tokens'] - b.costs[b.input_cost_key || 'input_tokens'];
                });
            }
        }
    }
    models () {
        const seen = new Set();
        return Object.entries(this.#modelIdMap)
            .map(([_, models]) => models)
            .flat()
            .filter(model => {
                if ( seen.has(model.id) ) {
                    return false;
                }
            seen.add(model.id);
            return true;
            })
            .sort((a, b) => {
                if ( a.provider === b.provider ) {
                    return a.id.localeCompare(b.id);
                }
                return a.provider.localeCompare(b.provider);
            });
    }
    list () {
        return this.models().map(m => (m.puterId || m.id)).sort();
    }
    async complete (parameters) {
        const clientDriverCall = Context.get('client_driver_call');
        const fallbackDriverCall = {
            test_mode: false,
            response_metadata: {},
            intended_service: undefined,
        };
        let { test_mode: testMode, response_metadata: resMetadata, intended_service: legacyProviderName } = clientDriverCall ?? fallbackDriverCall;
        resMetadata = (resMetadata ?? {});
        const actor = Context.get('actor');
        let intendedProvider = parameters.provider || (legacyProviderName === AIChatService.SERVICE_NAME ? '' : legacyProviderName);
        if ( !parameters.model && !intendedProvider ) {
            intendedProvider = AIChatService.DEFAULT_PROVIDER;
        }
        if ( !parameters.model && intendedProvider ) {
            parameters.model = this.#providers[intendedProvider].getDefaultModel();
        }
        let model = this.getModel({ modelId: parameters.model, provider: intendedProvider }) || await this.getFallbackModel(parameters.model, [], []);
        const abuseModel = this.getModel({ modelId: 'abuse' });
        const completionId = cuid2();
        const event = {
            actor,
            completionId,
            allow: true,
            intended_service: intendedProvider || '',
            parameters,
        };
        const user = actor.type.user;
        if ( user.requires_email_confirmation && !user.email_confirmed ) {
            throw APIError.create('email_must_be_confirmed', null, {
                action: 'use this service',
            });
        }
        await this.eventService.emit('ai.prompt.validate', event);
        if ( ! event.allow ) {
            testMode = true;
            if ( event.custom )
            {
                parameters.custom = event.custom;
            }
        }
        if ( parameters.messages ) {
            parameters.messages =
                normalize_messages(parameters.messages);
        }
        const should_moderate = !testMode &&
            parameters.provider !== 'ollama';
        if ( should_moderate && !await this.moderate(parameters) ) {
            testMode = true;
            throw APIError.create('moderation_failed');
        }
        if ( !testMode && should_moderate ) {
            Context.set('moderated', true);
        }
        if ( testMode ) {
            if ( event.abuse ) {
                model = abuseModel;
            }
        }
        if ( parameters.tools ) {
            normalize_tools_object(parameters.tools);
        }
        if ( ! model ) {
            const availableModelsUrl = `${this.global_config.origin}/puterai/chat/models`;
            throw APIError.create('field_invalid', undefined, {
                key: 'model',
                expected: `a valid model name from ${availableModelsUrl}`,
                got: model,
            });
        }
        const inputTokenCost = model.costs[model.input_cost_key || 'input_tokens'];
        const outputTokenCost = model.costs[model.output_cost_key || 'output_tokens'];
        const maxTokens = model.max_tokens;
        const text = extract_text(parameters.messages);
        const approximateTokenCount = Math.floor(((text.length / 4) + (text.split(/\s+/).length * (4 / 3))) / 2);
        const approximateInputCost = approximateTokenCount * inputTokenCost;
        const minimumCredits = model.minimumCredits || 0;
        const usageAllowed = await this.meteringService.hasEnoughCredits(actor, Math.max(approximateInputCost, minimumCredits));
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds', new Error('No usage left for request.'), {
                delegate: 'usage-limited-chat',
                message: 'No usage left for request.',
            });
        }
        if ( model.subscriberOnly ) {
            const eventObject = { actor, userSubscriptionId: '' };
            await this.eventService.emit('metering:getUserSubscription', eventObject);
            if ( ! eventObject.userSubscriptionId ) {
                throw APIError.create('permission_denied', undefined, {
                    message: `The model ${model.id} is only available to subscribers. Please subscribe to access this model.`,
                });
            }
        }
        const availableCredits = await this.meteringService.getRemainingUsage(actor);
        const maxAllowedOutput = availableCredits - approximateInputCost;
        const maxAllowedOutputTokens = maxAllowedOutput / outputTokenCost;
        if ( maxAllowedOutputTokens ) {
            parameters.max_tokens = Math.floor(Math.min(parameters.max_tokens ?? Number.POSITIVE_INFINITY, maxAllowedOutputTokens, maxTokens - approximateTokenCount));
            if ( parameters.max_tokens < 1 ) {
                parameters.max_tokens = undefined;
            }
        }
        let res;
        const provider = this.#providers[model.provider];
        if ( ! provider ) {
            throw new Error(`no provider found for model ${model.id}`);
        }
        try {
            res = await provider.complete({
                ...parameters,
                model: model.id,
                provider: model.provider,
            });
        }
        catch (e) {
            const tried = [];
            const triedProviders = [];
            tried.push(model.id);
            triedProviders.push(model.provider);
            let error = e;
            while ( error ) {
                const isRequestError = (() => {
                    if ( error instanceof APIError ) {
                        return true;
                    }
                    if ( error.type === 'invalid_request_error' ) {
                        return true;
                    }
                })();
                if ( isRequestError ) {
                    console.error(error);
                    throw APIError.create('error_400_from_delegate', error, {
                        delegate: model.provider,
                        message: error.message,
                    });
                }
                if ( this.config.disable_fallback_mechanisms ) {
                    console.error(error);
                    throw error;
                }
                console.error('error calling ai chat provider for model: ', model, '\n trying fallbacks...');
                if ( model.provider === 'fake-chat' ) {
                    break;
                }
                const fallback = await this.getFallbackModel(model.id, tried, triedProviders);
                if ( ! fallback ) {
                    throw new Error('no fallback model available');
                }
                const { fallbackModelId, fallbackProvider } = fallback;
                console.warn('model fallback', {
                    fallbackModelId,
                    fallbackProvider,
                });
                let fallBackModel = this.getModel({ modelId: fallbackModelId, provider: fallbackProvider });
                tried.push(fallbackModelId);
                triedProviders.push(fallbackProvider);
                if ( tried.length > MAX_FALLBACKS ) {
                    console.error('max fallbacks reached', { tried, triedProviders });
                    break;
                }
                const fallbackUsageAllowed = await this.meteringService.hasEnoughCredits(actor, 1);
                if ( ! fallbackUsageAllowed ) {
                    throw APIError.create('insufficient_funds', new Error('No usage left for request.'), {
                        delegate: 'usage-limited-chat',
                        message: 'No usage left for request.',
                    });
                }
                const provider = this.#providers[fallBackModel.provider];
                if ( ! provider ) {
                    throw new Error(`no provider found for model ${fallBackModel.id}`);
                }
                try {
                    res = await provider.complete({
                        ...parameters,
                        model: fallBackModel.id,
                        provider: fallBackModel.provider,
                    });
                    model = fallBackModel;
                    break;
                }
                catch (e) {
                    console.error('error during fallback selection: ', e);
                    error = e;
                }
            }
        }
        resMetadata.service_used = model.provider;
        resMetadata.providerUsed = model.id;
        const username = actor.type?.user?.username;
        if ( ! res ) {
            throw new Error('No response from AI chat provider');
        }
        res.via_ai_chat_service = true;
        if ( res.stream ) {
            if ( res.init_chat_stream ) {
                const stream = new PassThrough();
                const retval = new TypedValue({
                    $: 'stream',
                    content_type: 'application/x-ndjson',
                    chunked: true,
                }, stream);
                const chatStream = new Streaming.AIChatStream({
                    stream,
                });
                (async () => {
                    try {
                        await res.init_chat_stream({ chatStream });
                    }
                    catch (e) {
                        this.errors.report('error during stream response', {
                            source: e,
                        });
                        stream.write(`${JSON.stringify({
                            type: 'error',
                            message: e.message,
                        })}\n`);
                        stream.end();
                    }
                    finally {
                        if ( res.finally_fn ) {
                            await res.finally_fn();
                        }
                    }
                })();
                return retval;
            }
            return res;
        }
        await this.eventService.emit('ai.prompt.complete', {
            username,
            intended_service: intendedProvider,
            parameters,
            result: res,
            model_used: model.id,
            service_used: model.provider,
        });
        if ( parameters.response?.normalize ) {
            res = {
                ...res,
                message: normalize_single_message(res.message),
                normalized: true,
            };
        }
        return res;
    }
    async moderate ({ messages }) {
        if ( process.env.TEST_MODERATION_FAILURE )
        {
            return false;
        }
        const fulltext = extract_text(messages);
        let mod_last_error;
        let mod_result;
        try {
            const openaiProvider = this.#providers['openai-completion'];
            mod_result = await openaiProvider.checkModeration(fulltext);
            if ( mod_result.flagged )
            {
                return false;
            }
            return true;
        }
        catch (e) {
            console.error(e);
            mod_last_error = e;
        }
        try {
            const claudeChatProvider = this.#providers['claude'];
            const mod = new AsModeration({
                chatProvider: claudeChatProvider,
                model: 'claude-3-haiku-20240307',
            });
            if ( ! await mod.moderate(fulltext) ) {
                return false;
            }
            mod_last_error = null;
            return true;
        }
        catch (e) {
            console.error(e);
            mod_last_error = e;
        }
        if ( mod_last_error ) {
            this.log.error('moderation error', {
                fulltext,
                mod_last_error,
            });
            throw new Error('no working moderation service');
        }
        return true;
    }
    async getFallbackModel (modelId, triedIds, triedProviders) {
        const models = this.#modelIdMap[modelId];
        if ( ! models ) {
            this.log.error('could not find model', { modelId });
            throw new Error('could not find model');
        }
        const targetModel = models[0];
        for ( const model of models ) {
            if ( triedProviders.includes(model.provider) )
            {
                continue;
            }
            if ( model.provider === 'fake-chat' )
            {
                continue;
            }
            return {
                fallbackProvider: model.provider,
                fallbackModelId: model.id,
            };
        }
        let potentialFallbacks;
        const cached_fallbacks = await redisClient.get(`aichat:fallbacks:${targetModel.id}`);
        if ( cached_fallbacks ) {
            try {
                potentialFallbacks = JSON.parse(cached_fallbacks);
            }
            catch (e) {
            }
        }
        if ( ! potentialFallbacks ) {
            const models = this.models();
            let aiProvider, modelToSearch;
            if ( targetModel.id.startsWith('openrouter:') || targetModel.id.startsWith('togetherai:') ) {
                [aiProvider, modelToSearch] = targetModel.id.replace('openrouter:', '').replace('togetherai:', '').toLowerCase().split('/');
            }
            else {
                [aiProvider, modelToSearch] = [targetModel.provider.toLowerCase().replace('gemini', 'google').replace('openai-completion', 'openai').replace('openai-responses', 'openai'), targetModel.id.toLowerCase()];
            }
            const potentialMatches = models.filter(model => {
                const possibleModelNames = [`openrouter:${aiProvider}/${modelToSearch}`,
                    `togetherai:${aiProvider}/${modelToSearch}`, ...(targetModel.aliases?.map((alias) => [`openrouter:${aiProvider}/${alias}`,
                        `togetherai:${aiProvider}/${alias}`])?.flat() ?? [])];
                return !!possibleModelNames.find(possibleName => model.id.toLowerCase() === possibleName);
            }).slice(0, MAX_FALLBACKS);
            await redisClient.set(`aichat:fallbacks:${modelId}`, JSON.stringify(potentialMatches));
            potentialFallbacks = potentialMatches;
        }
        for ( const model of potentialFallbacks ) {
            if ( triedIds.includes(model.id) )
            {
                continue;
            }
            if ( model.provider === 'fake-chat' )
            {
                continue;
            }
            return {
                fallbackProvider: model.provider,
                fallbackModelId: model.id,
            };
        }
        console.error('no fallbacks', {
            potentialFallbacks,
            triedIds,
            triedProviders,
        });
    }
}
//# sourceMappingURL=AIChatService.js.map