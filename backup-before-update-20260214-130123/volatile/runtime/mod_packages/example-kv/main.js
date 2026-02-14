const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['2b79bba5-bdf3-4e76-ae40-cba6306284b2'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
const { kv } = extension.import('data');
const { sleep } = extension.import('utilities');

// "kv" is load ready to use before the 'init' event is fired.
extension.on('init', async () => {
    kv.set('example-kv-key', 'example-kv-value');

    console.log('kv key has', await kv.get('example-kv-key'));

    await kv.expire({
        key: 'example-kv-key',
        ttl: 1000 * 60, // 1 minute
    });

    // This AIIFE demonstrates how "kv.expire" works.
    // We cannot simply "await" this - otherwise we block init!
    (async () => {
        // wait for 30 seconds...
        await sleep(30 * 1000);

        console.log('kv key still has value', await kv.get('example-kv-key'));

        // wait for 30 more seconds
        await sleep(30 * 1000);
        // and just a little bit longer
        // await sleep(100);

        console.log('kv key should no longer have the value', await kv.get('example-kv-key'));
    })();
});
