import { Together } from 'together-ai';
import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { TOGETHER_IMAGE_GENERATION_MODELS } from './models.js';
const TOGETHER_DEFAULT_RATIO = { w: 1024, h: 1024 };
const DEFAULT_MODEL = 'togetherai:black-forest-labs/FLUX.1-schnell';
const CONDITION_IMAGE_MODELS = [
    'togetherai:black-forest-labs/flux.1-kontext-dev',
    'togetherai:black-forest-labs/flux.1-kontext-pro',
    'togetherai:black-forest-labs/flux.1-kontext-max',
];
export class TogetherImageGenerationProvider {
    #client;
    #meteringService;
    #errors;
    #eventService;
    constructor (config, meteringService, errorService, eventService) {
        if ( ! config.apiKey ) {
            throw new Error('Together AI image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#errors = errorService;
        this.#eventService = eventService;
        this.#client = new Together({ apiKey: config.apiKey });
    }
    models () {
        return TOGETHER_IMAGE_GENERATION_MODELS;
    }
    getDefaultModel () {
        return DEFAULT_MODEL;
    }
    async generate (params) {
        const { prompt, test_mode } = params;
        let { model, ratio, quality } = params;
        const options = params;
        const selectedModel = this.#getModel(model);
        await this.#eventService.emit('ai.log.image', { actor: Context.get('actor'), parameters: params, completionId: '0', intended_service: selectedModel.id });
        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }
        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }
        ratio = ratio || TOGETHER_DEFAULT_RATIO;
        const actor = Context.get('actor');
        if ( ! actor ) {
            this.#errors.report('together-image-generation:unknown-actor', {
                message: 'failed to resolve actor for Together image generation',
                trace: true,
            });
            throw new Error('actor not found in context');
        }
        const priceKey = '1MP';
        const centsPerMP = selectedModel.costs[priceKey];
        if ( centsPerMP === undefined ) {
            throw new Error(`No pricing configured for model ${selectedModel.id}`);
        }
        const usageType = `${selectedModel.id}:${priceKey}`;
        let MP = (ratio.h * ratio.w) / 1_000_000;
        if ( quality ) {
            MP = parseInt(quality[0]);
        }
        const costInMicroCents = centsPerMP * MP * 1_000_000;
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, costInMicroCents);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }
        const request = this.#buildRequest(prompt, { ...options, ratio, model: selectedModel.id.replace('togetherai:', '') });
        try {
            const response = await this.#client.images.generate(request);
            if ( ! response?.data?.length ) {
                throw new Error('Together AI response did not include image data');
            }
            this.#meteringService.incrementUsage(actor, usageType, MP, costInMicroCents);
            const first = response.data[0];
            const url = first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined);
            if ( ! url ) {
                throw new Error('Together AI response did not include an image URL');
            }
            return url;
        }
        catch ( error ) {
            throw new Error(`Together AI image generation error: ${error.message}`);
        }
    }
    #getModel (model) {
        return this.models().find(m => m.id === model) || this.models().find(m => m.id === DEFAULT_MODEL);
    }
    #buildRequest (prompt, options) {
        const { ratio, model, steps, seed, negative_prompt, n, image_url, image_base64, mask_image_url, mask_image_base64, prompt_strength, disable_safety_checker, response_format, input_image } = options;
        const request = {
            prompt,
            model: model ?? DEFAULT_MODEL,
        };
        const requiresConditionImage = this.#modelRequiresConditionImage(request.model);
        const ratioWidth = ratio?.w !== undefined ? Number(ratio.w) : undefined;
        const ratioHeight = ratio?.h !== undefined ? Number(ratio.h) : undefined;
        const normalizedWidth = this.#normalizeDimension((ratioWidth ?? TOGETHER_DEFAULT_RATIO.w));
        const normalizedHeight = this.#normalizeDimension((ratioHeight ?? TOGETHER_DEFAULT_RATIO.h));
        if ( normalizedWidth )
        {
            request.width = normalizedWidth;
        }
        if ( normalizedHeight )
        {
            request.height = normalizedHeight;
        }
        if ( typeof steps === 'number' && Number.isFinite(steps) ) {
            request.steps = Math.max(1, Math.min(50, Math.round(steps)));
        }
        if ( typeof seed === 'number' && Number.isFinite(seed) )
        {
            request.seed = Math.round(seed);
        }
        if ( typeof negative_prompt === 'string' )
        {
            request.negative_prompt = negative_prompt;
        }
        if ( typeof n === 'number' && Number.isFinite(n) ) {
            request.n = Math.max(1, Math.min(4, Math.round(n)));
        }
        if ( disable_safety_checker ) {
            request.disable_safety_checker = true;
        }
        if ( typeof response_format === 'string' )
        {
            request.response_format = response_format;
        }
        const resolvedImageBase64 = typeof image_base64 === 'string'
            ? image_base64
            : (typeof input_image === 'string' ? input_image : undefined);
        if ( typeof image_url === 'string' )
        {
            request.image_url = image_url;
        }
        if ( resolvedImageBase64 )
        {
            request.image_base64 = resolvedImageBase64;
        }
        if ( typeof mask_image_url === 'string' )
        {
            request.mask_image_url = mask_image_url;
        }
        if ( typeof mask_image_base64 === 'string' )
        {
            request.mask_image_base64 = mask_image_base64;
        }
        if ( typeof prompt_strength === 'number' && Number.isFinite(prompt_strength) ) {
            request.prompt_strength = Math.max(0, Math.min(1, prompt_strength));
        }
        if ( requiresConditionImage ) {
            const conditionSource = resolvedImageBase64
                ? resolvedImageBase64
                : (typeof image_url === 'string' ? image_url : undefined);
            if ( ! conditionSource ) {
                throw new Error(`Model ${request.model} requires an image_url or image_base64 input`);
            }
            request.condition_image = conditionSource;
        }
        return request;
    }
    #normalizeDimension (value) {
        if ( typeof value !== 'number' || Number.isNaN(value) )
        {
            return undefined;
        }
        const rounded = Math.max(64, Math.round(value));
        return Math.max(64, Math.round(rounded / 8) * 8);
    }
    #modelRequiresConditionImage (modelId) {
        if ( typeof modelId !== 'string' || modelId.trim() === '' ) {
            return false;
        }
        const normalized = modelId.toLowerCase();
        return CONDITION_IMAGE_MODELS.some(required => normalized === required);
    }
}
//# sourceMappingURL=TogetherImageGenerationProvider.js.map