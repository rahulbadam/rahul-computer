import { APIError } from '../../../api/APIError.js';
import { Context } from '../../../util/context.js';
import BaseService from '../../BaseService.js';
import { TypedValue } from '../../drivers/meta/Runtime.js';
import { CloudflareImageGenerationProvider } from './providers/CloudflareImageGenerationProvider/CloudflareImageGenerationProvider.js';
import { GeminiImageGenerationProvider } from './providers/GeminiImageGenerationProvider/GeminiImageGenerationProvider.js';
import { OpenAiImageGenerationProvider } from './providers/OpenAiImageGenerationProvider/OpenAiImageGenerationProvider.js';
import { TogetherImageGenerationProvider } from './providers/TogetherImageGenerationProvider/TogetherImageGenerationProvider.js';
import { XAIImageGenerationProvider } from './providers/XAIImageGenerationProvider/XAIImageGenerationProvider.js';
export class AIImageGenerationService extends BaseService {
    static SERVICE_NAME = 'ai-image';
    static DEFAULT_PROVIDER = 'openai-image-generation';
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
                return iface === 'puter-image-generation' &&
                    method_name === 'generate';
            },
        },
        ['puter-image-generation']: {
            async generate (...parameters) {
                return this.generate(...parameters);
            },
        },
    };
    getModel ({ modelId, provider }) {
        const models = this.#modelIdMap[modelId];
        if ( ! models ) {
            return undefined;
        }
        if ( ! provider ) {
            return models[0];
        }
        const model = models.find(m => m.provider === provider);
        return model ?? models[0];
    }
    async registerProviders () {
        const openAiConfig = this.config.providers?.['openai-image-generation'] || this.global_config?.services?.['openai'] || this.global_config?.openai;
        if ( openAiConfig && (openAiConfig.apiKey || openAiConfig.secret_key) ) {
            this.#providers['openai-image-generation'] = new OpenAiImageGenerationProvider({ apiKey: openAiConfig.apiKey || openAiConfig.secret_key }, this.meteringService, this.errorService);
        }
        const geminiConfig = this.config.providers?.['gemini-image-generation'] || this.global_config?.services?.gemini;
        if ( geminiConfig && (geminiConfig.apiKey || geminiConfig.secret_key) ) {
            this.#providers['gemini-image-generation'] = new GeminiImageGenerationProvider({ apiKey: geminiConfig.apiKey || geminiConfig.secret_key }, this.meteringService, this.errorService);
        }
        const togetherConfig = this.config.providers?.['together-image-generation'] || this.global_config?.services?.['together-ai'];
        if ( togetherConfig && (togetherConfig.apiKey || togetherConfig.secret_key) ) {
            this.#providers['together-image-generation'] = new TogetherImageGenerationProvider({ apiKey: togetherConfig.apiKey || togetherConfig.secret_key }, this.meteringService, this.errorService, this.eventService);
        }
        const xaiConfig = this.config.providers?.['xai-image-generation'] || this.config.providers?.['xai'] || this.global_config?.services?.['xai'];
        if ( xaiConfig && (xaiConfig.apiKey || xaiConfig.secret_key) ) {
            this.#providers['xai-image-generation'] = new XAIImageGenerationProvider({ apiKey: xaiConfig.apiKey || xaiConfig.secret_key }, this.meteringService, this.errorService);
        }
        const cloudflareImageConfig = this.config.providers?.['cloudflare-image-generation'] ||
            this.config.providers?.['cloudflare-workers-ai-image'] ||
            this.global_config?.services?.['cloudflare-image-generation'] ||
            this.global_config?.services?.['cloudflare-workers-ai-image'] ||
            this.global_config?.services?.['cloudflare-workers-ai'];
        if ( cloudflareImageConfig && (cloudflareImageConfig.apiToken || cloudflareImageConfig.apiKey || cloudflareImageConfig.secret_key) && (cloudflareImageConfig.accountId || cloudflareImageConfig.account_id) ) {
            this.#providers['cloudflare-image-generation'] = new CloudflareImageGenerationProvider({
                apiToken: cloudflareImageConfig.apiToken || cloudflareImageConfig.apiKey || cloudflareImageConfig.secret_key,
                accountId: cloudflareImageConfig.accountId || cloudflareImageConfig.account_id,
                apiBaseUrl: cloudflareImageConfig.apiBaseUrl,
            }, this.meteringService, this.errorService, this.eventService);
        }
        const extensionProviders = {};
        await this.eventService.emit('ai.image.registerProviders', extensionProviders);
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
            this.driverService.register_service_alias(AIImageGenerationService.SERVICE_NAME, providerName, { iface: 'puter-image-generation' });
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
                this.#modelIdMap[model.id].sort((a, b) => a.costs[a.index_cost_key || Object.keys(a.costs)[0]] - b.costs[b.index_cost_key || Object.keys(b.costs)[0]]);
            }
        }
    }
    models () {
        const seen = new Set();
        return Object.entries(this.#modelIdMap)
            .map(([_, models]) => models)
            .flat()
            .filter(model => {
                const identity = `${model.provider}:${model.puterId || model.id}`;
                if ( seen.has(identity) ) {
                    return false;
                }
            seen.add(identity);
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
    async generate (parameters) {
        const clientDriverCall = Context.get('client_driver_call');
        let { test_mode: testMode, intended_service: legacyProviderName } = clientDriverCall;
        const configuredProviders = Object.keys(this.#providers);
        if ( configuredProviders.length === 0 ) {
            throw new Error('no image generation providers configured');
        }
        let intendedProvider = (parameters.provider || (legacyProviderName === AIImageGenerationService.SERVICE_NAME ? '' : legacyProviderName)) ?? '';
        if ( intendedProvider === 'xai' ) {
            intendedProvider = 'xai-image-generation';
        }
        if ( !parameters.model && !intendedProvider ) {
            intendedProvider = configuredProviders.includes(AIImageGenerationService.DEFAULT_PROVIDER)
                ? AIImageGenerationService.DEFAULT_PROVIDER
                : configuredProviders[0];
        }
        if ( intendedProvider && !this.#providers[intendedProvider] ) {
            intendedProvider = configuredProviders[0];
        }
        if ( !parameters.model && intendedProvider ) {
            parameters.model = this.#providers[intendedProvider].getDefaultModel();
        }
        const model = parameters.model ? this.getModel({ modelId: parameters.model, provider: intendedProvider }) : undefined;
        if ( ! model ) {
            const availableModelsUrl = `${this.global_config.origin}/puterai/image/models`;
            throw APIError.create('field_invalid', undefined, {
                key: 'model',
                expected: `a valid model name from ${availableModelsUrl}`,
                got: model,
            });
        }
        const provider = this.#providers[model.provider];
        if ( ! provider ) {
            throw new Error(`no provider found for model ${model.id}`);
        }
        if ( model.allowedRatios?.length ) {
            if ( parameters.ratio ) {
                const isValidRatio = model.allowedRatios.some(r => r.w === parameters.ratio.w && r.h === parameters.ratio.h);
                if ( ! isValidRatio ) {
                    parameters.ratio = model.allowedRatios[0];
                }
            }
            else {
                parameters.ratio = model.allowedRatios[0];
            }
        }
        if ( ! parameters.ratio ) {
            parameters.ratio = { w: 1024, h: 1024 };
        }
        if ( model.allowedQualityLevels?.length ) {
            if ( parameters.quality ) {
                if ( ! model.allowedQualityLevels.includes(parameters.quality) ) {
                    parameters.quality = model.allowedQualityLevels[0];
                }
            }
            else {
                parameters.quality = model.allowedQualityLevels[0];
            }
        }
        const url = await provider.generate({
            ...parameters,
            model: model.id,
            provider: model.provider,
            test_mode: testMode,
        });
        const isDataUrl = url.startsWith('data:');
        const image = new TypedValue({
            $: isDataUrl ? 'string:url:data' : 'string:url:web',
            content_type: 'image',
        }, url);
        return image;
    }
}
//# sourceMappingURL=AIImageGenerationService.js.map