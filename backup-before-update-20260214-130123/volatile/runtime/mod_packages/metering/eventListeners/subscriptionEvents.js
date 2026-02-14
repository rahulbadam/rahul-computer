const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry['1ff236dd-d9e0-4a35-ac9e-d3c49b064157'];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config;
extension.on('metering:overrideDefaultSubscription', async (event) => {
    // bit of a stub implementation for OSS, technically can be always free if you set this config true
    if ( config.unlimitedUsage ) {
        console.warn('WARNING!!! unlimitedUsage is enabled, this is not recommended for production use');
        event.defaultSubscriptionId = 'unlimited';
    }
});
extension.on('metering:registerAvailablePolicies', async (event) => {
    // bit of a stub implementation for OSS, technically can be always free if you set this config true
    if ( config.unlimitedUsage || config.unlimitedAllowList?.length ) {
        event.availablePolicies.push({
            id: 'unlimited',
            monthUsageAllowance: 5_000_000 * 1_000_000 * 100, // unless you're like, jeff's, mark's, and elon's illegitamate son, you probably won't hit $5m a month
            monthlyStorageAllowance: 100_000 * 1024 * 1024, // 100MiB but ignored in local dev
        });
    }
});
extension.on('metering:getUserSubscription', async (event) => {
    const userName = event?.actor?.type?.user?.username;
    if ( config.unlimitedAllowList?.includes(userName) ) {
        event.userSubscriptionId;
    }
    else {
        event.userSubscriptionId = event?.actor?.type?.user?.subscription?.active ? event.actor.type.user.subscription?.tier : undefined;
    }
    // default location for user sub, but can techinically be anywhere else or fetched on request
});
export {};
//# sourceMappingURL=subscriptionEvents.js.map