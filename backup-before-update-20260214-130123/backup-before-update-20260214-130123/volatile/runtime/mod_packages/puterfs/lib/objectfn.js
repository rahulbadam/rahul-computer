const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['989da079-b349-4b99-a3de-f3f065010c9b'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
/**
 * Instead of `myObject.hasOwnProperty(k)`, always write:
 * `safeHasOwnProperty(myObject, k)`.
 *
 * This is a less verbose way to call `Object.prototype.hasOwnProperty.call`.
 * This prevents unexpected behavior when `hasOwnProperty` is overridden,
 * which is especially possible for objects parsed from user-sent JSON.
 *
 * explanation: https://eslint.org/docs/latest/rules/no-prototype-builtins
 * @param {*} o
 * @param  {...any} a
 * @returns
 */
export const safeHasOwnProperty = (o, ...a) => {
    return Object.prototype.hasOwnProperty.call(o, ...a);
};
