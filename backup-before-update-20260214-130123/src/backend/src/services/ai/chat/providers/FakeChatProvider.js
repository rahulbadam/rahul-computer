import dedent from 'dedent';
import { LoremIpsum } from 'lorem-ipsum';
export class FakeChatProvider {
    checkModeration (_text) {
        throw new Error('Method not implemented.');
    }
    getDefaultModel () {
        return 'fake';
    }
    async models () {
        return [
            {
                id: 'fake',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: {
                    'input-tokens': 0,
                    'output-tokens': 0,
                },
                max_tokens: 8192,
            },
            {
                id: 'costly',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: {
                    'input-tokens': 1000,
                    'output-tokens': 2000,
                },
                max_tokens: 8192,
            },
            {
                id: 'abuse',
                aliases: [],
                costs_currency: 'usd-cents',
                costs: {
                    'input-tokens': 0,
                    'output-tokens': 0,
                },
                max_tokens: 8192,
            },
        ];
    }
    async list () {
        return ['fake', 'costly', 'abuse'];
    }
    async complete ({ messages, stream, model, max_tokens, custom }) {
        const usedModel = model || this.getDefaultModel();
        const resp = this.getFakeResponse(usedModel, custom, messages, max_tokens);
        if ( stream ) {
            return {
                init_chat_stream: async ({ chatStream }) => {
                    await new Promise(rslv => setTimeout(rslv, 500));
                    chatStream.stream.write(`${JSON.stringify({
                        type: 'text',
                        text: (await resp).message.content[0].text,
                    })}\n`);
                    chatStream.end();
                },
                stream: true,
                finally_fn: async () => {
                },
            };
        }
        return resp;
    }
    async getFakeResponse (modelId, custom, messages, maxTokens = 8192) {
        let inputTokens = 0;
        let outputTokens = 0;
        if ( modelId === 'costly' ) {
            if ( messages && messages.length > 0 ) {
                for ( const message of messages ) {
                    if ( typeof message.content === 'string' ) {
                        inputTokens += Math.ceil(message.content.length / 4);
                    }
                    else if ( Array.isArray(message.content) ) {
                        for ( const content of message.content ) {
                            if ( content.type === 'text' ) {
                                inputTokens += Math.ceil(content.text.length / 4);
                            }
                        }
                    }
                }
            }
            outputTokens = Math.floor(Math.min((Math.random() * 150) + 50, maxTokens));
        }
        let responseText;
        if ( modelId === 'abuse' ) {
            responseText = dedent(`
                <h2>Free AI and Cloud for everyone!</h2><br />
                Come on down to <a href="https://puter.com">puter.com</a> and try it out!
                ${custom ?? ''}
            `);
        }
        else {
            responseText = new LoremIpsum({
                sentencesPerParagraph: {
                    max: 8,
                    min: 4,
                },
                wordsPerSentence: {
                    max: 20,
                    min: 12,
                },
            }).generateParagraphs(Math.floor(Math.random() * 3) + 1);
        }
        const usage = {
            'input_tokens': modelId === 'costly' ? inputTokens : 0,
            'output_tokens': modelId === 'costly' ? outputTokens : 1,
        };
        return {
            message: {
                'id': '00000000-0000-0000-0000-000000000000',
                'type': 'message',
                'role': 'assistant',
                'model': modelId,
                'content': [
                    {
                        'type': 'text',
                        'text': responseText,
                    },
                ],
                'stop_reason': 'end_turn',
                'stop_sequence': null,
                'usage': usage,
            },
            'usage': usage,
            'finish_reason': 'stop',
        };
    }
}
//# sourceMappingURL=FakeChatProvider.js.map