const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['24001470-424e-4de0-9560-5f3d9dbb16bd'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
extension.on('puter.gui.addons', async (event) => {
    if ( event.guiParams.app ) {
        // disabled for now
        // const app = event.guiParams.app;
        // event.bodyContent += `
        // <div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999999999; background: rgba(0,0,0,0.8); color: white; padding: 20px; overflow: auto;">
        //     test: ${ JSON.stringify(app)}
        // </div>`;
        // event.headContent += `<meta name="description" content="some additional description"/>`
        // event.headContent += `<script> console.log("test1234"); </script>`
    }
});