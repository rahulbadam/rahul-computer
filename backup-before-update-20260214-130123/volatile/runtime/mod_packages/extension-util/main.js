const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['534fd136-41b6-4679-94c4-bb1e10285aa0'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
//@extension name extension
const { Context } = extension.import('core');

// The 'create.commands' event is fired by CommandService
extension.on('create.commands', event => {

    // Add command to list available extensions
    event.createCommand('list', {
        description: 'list available extensions',
        handler: async (_, console) => {

            // Get extnsion information from context
            const extensionInfos = Context.get('extensionInfo');

            // Iterate over extension infos
            for ( const info of Object.values(extensionInfos) ) {

                // Construct a string
                const moduleType = info.type === 'module'
                    ? '\x1B[32;1m(ESM)\x1B[0m'
                    : '\x1B[33;1m(CJS)\x1B[0m';
                let str = `- ${info.name} ${moduleType}`;
                if ( info.priority !== 0 ) {
                    str += ` (priority ${info.priority})`;
                }

                // Print a string
                console.log(str);
            }
        },
    });
});
