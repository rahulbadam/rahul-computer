const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['47fc81e9-fb78-4683-9819-76476b833f24'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
//@puter priority -1
console.log('exporting something...');
extension.exports = {
    testval: 5,
};

extension.on('init', () => {
    extension.emit('hello', {
        from: 'exports_something',
    });
});
