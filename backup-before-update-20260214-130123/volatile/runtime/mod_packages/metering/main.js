const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['1ff236dd-d9e0-4a35-ac9e-d3c49b064157'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
import { UsageController } from './controllers/UsageController.js';
import './eventListeners/subscriptionEvents.js';
const meteringService = extension.import('service:meteringService');
const sqlClient = extension.import('service:database');
const controller = new UsageController(meteringService, sqlClient);
controller.registerRoutes();
//# sourceMappingURL=main.js.map