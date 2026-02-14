export class ChatProvider {
    getDefaultModel () {
        return '';
    }
    models () {
        return [];
    }
    list () {
        return [];
    }
    async checkModeration (_text) {
        return {
            flagged: false,
            results: {},
        };
    }
    async complete (_arg) {
        throw new Error('Method not implemented.');
    }
}
//# sourceMappingURL=ChatProvider.js.map