const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['989da079-b349-4b99-a3de-f3f065010c9b'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
export default class {
    constructor (delegate) {
        this.delegate = delegate ?? null;
    }
    setDelegate (delegate) {
        this.delegate = delegate;
    }

    init (...a) {
        return this.delegate.init(...a);
    }
    upload (...a) {
        return this.delegate.upload(...a);
    }
    copy (...a) {
        return this.delegate.copy(...a);
    }
    delete (...a) {
        return this.delegate.delete(...a);
    }
    read (...a) {
        return this.delegate.read(...a);
    }
}
