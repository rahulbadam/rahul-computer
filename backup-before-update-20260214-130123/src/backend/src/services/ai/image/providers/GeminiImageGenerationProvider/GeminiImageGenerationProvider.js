import { GoogleGenAI } from '@google/genai';
import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { GEMINI_DEFAULT_RATIO, GEMINI_IMAGE_GENERATION_MODELS } from './models.js';
export class GeminiImageGenerationProvider {
    #meteringService;
    #client;
    #errors;
    constructor (config, meteringService, errorService) {
        if ( ! config.apiKey ) {
            throw new Error('Gemini image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#client = new GoogleGenAI({ apiKey: config.apiKey });
        this.#errors = errorService;
    }
    models () {
        return GEMINI_IMAGE_GENERATION_MODELS;
    }
    getDefaultModel () {
        return GEMINI_IMAGE_GENERATION_MODELS[0].id;
    }
    async generate (params) {
        const { prompt, test_mode } = params;
        let { model, ratio, quality } = params;
        const { input_image, input_image_mime_type } = params;
        const selectedModel = this.models().find(m => m.id === model) || this.models().find(m => m.id === this.getDefaultModel());
        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }
        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }
        const allowedRatios = selectedModel.allowedRatios ?? [GEMINI_DEFAULT_RATIO];
        ratio = ratio && this.#isValidRatio(ratio, allowedRatios) ? ratio : allowedRatios[0];
        if ( input_image && !input_image_mime_type ) {
            throw new Error('`input_image_mime_type` is required when `input_image` is provided');
        }
        if ( input_image_mime_type && !input_image ) {
            throw new Error('`input_image` is required when `input_image_mime_type` is provided');
        }
        if ( input_image_mime_type && !this.#isValidImageMimeType(input_image_mime_type) ) {
            throw new Error('`input_image_mime_type` must be a valid image MIME type (image/png, image/jpeg, image/webp)');
        }
        const priceKey = `${quality ? `${quality}:` : ''}${ratio.w}x${ratio.h}`;
        const priceInCents = selectedModel.costs[priceKey];
        if ( priceInCents === undefined ) {
            const availableSizes = Object.keys(selectedModel.costs)
                .filter(key => key !== 'input' && key !== 'output');
            throw APIError.create('field_invalid', undefined, {
                key: 'size/quality combination',
                expected: `one of: ${availableSizes.join(', ')}`,
                got: priceKey,
            });
        }
        const actor = Context.get('actor');
        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.#errors.report('gemini-image-generation:unknown-user', {
                message: 'failed to get a user ID for a Gemini request',
                alarm: true,
                trace: true,
            });
        }
        const estimatedPromptTokenCount = this.#estimatePromptTokenCount(prompt);
        const estimatedInputCostInCents = this.#calculateTokenCostInCents(estimatedPromptTokenCount, selectedModel.costs.input);
        const estimatedOutputCostInCents = priceInCents;
        const estimatedTotalCostInMicroCents = this.#toMicroCents(estimatedInputCostInCents + estimatedOutputCostInCents);
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, estimatedTotalCostInMicroCents);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }
        const contents = this.#buildContents(prompt, ratio, input_image, input_image_mime_type);
        const response = await this.#client.models.generateContent({
            model: selectedModel.id,
            contents,
        });
        const usage = this.#extractUsageMetadata(response);
        const inputTokenCount = usage.promptTokenCount || estimatedPromptTokenCount;
        const outputTokenCount = usage.candidatesTokenCount + usage.thoughtsTokenCount;
        const inputCostInCents = this.#calculateTokenCostInCents(inputTokenCount, selectedModel.costs.input);
        const outputTextCostInCents = this.#calculateTokenCostInCents(outputTokenCount, selectedModel.costs.output);
        const outputCostInCents = priceInCents + outputTextCostInCents;
        const usagePrefix = `gemini:${selectedModel.id}:${priceKey}`;
        this.#meteringService.batchIncrementUsages(actor, [
            {
                usageType: `${usagePrefix}:input`,
                usageAmount: Math.max(inputTokenCount, 1),
                costOverride: this.#toMicroCents(inputCostInCents),
            },
            {
                usageType: `${usagePrefix}:output`,
                usageAmount: Math.max(outputTokenCount, 1),
                costOverride: this.#toMicroCents(outputCostInCents),
            },
        ]);
        this.#setResponseCostMetadata({
            model: selectedModel.id,
            quality,
            ratio,
            inputCostInCents,
            outputCostInCents,
            inputTokenCount,
            outputTokenCount,
        });
        const url = this.#extractImageUrl(response);
        if ( ! url ) {
            throw new Error('Failed to extract image URL from Gemini response');
        }
        return url;
    }
    #buildContents (prompt, ratio, input_image, input_image_mime_type) {
        if ( input_image && input_image_mime_type ) {
            return [
                { text: `Generate a picture of dimensions ${parseInt(`${ratio.w}`)}x${parseInt(`${ratio.h}`)} with the prompt: ${prompt}` },
                {
                    inlineData: {
                        mimeType: input_image_mime_type,
                        data: input_image,
                    },
                },
            ];
        }
        return `Generate a picture of dimensions ${parseInt(`${ratio.w}`)}x${parseInt(`${ratio.h}`)} with the prompt: ${prompt}`;
    }
    #setResponseCostMetadata ({ model, quality, ratio, inputCostInCents, outputCostInCents, inputTokenCount, outputTokenCount }) {
        const clientDriverCall = Context.get('client_driver_call');
        const responseMetadata = clientDriverCall?.response_metadata;
        if ( ! responseMetadata )
        {
            return;
        }
        const totalCostInCents = inputCostInCents + outputCostInCents;
        responseMetadata.cost = {
            currency: 'usd-cents',
            input: inputCostInCents,
            output: outputCostInCents,
            total: totalCostInCents,
        };
        responseMetadata.cost_components = {
            provider: 'gemini-image-generation',
            model,
            quality,
            ratio: `${ratio.w}x${ratio.h}`,
            input_tokens: inputTokenCount,
            output_tokens: outputTokenCount,
            input_microcents: this.#toMicroCents(inputCostInCents),
            output_microcents: this.#toMicroCents(outputCostInCents),
            total_microcents: this.#toMicroCents(totalCostInCents),
        };
    }
    #extractUsageMetadata (response) {
        const usage = response.usageMetadata;
        return {
            promptTokenCount: this.#toSafeCount(usage?.promptTokenCount),
            candidatesTokenCount: this.#toSafeCount(usage?.candidatesTokenCount),
            thoughtsTokenCount: this.#toSafeCount(usage?.thoughtsTokenCount),
        };
    }
    #estimatePromptTokenCount (prompt) {
        const text = prompt.trim();
        if ( text.length === 0 )
        {
            return 0;
        }
        return Math.max(1, Math.floor(((text.length / 4) + (text.split(/\s+/).length * (4 / 3))) / 2));
    }
    #calculateTokenCostInCents (tokenCount, centsPerMillion) {
        if ( !Number.isFinite(tokenCount) || tokenCount <= 0 )
        {
            return 0;
        }
        if ( !Number.isFinite(centsPerMillion) || (centsPerMillion ?? 0) <= 0 )
        {
            return 0;
        }
        return (tokenCount / 1_000_000) * centsPerMillion;
    }
    #toMicroCents (cents) {
        if ( !Number.isFinite(cents) || cents <= 0 )
        {
            return 1;
        }
        return Math.ceil(cents * 1_000_000);
    }
    #toSafeCount (value) {
        if ( typeof value !== 'number' || !Number.isFinite(value) || value < 0 )
        {
            return 0;
        }
        return Math.floor(value);
    }
    #extractImageUrl (response) {
        const parts = response?.candidates?.[0]?.content?.parts;
        if ( ! Array.isArray(parts) ) {
            return undefined;
        }
        for ( const part of parts ) {
            if ( part?.inlineData?.data ) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        return undefined;
    }
    #isValidRatio (ratio, allowedRatios) {
        return allowedRatios.some(r => r.w === ratio.w && r.h === ratio.h);
    }
    #isValidImageMimeType (mimeType) {
        if ( ! mimeType )
        {
            return false;
        }
        const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        return supportedTypes.includes(mimeType.toLowerCase());
    }
}
//# sourceMappingURL=GeminiImageGenerationProvider.js.map