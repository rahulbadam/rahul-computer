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
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['c2462d89-4a59-4957-ad97-4d6207a0b18b'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
import fs from 'fs/promises';
import os from 'os';
const { Controller, Get, ExtensionController } = extension.import('extensionController');
let ServerInfoController = (() => {
    let _classDecorators = [Controller('/serverInfo', [...config.allowedUsernames])];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _classSuper = ExtensionController;
    let _instanceExtraInitializers = [];
    let _getServerInfo_decorators;
    var ServerInfoController = class extends _classSuper {
        static {
            _classThis = this;
        }
        static {
            const _metadata = typeof Symbol === 'function' && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getServerInfo_decorators = [Get('', { subdomain: 'api' })];
            __esDecorate(this, null, _getServerInfo_decorators, { kind: 'method', name: 'getServerInfo', static: false, private: false, access: { has: obj => 'getServerInfo' in obj, get: obj => obj.getServerInfo }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: 'class', name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            ServerInfoController = _classThis = _classDescriptor.value;
            if ( _metadata ) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        async getServerInfo (req, res) {
            const osData = {
                platform: os.platform(),
                type: os.type(),
                release: os.release(),
                pretty: `${os.type()} ${os.release()}`,
            };
            const cpus = os.cpus();
            const cpuData = {
                model: cpus[0]?.model || 'Unknown',
                cores: cpus.length,
            };
            const ramData = {
                total: os.totalmem(),
                free: os.freemem(),
                totalGB: (os.totalmem() / 1073741824).toFixed(2),
                freeGB: (os.freemem() / 1073741824).toFixed(2),
            };
            const uptimeSeconds = os.uptime();
            const uptimeData = {
                seconds: uptimeSeconds,
                days: Math.floor(uptimeSeconds / 86400),
                hours: Math.floor((uptimeSeconds % 86400) / 3600),
                minutes: Math.floor((uptimeSeconds % 3600) / 60),
                pretty: `${Math.floor(uptimeSeconds / 86400)}d ${Math.floor((uptimeSeconds % 86400) / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
            };
            let diskData = { total: 'N/A', free: 'N/A', used: 'N/A' };
            try {
                const stats = await fs.statfs('/');
                const totalGB = (stats.blocks * stats.bsize / 1073741824);
                const freeGB = (stats.bfree * stats.bsize / 1073741824);
                const usedGB = (totalGB - freeGB).toFixed(2);
                diskData = { total: totalGB.toFixed(2), free: freeGB.toFixed(2), used: usedGB };
            }
            catch ( err ) {
                console.error('Disk stats error:', err);
            }
            const response = {
                os: osData,
                cpu: cpuData,
                ram: ramData,
                uptime: uptimeData,
                disk: diskData,
                loadavg: os.loadavg(),
                hostname: os.hostname(),
            };
            res.json(response);
        }
        constructor () {
            super(...arguments);
            __runInitializers(this, _instanceExtraInitializers);
        }
    };
    return ServerInfoController = _classThis;
})();
(new ServerInfoController()).registerRoutes();
//# sourceMappingURL=index.js.map