const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['be65d7e1-bd6d-47d8-8b16-039d6166b228'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
console.log('importing something...');
const { testval } = extension.import('exports_something');
console.log(testval);

extension.on('hello', event => {
    console.log(`received "hello" from: ${event.from}`);
});
