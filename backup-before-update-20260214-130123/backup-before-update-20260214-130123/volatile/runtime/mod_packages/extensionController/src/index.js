const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['64f878ea-62e1-46bc-a8bb-1756f4513ca7'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
import { Controller, Delete, ExtensionController, Get, HttpError, Post, Put } from './ExtensionController.js';
extension.exports = {
    ExtensionController,
    Controller,
    Get,
    Put,
    Post,
    Delete,
    HttpError,
};
export { Controller, Delete, ExtensionController, Get, HttpError, Post, Put };
//# sourceMappingURL=index.js.map