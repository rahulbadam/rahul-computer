const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['fb9d0f36-68c2-40c1-b299-852ab858ef3b'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
//@extension priority -10000

const { redisClient, kvjs } = extension.import('core');
const svc_database = extension.import('service:database');
const svc_kvstore = extension.import('service:puter-kvstore');

// Methods on the object from `.as()` come from TraitsFeature.js,
// and they are already bound to their respective instance.
const simplified_kv = { ...svc_kvstore.as('puter-kvstore') };

const original_get = simplified_kv.get;
const original_set = simplified_kv.set;

simplified_kv.get = (...a) => {
    if ( typeof a[0] === 'string' ) {
        return original_get({ key: a[0] });
    }
    return original_get(...a);
};

simplified_kv.set = (...a) => {
    if ( typeof a[0] === 'string' ) {
        return original_set({ key: a[0], value: a[1] });
    }
    return original_set(...a);
};

extension.exports = {
    db: svc_database.get(),
    kv: simplified_kv,
    cache: redisClient,
    kvjs: kvjs,
};
