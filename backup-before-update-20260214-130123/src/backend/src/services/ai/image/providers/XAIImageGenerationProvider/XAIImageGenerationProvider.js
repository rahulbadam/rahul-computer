import { OpenAI } from 'openai';
import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { XAI_IMAGE_GENERATION_MODELS } from './models.js';
const DEFAULT_MODEL = 'grok-2-image';
const PRICE_KEY = 'output';
export class XAIImageGenerationProvider {
    #client;
    #meteringService;
    #errors;
    constructor (config, meteringService, errorService) {
        if ( ! config.apiKey ) {
            throw new Error('xAI image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#errors = errorService;
        this.#client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.x.ai/v1',
        });
    }
    models () {
        return XAI_IMAGE_GENERATION_MODELS;
    }
    getDefaultModel () {
        return DEFAULT_MODEL;
    }
    async generate (params) {
        const { prompt, test_mode } = params;
        let { model } = params;
        const selectedModel = this.#getModel(model);
        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }
        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }
        const actor = Context.get('actor');
        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.#errors.report('xai-image-generation:unknown-user', {
                message: 'failed to get a user ID for an xAI request',
                alarm: true,
                trace: true,
            });
        }
        const priceInCents = selectedModel.costs[PRICE_KEY];
        const costInMicroCents = priceInCents * 1_000_000;
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, costInMicroCents);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }
        const response = await this.#client.images.generate({
            model: selectedModel.id,
            prompt,
            user: user_private_uid,
        });
        const first = response.data?.[0];
        const url = first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined);
        if ( ! url ) {
            throw new Error('Failed to extract image URL from xAI response');
        }
        this.#meteringService.incrementUsage(actor, `xai:${selectedModel.id}:${PRICE_KEY}`, 1, costInMicroCents);
        return url;
    }
    #getModel (model) {
        const models = this.models();
        const found = models.find(m => m.id === model || m.aliases?.includes(model ?? ''));
        return found || models.find(m => m.id === DEFAULT_MODEL);
    }
}
//# sourceMappingURL=XAIImageGenerationProvider.js.map