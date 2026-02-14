var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for ( var i = 0; i < initializers.length; i++ ) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept (f) {
        if ( f !== void 0 && typeof f !== 'function' ) throw new TypeError('Function expected'); return f;
    }
    var kind = contextIn.kind, key = kind === 'getter' ? 'get' : kind === 'setter' ? 'set' : 'value';
    var target = !descriptorIn && ctor ? contextIn['static'] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for ( var i = decorators.length - 1; i >= 0; i-- ) {
        var context = {};
        for ( var p in contextIn ) context[p] = p === 'access' ? {} : contextIn[p];
        for ( var p in contextIn.access ) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) {
            if ( done ) throw new TypeError('Cannot add initializers after decoration has completed'); extraInitializers.push(accept(f || null));
        };
        var result = (0, decorators[i])(kind === 'accessor' ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if ( kind === 'accessor' ) {
            if ( result === void 0 ) continue;
            if ( result === null || typeof result !== 'object' ) throw new TypeError('Object expected');
            if ( _ = accept(result.get) ) descriptor.get = _;
            if ( _ = accept(result.set) ) descriptor.set = _;
            if ( _ = accept(result.init) ) initializers.unshift(_);
        }
        else if ( _ = accept(result) ) {
            if ( kind === 'field' ) initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if ( target ) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['1ff236dd-d9e0-4a35-ac9e-d3c49b064157'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
const { Controller, Get, ExtensionController } = extension.import('extensionController');
let UsageController = (() => {
    let _classDecorators = [Controller('/metering')];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _classSuper = ExtensionController;
    let _instanceExtraInitializers = [];
    let _getUsage_decorators;
    let _getUsageByApp_decorators;
    let _getGlobalUsage_decorators;
    var UsageController = class extends _classSuper {
        static {
            _classThis = this;
        }
        static {
            const _metadata = typeof Symbol === 'function' && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getUsage_decorators = [Get('usage', { subdomain: 'api' })];
            _getUsageByApp_decorators = [Get('usage/:appIdOrName', { subdomain: 'api' })];
            _getGlobalUsage_decorators = [Get('globalUsage', { subdomain: 'api' }, extension.config.allowedGlobalUsageUsers || [])];
            __esDecorate(this, null, _getUsage_decorators, { kind: 'method', name: 'getUsage', static: false, private: false, access: { has: obj => 'getUsage' in obj, get: obj => obj.getUsage }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getUsageByApp_decorators, { kind: 'method', name: 'getUsageByApp', static: false, private: false, access: { has: obj => 'getUsageByApp' in obj, get: obj => obj.getUsageByApp }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getGlobalUsage_decorators, { kind: 'method', name: 'getGlobalUsage', static: false, private: false, access: { has: obj => 'getGlobalUsage' in obj, get: obj => obj.getGlobalUsage }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: 'class', name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            UsageController = _classThis = _classDescriptor.value;
            if ( _metadata ) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        #meteringService = __runInitializers(this, _instanceExtraInitializers);
        #sqlClient;
        constructor (meteringService, sqlClient) {
            super();
            this.#meteringService = meteringService;
            this.#sqlClient = sqlClient;
        }
        async getUsage (req, res) {
            const actor = req.actor;
            if ( ! actor ) {
                throw Error('actor not found in context');
            }
            const actorUsagePromise = this.#meteringService.getActorCurrentMonthUsageDetails(actor);
            const actorAllowanceInfoPromise = this.#meteringService.getAllowedUsage(actor);
            const [actorUsage, allowanceInfo] = await Promise.all([
                actorUsagePromise,
                actorAllowanceInfoPromise,
            ]);
            res.status(200).json({ ...actorUsage, allowanceInfo });
            return;
        }
        async getUsageByApp (req, res) {
            const actor = req.actor;
            if ( ! actor ) {
                throw Error('actor not found in context');
            }
            const appIdOrName = req.params.appIdOrName;
            if ( ! appIdOrName ) {
                res.status(400).json({ error: 'appId parameter is required' });
                return;
            }
            let appId = appIdOrName;
            if ( !appIdOrName.startsWith('app-') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appIdOrName.split('app-')[1]) ) {
                // Check if the part after 'app-' is a valid UUID (v4)
                const appRows = await this.#sqlClient.read('SELECT `uid` FROM `apps` WHERE `name` = ? LIMIT 1', [appIdOrName]);
                if ( appRows.length > 0 ) {
                    appId = appRows[0].uid;
                }
                else {
                    res.status(404).json({ error: 'App not found' });
                    return;
                }
            }
            else {
                appId = appIdOrName;
            }
            const appUsage = await this.#meteringService.getActorCurrentMonthAppUsageDetails(actor, appId);
            res.status(200).json(appUsage);
            return;
        }
        async getGlobalUsage (req, res) {
            const actor = req.actor;
            if ( ! actor ) {
                throw Error('actor not found in context');
            }
            const globalUsage = await this.#meteringService.getGlobalUsage();
            res.status(200).json(globalUsage);
            return;
        }
    };
    return UsageController = _classThis;
})();
export { UsageController };
//# sourceMappingURL=UsageController.js.map