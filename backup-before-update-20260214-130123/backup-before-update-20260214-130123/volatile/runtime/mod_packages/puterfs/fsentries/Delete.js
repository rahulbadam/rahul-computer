const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['989da079-b349-4b99-a3de-f3f065010c9b'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
import BaseOperation from './BaseOperation.js';

export default class extends BaseOperation {
    constructor (uuid) {
        super();
        this.uuid = uuid;
    }

    getStatement () {
        const statement = 'DELETE FROM fsentries WHERE uuid = ? LIMIT 1';
        const values = [this.uuid];
        return { statement, values };
    }

    apply (answer) {
        answer.entry = null;
    }
}
