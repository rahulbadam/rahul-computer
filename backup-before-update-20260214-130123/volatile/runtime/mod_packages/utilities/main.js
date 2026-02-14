const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['bc5e73b3-393f-470e-9a1a-4d024426383f'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
//@extension priority -10000

extension.exports = {};

extension.exports.sleep = async (seconds) => {
    await new Promise(resolve => {
        setTimeout(resolve, seconds);
    });
};
