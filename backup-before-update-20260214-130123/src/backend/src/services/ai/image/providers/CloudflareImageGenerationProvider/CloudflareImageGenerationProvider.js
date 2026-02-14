import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { CLOUDFLARE_IMAGE_GENERATION_MODELS } from './models.js';
;
const DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const DEFAULT_RATIO = { w: 1024, h: 1024 };
export class CloudflareImageGenerationProvider {
    #apiToken;
    #accountId;
    #apiBaseUrl;
    #meteringService;
    #errors;
    #eventService;
    constructor (config, meteringService, errorService, eventService) {
        const apiToken = config.apiToken || config.apiKey || config.secret_key;
        if ( ! apiToken ) {
            throw new Error('Cloudflare image generation requires `apiToken` (or `apiKey`)');
        }
        const accountId = config.accountId || config.account_id;
        if ( ! accountId ) {
            throw new Error('Cloudflare image generation requires `accountId`');
        }
        this.#apiToken = apiToken;
        this.#accountId = accountId;
        this.#apiBaseUrl = config.apiBaseUrl || 'https://api.cloudflare.com/client/v4';
        this.#meteringService = meteringService;
        this.#errors = errorService;
        this.#eventService = eventService;
    }
    models () {
        return CLOUDFLARE_IMAGE_GENERATION_MODELS;
    }
    getDefaultModel () {
        return DEFAULT_MODEL;
    }
    async generate (params) {
        const options = params;
        const { prompt, test_mode } = options;
        const ratio = this.#normalizeRatio(options.ratio);
        const selectedModel = this.#getModel(options.model);
        await this.#eventService.emit('ai.log.image', {
            actor: Context.get('actor'),
            parameters: params,
            completionId: '0',
            intended_service: selectedModel.id,
        });
        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }
        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }
        const actor = Context.get('actor');
        if ( ! actor ) {
            this.#errors.report('cloudflare-image-generation:unknown-actor', {
                message: 'failed to resolve actor for Cloudflare image generation',
                trace: true,
            });
            throw new Error('actor not found in context');
        }
        const steps = this.#resolveSteps(selectedModel, options);
        const costComponents = this.#estimateCost(selectedModel, ratio, steps, {
            hasInputImage: typeof options.image === 'string' && options.image.trim() !== '',
        });
        const totalCostInMicroCents = costComponents.reduce((acc, component) => acc + component.totalCostMicroCents, 0);
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, totalCostInMicroCents);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }
        const response = await this.#runModel(selectedModel, {
            ...options,
            ratio,
            steps,
        });
        this.#meteringService.batchIncrementUsages(actor, costComponents
            .filter(component => component.usageAmount > 0 && component.totalCostMicroCents > 0)
            .map(component => ({
                usageType: `cloudflare:${this.#getMeteringModelKey(selectedModel)}:${component.key}`,
                usageAmount: component.usageAmount,
                costOverride: component.totalCostMicroCents,
            })));
        return response;
    }
    #getModel (model) {
        const models = CLOUDFLARE_IMAGE_GENERATION_MODELS;
        const found = models.find(m => m.id === model || m.aliases?.includes(model ?? ''));
        return found || models.find(m => m.id === DEFAULT_MODEL);
    }
    #normalizeRatio (ratio) {
        const width = Number(ratio?.w);
        const height = Number(ratio?.h);
        if ( Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ) {
            return { w: Math.max(64, Math.round(width)), h: Math.max(64, Math.round(height)) };
        }
        return { ...DEFAULT_RATIO };
    }
    #resolveSteps (model, options) {
        const input = Number(options.steps ?? options.num_steps ?? model.defaultSteps ?? 25);
        const fallback = model.defaultSteps ?? 25;
        if ( ! Number.isFinite(input) )
        {
            return fallback;
        }
        return Math.max(1, Math.min(50, Math.round(input)));
    }
    #estimateCost (model, ratio, steps, options) {
        const tiles = this.#tileCount(ratio);
        const pixels = ratio.w * ratio.h;
        const megapixels = this.#megapixels(ratio);
        switch ( model.billingScheme ) {
        case 'tile-plus-step':
            return [
                {
                    key: 'tile_512',
                    usageAmount: tiles,
                    totalCostMicroCents: this.#costForUnits(tiles, model.costs.tile_512),
                },
                {
                    key: 'step',
                    usageAmount: steps,
                    totalCostMicroCents: this.#costForUnits(steps, model.costs.step),
                },
            ];
        case 'step-only':
            return [
                {
                    key: 'step',
                    usageAmount: steps,
                    totalCostMicroCents: this.#costForUnits(steps, model.costs.step),
                },
            ];
        case 'flux2-dev-tile-step':
            return [
                {
                    key: 'input_tile_512_per_step',
                    usageAmount: tiles * steps,
                    totalCostMicroCents: this.#costForUnits(tiles * steps, model.costs.input_tile_512_per_step),
                },
                {
                    key: 'output_tile_512_per_step',
                    usageAmount: tiles * steps,
                    totalCostMicroCents: this.#costForUnits(tiles * steps, model.costs.output_tile_512_per_step),
                },
            ];
        case 'flux2-klein-4b-tile':
            return [
                {
                    key: 'input_tile_512',
                    usageAmount: tiles,
                    totalCostMicroCents: this.#costForUnits(tiles, model.costs.input_tile_512),
                },
                {
                    key: 'output_tile_512',
                    usageAmount: tiles,
                    totalCostMicroCents: this.#costForUnits(tiles, model.costs.output_tile_512),
                },
            ];
        case 'flux2-klein-9b-mp': {
            const firstMP = Math.min(megapixels, 1);
            const subsequentMP = Math.max(0, megapixels - firstMP);
            const firstPixels = Math.min(pixels, 1_000_000);
            const subsequentPixels = Math.max(0, pixels - firstPixels);
            const inputImageMP = options?.hasInputImage ? megapixels : 0;
            return [
                {
                    key: 'first_mp',
                    usageAmount: firstMP,
                    totalCostMicroCents: this.#costForMillionUnits(firstPixels, model.costs.first_mp),
                },
                {
                    key: 'subsequent_mp',
                    usageAmount: subsequentMP,
                    totalCostMicroCents: this.#costForMillionUnits(subsequentPixels, model.costs.subsequent_mp),
                },
                {
                    key: 'input_image_mp',
                    usageAmount: inputImageMP,
                    totalCostMicroCents: options?.hasInputImage
                        ? this.#costForMillionUnits(pixels, model.costs.input_image_mp)
                        : 0,
                },
            ];
        }
        default:
            return [];
        }
    }
    async #runModel (model, params) {
        const endpoint = `${this.#apiBaseUrl}/accounts/${this.#accountId}/ai/run/${model.id}`;
        const headers = {
            Authorization: `Bearer ${this.#apiToken}`,
        };
        let body;
        if ( model.requiresMultipart ) {
            const formData = new FormData();
            formData.append('prompt', params.prompt);
            formData.append('width', String(params.ratio.w));
            formData.append('height', String(params.ratio.h));
            formData.append('steps', String(params.steps));
            if ( Number.isFinite(params.seed) )
            {
formData.append('seed', String(Math.round(params.seed)));
            }
            if ( Number.isFinite(params.guidance) )
            {
formData.append('guidance', String(params.guidance));
            }
            if ( typeof params.negative_prompt === 'string' )
            {
formData.append('negative_prompt', params.negative_prompt);
            }
            if ( typeof params.output_format === 'string' )
            {
formData.append('output_format', params.output_format);
            }
            if ( typeof params.image === 'string' )
            {
formData.append('image', params.image);
            }
            body = formData;
        }
        else {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify({
                prompt: params.prompt,
                width: params.ratio.w,
                height: params.ratio.h,
                steps: params.steps,
                num_steps: params.steps,
                ...(Number.isFinite(params.seed) ? { seed: Math.round(params.seed) } : {}),
                ...(Number.isFinite(params.guidance) ? { guidance: params.guidance } : {}),
                ...(typeof params.negative_prompt === 'string' ? { negative_prompt: params.negative_prompt } : {}),
                ...(typeof params.output_format === 'string' ? { output_format: params.output_format } : {}),
            });
        }
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body,
        });
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if ( contentType.startsWith('image/') ) {
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            return `data:${contentType};base64,${imageBuffer.toString('base64')}`;
        }
        const text = await response.text();
        let payload;
        try {
            payload = text ? JSON.parse(text) : {};
        }
        catch {
            payload = { raw: text };
        }
        if ( ! response.ok ) {
            const message = this.#extractErrorMessage(payload) ||
                `Cloudflare image generation failed with status ${response.status}`;
            throw new Error(message);
        }
        if ( typeof payload === 'object' && payload !== null ) {
            const envelope = payload;
            if ( envelope.success === false ) {
                const message = this.#extractErrorMessage(payload) ||
                    'Cloudflare image generation failed';
                throw new Error(message);
            }
        }
        const imageString = this.#extractImageString(payload);
        if ( ! imageString ) {
            throw new Error('Cloudflare image generation response did not include image data');
        }
        if ( imageString.startsWith('data:image/') || imageString.startsWith('http://') || imageString.startsWith('https://') ) {
            return imageString;
        }
        const mime = this.#mimeForFormat(params.output_format);
        return `data:${mime};base64,${imageString}`;
    }
    #extractImageString (payload) {
        if ( typeof payload === 'string' )
        {
            return payload;
        }
        if ( !payload || typeof payload !== 'object' )
        {
            return undefined;
        }
        const record = payload;
        if ( typeof record.image === 'string' )
        {
            return record.image;
        }
        if ( typeof record.output === 'string' )
        {
            return record.output;
        }
        if ( Array.isArray(record.images) && typeof record.images[0] === 'string' )
        {
            return record.images[0];
        }
        if ( Array.isArray(record.images) && typeof record.images[0] === 'object' && record.images[0] !== null ) {
            const firstImage = record.images[0];
            if ( typeof firstImage.image === 'string' )
            {
                return firstImage.image;
            }
        }
        if ( Array.isArray(record.output) && typeof record.output[0] === 'string' )
        {
            return record.output[0];
        }
        if ( record.result ) {
            const nested = this.#extractImageString(record.result);
            if ( nested )
            {
                return nested;
            }
        }
        if ( record.response ) {
            const nested = this.#extractImageString(record.response);
            if ( nested )
            {
                return nested;
            }
        }
        return undefined;
    }
    #extractErrorMessage (payload) {
        if ( !payload || typeof payload !== 'object' )
        {
            return undefined;
        }
        const record = payload;
        if ( typeof record.error === 'string' )
        {
            return record.error;
        }
        if ( typeof record.message === 'string' )
        {
            return record.message;
        }
        if ( Array.isArray(record.errors) && record.errors.length > 0 ) {
            const first = record.errors[0];
            if ( typeof first?.message === 'string' )
            {
                return first.message;
            }
            if ( typeof first?.error === 'string' )
            {
                return first.error;
            }
        }
        return undefined;
    }
    #tileCount ({ w, h }) {
        return Math.ceil(w / 512) * Math.ceil(h / 512);
    }
    #megapixels ({ w, h }) {
        return (w * h) / 1_000_000;
    }
    #mimeForFormat (format) {
        if ( format === 'jpeg' )
        {
            return 'image/jpeg';
        }
        if ( format === 'webp' )
        {
            return 'image/webp';
        }
        return 'image/png';
    }
    #costForUnits (units, microCentsPerUnit) {
        if ( !Number.isFinite(units) || units <= 0 )
        {
            return 0;
        }
        if ( !Number.isFinite(microCentsPerUnit) || microCentsPerUnit <= 0 )
        {
            return 0;
        }
        return Math.round(units * microCentsPerUnit);
    }
    #costForMillionUnits (numerator, microCentsPerMillion) {
        if ( !Number.isFinite(numerator) || numerator <= 0 )
        {
            return 0;
        }
        if ( !Number.isFinite(microCentsPerMillion) || microCentsPerMillion <= 0 )
        {
            return 0;
        }
        return Math.round((numerator * microCentsPerMillion) / 1_000_000);
    }
    #getMeteringModelKey (model) {
        if ( model.puterId && typeof model.puterId === 'string' ) {
            return model.puterId;
        }
        if ( model.id.startsWith('@cf/') ) {
            return `workers-ai:${model.id.slice('@cf/'.length)}`;
        }
        return model.id.replace(/^@+/, '');
    }
}
//# sourceMappingURL=CloudflareImageGenerationProvider.js.map