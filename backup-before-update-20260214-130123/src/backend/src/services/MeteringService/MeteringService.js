import murmurhash from 'murmurhash';
import { SystemActorType } from '../auth/Actor.js';
import { DEFAULT_FREE_SUBSCRIPTION, DEFAULT_TEMP_SUBSCRIPTION, GLOBAL_APP_KEY, METRICS_PREFIX, PERIOD_ESCAPE, POLICY_PREFIX } from './consts.js';
import { COST_MAPS } from './costMaps/index.js';
import { SUB_POLICIES } from './subPolicies/index.js';
import { toMicroCents } from './utils.js';
export class MeteringService {
    static GLOBAL_SHARD_COUNT = 1000;
    static APP_SHARD_COUNT = 1000;
    static MAX_GLOBAL_USAGE_PER_MINUTE = toMicroCents(.2);
    #kvStore;
    #superUserService;
    #alarmService;
    #eventService;
    constructor ({ kvStore, superUserService, alarmService, eventService }) {
        this.#superUserService = superUserService;
        this.#kvStore = kvStore;
        this.#alarmService = alarmService;
        this.#eventService = eventService;
        setInterval(() => {
            this.#checkRateOfChange();
        }, 1000 * 60 * 5);
    }
    utilRecordUsageObject (trackedUsageObject, actor, modelPrefix, costsOverrides) {
        this.batchIncrementUsages(actor, Object.entries(trackedUsageObject).map(([usageKind, amount]) => {
            const hasOverride = !!costsOverrides && Number.isFinite(costsOverrides[usageKind]);
            return {
                usageType: `${modelPrefix}:${usageKind}`,
                usageAmount: amount,
                costOverride: hasOverride ? costsOverrides[usageKind] : undefined,
            };
        }));
    }
    #getMonthYearString () {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    #generateGloabalUsageKey (userId, appId, currentMonth) {
        const hashOfUserAndApp = murmurhash.v3(`${userId}:${appId}`) % MeteringService.GLOBAL_SHARD_COUNT;
        const key = `${METRICS_PREFIX}:puter:${hashOfUserAndApp}:${currentMonth}`;
        return key;
    }
    #generateAppUsageKey (appId, userId, currentMonth) {
        const hashOfApp = murmurhash.v3(`${appId}${userId}`) % MeteringService.APP_SHARD_COUNT;
        const key = `${METRICS_PREFIX}:app:${appId}:${hashOfApp}:${currentMonth}`;
        return key;
    }
    async incrementUsage (actor, usageType, usageAmount, costOverride) {
        usageAmount = usageAmount < 0 ? 1 : usageAmount;
        const costOverrideRaw = costOverride;
        costOverride = !Number.isFinite(costOverride)
            ? undefined
            : costOverride < 0
                ? 1
                : costOverride;
        if ( costOverrideRaw && costOverrideRaw < 0 ) {
            this.#alarmService.create(`metering unexpected negative cost access to: ${usageType}`, 'negative cost abuse vector!', {
                userId: actor.type?.user?.uuid,
                username: actor.type?.user?.username,
                appId: actor.type?.app?.uid,
                usageType,
                usageAmount,
                costOverride,
            });
        }
        try {
            if ( !usageAmount || !usageType || !actor ) {
                return { total: 0 };
            }
            if ( actor.type instanceof SystemActorType || actor.type?.user?.username === 'system' ) {
                return { total: 0 };
            }
            const currentMonth = this.#getMonthYearString();
            return this.#superUserService.sudo(async () => {
                const mappedCost = COST_MAPS[usageType];
                const totalCost = (((costOverride && costOverride < 0) ? 1 : costOverride) ?? ((mappedCost || 0) * usageAmount));
                if ( totalCost === 0 && (mappedCost !== 0 && costOverride !== 0) ) {
                    this.#alarmService.create(`metering unexpected 0 cost access to: ${usageType}`, '0 cost abuse vector', {
                        userId: actor.type?.user?.uuid,
                        username: actor.type?.user?.username,
                        appId: actor.type?.app?.uid,
                        usageType,
                        usageAmount,
                        costOverride,
                    });
                }
                usageType = usageType.replace(/\./g, PERIOD_ESCAPE);
                const appId = actor.type?.app?.uid || GLOBAL_APP_KEY;
                const userId = actor.type?.user.uuid;
                const pathAndAmountMap = {
                    'total': totalCost,
                    [`${usageType}.units`]: usageAmount,
                    [`${usageType}.cost`]: totalCost,
                    [`${usageType}.count`]: 1,
                };
                const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
                const actorUsagesPromise = this.#kvStore.incr({
                    key: actorUsageKey,
                    pathAndAmountMap,
                });
                const puterConsumptionKey = this.#generateGloabalUsageKey(userId, appId, currentMonth);
                this.#kvStore.incr({
                    key: puterConsumptionKey,
                    pathAndAmountMap,
                }).catch((e) => {
                    console.warn('Failed to increment aux usage data \'puterConsumptionKey\' with error: ', e);
                });
                const actorAppUsageKey = `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppUsageKey,
                    pathAndAmountMap,
                }).catch((e) => {
                    console.warn('Failed to increment aux usage data \'actorAppUsageKey\' with error: ', e);
                });
                if ( appId !== GLOBAL_APP_KEY ) {
                    const appUsageKey = this.#generateAppUsageKey(appId, userId, currentMonth);
                    this.#kvStore.incr({
                        key: appUsageKey,
                        pathAndAmountMap,
                    }).catch((e) => {
                        console.warn('Failed to increment aux usage data \'appUsageKey\' with error: ', e);
                    });
                }
                const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppTotalsKey,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalCost,
                        [`${appId}.count`]: 1,
                    },
                }).catch((e) => {
                    console.warn('Failed to increment aux usage data \'actorAppTotalsKey\' with error: ', e);
                });
                const lastUpdatedKey = `${METRICS_PREFIX}:actor:${userId}:lastUpdated`;
                this.#kvStore.set({
                    key: lastUpdatedKey,
                    value: Date.now(),
                }).catch((e) => {
                    console.warn('Failed to set lastUpdatedKey with error: ', e);
                });
                const actorSubscriptionPromise = this.getActorSubscription(actor);
                const actorAddonsPromise = this.getActorAddons(actor);
                const [actorUsages, actorSubscription, actorAddons] = (await Promise.all([actorUsagesPromise, actorSubscriptionPromise, actorAddonsPromise]));
                if ( actorUsages.total > actorSubscription.monthUsageAllowance && actorAddons.purchasedCredits && actorAddons.purchasedCredits > (actorAddons.consumedPurchaseCredits || 0) ) {
                    const withinBoundsUsage = Math.max(0, actorSubscription.monthUsageAllowance - actorUsages.total + totalCost);
                    const overageUsage = totalCost - withinBoundsUsage;
                    if ( overageUsage > 0 ) {
                        await this.#kvStore.incr({
                            key: `${POLICY_PREFIX}:actor:${userId}:addons`,
                            pathAndAmountMap: {
                                consumedPurchaseCredits: Math.min(overageUsage, actorAddons.purchasedCredits - (actorAddons.consumedPurchaseCredits || 0)),
                            },
                        });
                    }
                }
                const allowedUsageMultiple = Math.floor(actorUsages.total / actorSubscription.monthUsageAllowance);
                const previousAllowedUsageMultiple = Math.floor((actorUsages.total - totalCost) / actorSubscription.monthUsageAllowance);
                const isOver2x = allowedUsageMultiple >= 2;
                const isChangeOverPastOverage = previousAllowedUsageMultiple < allowedUsageMultiple;
                const hasNoAddonCredit = (actorAddons.purchasedCredits || 0) <= (actorAddons.consumedPurchaseCredits || 0);
                if ( isOver2x && isChangeOverPastOverage && hasNoAddonCredit ) {
                    this.#alarmService.create(`metering usage exceeded by user: ${actor.type?.user?.username}`, `Actor ${userId} has exceeded their usage allowance significantly`, {
                        userId: actor.type?.user?.uuid,
                        username: actor.type?.user?.username,
                        appId: actor.type?.app?.uid,
                        usageType,
                        usageAmount,
                        costOverride,
                        totalUsage: actorUsages.total,
                        monthUsageAllowance: actorSubscription.monthUsageAllowance,
                    });
                }
                return actorUsages;
            });
        }
        catch (e) {
            console.error('Metering: Failed to increment usage for actor', actor, 'usageType', usageType, 'usageAmount', usageAmount, e);
            this.#alarmService.create(`metering service error for user: ${actor.type?.user?.username} app: ${actor.type.app.uid}`, e.message, {
                userId: actor.type?.user?.uuid,
                username: actor.type?.user?.username,
                appId: actor.type?.app?.uid,
                error: e,
                usageType,
                usageAmount,
                costOverride,
            });
            return { total: 0 };
        }
    }
    async batchIncrementUsages (actor, usages) {
        try {
            if ( !usages || usages.length === 0 || !actor ) {
                return { total: 0 };
            }
            if ( actor.type instanceof SystemActorType || actor.type?.user?.username === 'system' ) {
                return { total: 0 };
            }
            const currentMonth = this.#getMonthYearString();
            return this.#superUserService.sudo(async () => {
                const aggregatedPathAndAmountMap = {};
                let totalBatchCost = 0;
                let hasZeroCostWarning = false;
                for ( const usage of usages ) {
                    const { usageType, usageAmount: usageAmountRaw, costOverride: costOverrideRaw } = usage;
                    const usageAmount = (!Number.isFinite(usageAmountRaw) || usageAmountRaw < 0) ? 1 : usageAmountRaw;
                    const costOverride = !Number.isFinite(costOverrideRaw)
                        ? undefined
                        : costOverrideRaw < 0
                            ? 1
                            : costOverrideRaw;
                    if ( !usageAmount || !usageType ) {
                        continue;
                    }
                    if ( costOverrideRaw && costOverrideRaw < 0 ) {
                        this.#alarmService.create(`metering unexpected negative cost access to: ${usageType}`, 'negative cost abuse vector!', {
                            userId: actor.type?.user?.uuid,
                            username: actor.type?.user?.username,
                            appId: actor.type?.app?.uid,
                            usageType,
                            usageAmount,
                            costOverride,
                            costOverrideRaw,
                        });
                    }
                    const mappedCost = COST_MAPS[usageType];
                    const totalCost = costOverride ?? ((mappedCost || 0) * usageAmount);
                    totalBatchCost += totalCost;
                    if ( !hasZeroCostWarning && totalCost === 0 && (mappedCost !== 0 && costOverride !== 0) ) {
                        hasZeroCostWarning = true;
                        this.#alarmService.create(`metering unexpected 0 cost access to: ${usageType}`, '0 cost abuse vector', {
                            userId: actor.type?.user?.uuid,
                            username: actor.type?.user?.username,
                            appId: actor.type?.app?.uid,
                            usageType,
                            usageAmount,
                            costOverride,
                            costOverrideRaw,
                        });
                    }
                    const escapedUsageType = usageType.replace(/\./g, PERIOD_ESCAPE);
                    aggregatedPathAndAmountMap['total'] = (aggregatedPathAndAmountMap['total'] || 0) + totalCost;
                    aggregatedPathAndAmountMap[`${escapedUsageType}.units`] = (aggregatedPathAndAmountMap[`${escapedUsageType}.units`] || 0) + usageAmount;
                    aggregatedPathAndAmountMap[`${escapedUsageType}.cost`] = (aggregatedPathAndAmountMap[`${escapedUsageType}.cost`] || 0) + totalCost;
                    aggregatedPathAndAmountMap[`${escapedUsageType}.count`] = (aggregatedPathAndAmountMap[`${escapedUsageType}.count`] || 0) + 1;
                }
                const appId = actor.type?.app?.uid || GLOBAL_APP_KEY;
                const userId = actor.type?.user.uuid;
                const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
                const actorUsagesPromise = this.#kvStore.incr({
                    key: actorUsageKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                });
                const puterConsumptionKey = this.#generateGloabalUsageKey(userId, appId, currentMonth);
                this.#kvStore.incr({
                    key: puterConsumptionKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                }).catch((e) => {
                    console.warn('Failed to increment aux usage data \'puterConsumptionKey\' with error: ', e);
                });
                const actorAppUsageKey = `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppUsageKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                }).catch((e) => {
                    console.warn('Failed to increment aux usage data \'actorAppUsageKey\' with error: ', e);
                });
                const appUsageKey = this.#generateAppUsageKey(appId, userId, currentMonth);
                this.#kvStore.incr({
                    key: appUsageKey,
                    pathAndAmountMap: aggregatedPathAndAmountMap,
                }).catch((e) => {
                    console.warn('Failed to increment aux usage data \'appUsageKey\' with error: ', e);
                });
                const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`;
                this.#kvStore.incr({
                    key: actorAppTotalsKey,
                    pathAndAmountMap: {
                        [`${appId}.total`]: totalBatchCost,
                        [`${appId}.count`]: usages.length,
                    },
                }).catch((e) => {
                    console.warn('Failed to increment aux usage data \'actorAppTotalsKey\' with error: ', e);
                });
                const lastUpdatedKey = `${METRICS_PREFIX}:actor:${userId}:lastUpdated`;
                this.#kvStore.set({
                    key: lastUpdatedKey,
                    value: Date.now(),
                }).catch((e) => {
                    console.warn('Failed to set lastUpdatedKey with error: ', e);
                });
                const actorSubscriptionPromise = this.getActorSubscription(actor);
                const actorAddonsPromise = this.getActorAddons(actor);
                const [actorUsages, actorSubscription, actorAddons] = (await Promise.all([actorUsagesPromise, actorSubscriptionPromise, actorAddonsPromise]));
                if ( actorUsages.total > actorSubscription.monthUsageAllowance && actorAddons.purchasedCredits && actorAddons.purchasedCredits > (actorAddons.consumedPurchaseCredits || 0) ) {
                    const withinBoundsUsage = Math.max(0, actorSubscription.monthUsageAllowance - actorUsages.total + totalBatchCost);
                    const overageUsage = totalBatchCost - withinBoundsUsage;
                    if ( overageUsage > 0 ) {
                        await this.#kvStore.incr({
                            key: `${POLICY_PREFIX}:actor:${userId}:addons`,
                            pathAndAmountMap: {
                                consumedPurchaseCredits: Math.min(overageUsage, actorAddons.purchasedCredits - (actorAddons.consumedPurchaseCredits || 0)),
                            },
                        });
                    }
                }
                const allowedUsageMultiple = Math.floor(actorUsages.total / actorSubscription.monthUsageAllowance);
                const previousAllowedUsageMultiple = Math.floor((actorUsages.total - totalBatchCost) / actorSubscription.monthUsageAllowance);
                const isOver2x = allowedUsageMultiple >= 2;
                const isChangeOverPastOverage = previousAllowedUsageMultiple < allowedUsageMultiple;
                const hasNoAddonCredit = (actorAddons.purchasedCredits || 0) <= (actorAddons.consumedPurchaseCredits || 0);
                if ( isOver2x && isChangeOverPastOverage && hasNoAddonCredit ) {
                    this.#alarmService.create(`metering usage exceeded by user: ${actor.type?.user?.username}`, `Actor ${userId} has exceeded their usage allowance significantly`, {
                        userId: actor.type?.user?.uuid,
                        username: actor.type?.user?.username,
                        appId: actor.type?.app?.uid,
                        batchUsages: usages,
                        totalBatchCost,
                        totalUsage: actorUsages.total,
                        monthUsageAllowance: actorSubscription.monthUsageAllowance,
                    });
                }
                return actorUsages;
            });
        }
        catch (e) {
            console.error('Metering: Failed to batch increment usage for actor', actor, 'usages', usages, e);
            this.#alarmService.create(`metering service error for user: ${actor.type?.user?.username} app: ${actor.type.app.uid}`, e.message, {
                userId: actor.type?.user?.uuid,
                username: actor.type?.user?.username,
                appId: actor.type?.app?.uid,
                error: e,
                actor,
                batchUsages: usages,
            });
            return { total: 0 };
        }
    }
    async getActorCurrentMonthUsageDetails (actor) {
        if ( ! actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get usage details');
        }
        const currentMonth = this.#getMonthYearString();
        const keys = [
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:${currentMonth}`,
            `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:apps:${currentMonth}`,
        ];
        return await this.#superUserService.sudo(async () => {
            const [usage, appTotals] = await this.#kvStore.get({ key: keys });
            const appId = actor.type?.app?.uid;
            if ( appTotals && appId ) {
                const filteredAppTotals = {};
                let othersTotal = {};
                Object.entries(appTotals).forEach(([appKey, appUsage]) => {
                    if ( appKey === appId ) {
                        filteredAppTotals[appKey] = appUsage;
                    }
                    else {
                        Object.entries(appUsage).forEach(([usageKind, amount]) => {
                            if ( ! othersTotal[usageKind] ) {
                                othersTotal[usageKind] = 0;
                            }
                            othersTotal[usageKind] += amount;
                        });
                    }
                });
                if ( othersTotal ) {
                    filteredAppTotals['others'] = othersTotal;
                }
                return {
                    usage: usage || { total: 0 },
                    appTotals: filteredAppTotals,
                };
            }
            return {
                usage: usage || { total: 0 },
                appTotals: appTotals || {},
            };
        });
    }
    async setActorCurrentMonthUsageTotal (actor, totalCost) {
        if ( ! actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to set usage details');
        }
        if ( !Number.isFinite(totalCost) || totalCost < 0 ) {
            throw new Error('Total cost must be a non-negative number');
        }
        const normalizedTotal = Math.round(totalCost);
        const currentMonth = this.#getMonthYearString();
        const userId = actor.type.user.uuid;
        const appId = actor.type?.app?.uid || GLOBAL_APP_KEY;
        return await this.#superUserService.sudo(async () => {
            const actorUsageKey = `${METRICS_PREFIX}:actor:${userId}:${currentMonth}`;
            const currentUsage = await this.#kvStore.get({ key: actorUsageKey });
            const currentTotal = currentUsage?.total ?? 0;
            const delta = normalizedTotal - currentTotal;
            if ( delta === 0 ) {
                return currentUsage || { total: 0 };
            }
            const pathAndAmountMap = {
                total: delta,
                'manual_adjustment.cost': delta,
                'manual_adjustment.units': delta,
                'manual_adjustment.count': 1,
            };
            const updatedUsage = await this.#kvStore.incr({
                key: actorUsageKey,
                pathAndAmountMap,
            });
            const puterConsumptionKey = this.#generateGloabalUsageKey(userId, appId, currentMonth);
            this.#kvStore.incr({
                key: puterConsumptionKey,
                pathAndAmountMap,
            }).catch((e) => {
                console.warn('Failed to increment aux usage data \'puterConsumptionKey\' with error: ', e);
            });
            const actorAppUsageKey = `${METRICS_PREFIX}:actor:${userId}:app:${appId}:${currentMonth}`;
            this.#kvStore.incr({
                key: actorAppUsageKey,
                pathAndAmountMap,
            }).catch((e) => {
                console.warn('Failed to increment aux usage data \'actorAppUsageKey\' with error: ', e);
            });
            const actorAppTotalsKey = `${METRICS_PREFIX}:actor:${userId}:apps:${currentMonth}`;
            this.#kvStore.incr({
                key: actorAppTotalsKey,
                pathAndAmountMap: {
                    [`${appId}.total`]: delta,
                    [`${appId}.count`]: 1,
                },
            }).catch((e) => {
                console.warn('Failed to increment aux usage data \'actorAppTotalsKey\' with error: ', e);
            });
            const lastUpdatedKey = `${METRICS_PREFIX}:actor:${userId}:lastUpdated`;
            this.#kvStore.set({
                key: lastUpdatedKey,
                value: Date.now(),
            }).catch((e) => {
                console.warn('Failed to set lastUpdatedKey with error: ', e);
            });
            return updatedUsage;
        });
    }
    async getActorCurrentMonthAppUsageDetails (actor, appId) {
        if ( ! actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get usage details');
        }
        appId = appId || actor.type?.app?.uid || GLOBAL_APP_KEY;
        const currentMonth = this.#getMonthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:app:${appId}:${currentMonth}`;
        return await this.#superUserService.sudo(async () => {
            const usage = await this.#kvStore.get({ key });
            const actorAppId = actor.type?.app?.uid;
            if ( actorAppId && actorAppId !== appId && appId !== GLOBAL_APP_KEY ) {
                throw new Error('Actor can only get usage details for their own app or global app');
            }
            return usage || { total: 0 };
        });
    }
    async getRemainingUsage (actor) {
        const allowedUsage = await this.getAllowedUsage(actor);
        return allowedUsage.remaining || 0;
    }
    async getAllowedUsage (actor) {
        const userSubscriptionPromise = this.getActorSubscription(actor);
        const userAddonsPromise = this.getActorAddons(actor);
        const currentUsagePromise = this.getActorCurrentMonthUsageDetails(actor);
        const [userSubscription, addons, currentMonthUsage] = await Promise.all([userSubscriptionPromise, userAddonsPromise, currentUsagePromise]);
        return {
            remaining: Math.max(0, (userSubscription.monthUsageAllowance || 0) + (addons?.purchasedCredits || 0) - (currentMonthUsage.usage.total || 0) - (addons?.consumedPurchaseCredits || 0)),
            monthUsageAllowance: userSubscription.monthUsageAllowance,
            addons,
        };
    }
    async hasAnyUsage (actor) {
        return (await this.getRemainingUsage(actor)) > 0;
    }
    async hasEnoughCreditsFor (actor, usageType, usageAmount) {
        const remainingUsage = await this.getRemainingUsage(actor);
        const cost = (COST_MAPS[usageType] || 0) * (usageAmount < 0 ? 1 : usageAmount);
        return remainingUsage >= cost;
    }
    async hasEnoughCredits (actor, amount) {
        const remainingUsage = await this.getRemainingUsage(actor);
        return remainingUsage >= amount;
    }
    async getActorSubscription (actor) {
        if ( ! actor.type?.user.uuid ) {
            throw new Error('Actor must be a user to get policy');
        }
        const defaultUserSubscriptionId = (actor.type.user.email ? DEFAULT_FREE_SUBSCRIPTION : DEFAULT_TEMP_SUBSCRIPTION);
        const defaultSubscriptionEvent = { actor, defaultSubscriptionId: '' };
        const availablePoliciesEvent = { actor, availablePolicies: [] };
        const userSubscriptionEvent = { actor, userSubscriptionId: '' };
        await Promise.allSettled([
            this.#eventService.emit('metering:overrideDefaultSubscription', defaultSubscriptionEvent),
            this.#eventService.emit('metering:registerAvailablePolicies', availablePoliciesEvent),
            this.#eventService.emit('metering:getUserSubscription', userSubscriptionEvent),
        ]);
        const defaultSubscriptionId = defaultSubscriptionEvent.defaultSubscriptionId || defaultUserSubscriptionId;
        const availablePolicies = [...availablePoliciesEvent.availablePolicies, ...SUB_POLICIES];
        const userSubscriptionId = userSubscriptionEvent.userSubscriptionId || defaultSubscriptionId;
        return availablePolicies.find(({ id }) => id === userSubscriptionId) || availablePolicies.find(({ id }) => id === defaultSubscriptionId);
    }
    async getActorAddons (actor) {
        if ( ! actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get policy addons');
        }
        const key = `${POLICY_PREFIX}:actor:${actor.type.user?.uuid}:addons`;
        return this.#superUserService.sudo(async () => {
            const addons = await this.#kvStore.get({ key });
            return (addons ?? {});
        });
    }
    async getActorAppUsage (actor, appId) {
        if ( ! actor.type?.user?.uuid ) {
            throw new Error('Actor must be a user to get app usage');
        }
        if ( actor.type?.app?.uid && actor.type?.app?.uid !== appId ) {
            throw new Error('Actor can only get usage for their own app');
        }
        const currentMonth = this.#getMonthYearString();
        const key = `${METRICS_PREFIX}:actor:${actor.type.user.uuid}:app:${appId}:${currentMonth}`;
        return this.#superUserService.sudo(async () => {
            const usage = await this.#kvStore.get({ key });
            return (usage ?? { total: 0 });
        });
    }
    async getGlobalUsage () {
        const currentMonth = this.#getMonthYearString();
        const keyPrefix = `${METRICS_PREFIX}:puter:`;
        return this.#superUserService.sudo(async () => {
            const keys = [];
            for ( let shard = 0; shard < MeteringService.GLOBAL_SHARD_COUNT; shard++ ) {
                keys.push(`${keyPrefix}${shard}:${currentMonth}`);
            }
            keys.push(`${keyPrefix}${currentMonth}`);
            const usages = await this.#kvStore.get({ key: keys });
            const aggregatedUsage = { total: 0 };
            usages.filter(Boolean).forEach(({ total, ...usage } = {}) => {
                aggregatedUsage.total += total || 0;
                Object.entries((usage || {})).forEach(([usageKind, record]) => {
                    if ( ! aggregatedUsage[usageKind] ) {
                        aggregatedUsage[usageKind] = { cost: 0, units: 0, count: 0 };
                    }
                    const aggregatedRecord = aggregatedUsage[usageKind];
                    aggregatedRecord.cost += record.cost;
                    aggregatedRecord.count += record.count;
                    aggregatedRecord.units += record.units;
                });
            });
            return aggregatedUsage;
        });
    }
    async updateAddonCredit (userId, tokenAmount) {
        if ( ! userId ) {
            throw new Error('User needed to update extra credits');
        }
        const key = `${POLICY_PREFIX}:actor:${userId}:addons`;
        return this.#superUserService.sudo(async () => {
            await this.#kvStore.incr({
                key,
                pathAndAmountMap: {
                    purchasedCredits: tokenAmount,
                },
            });
        });
    }
    async #checkRateOfChange () {
        const now = Date.now();
        const lastChange = await this.#superUserService.sudo(async () => {
            return this.#kvStore.get({ key: `${METRICS_PREFIX}:lastGlobalUsageCheck` });
        });
        if ( !lastChange || (now - lastChange.timestamp) > 4 * 60 * 1000 ) {
            const globalUsage = await this.getGlobalUsage();
            const currTotal = globalUsage.total;
            if ( lastChange ) {
                const timeDelta = now - lastChange.timestamp;
                const usageDelta = currTotal - lastChange.total;
                const usagePerMinute = (usageDelta / (timeDelta / 60000));
                if ( usagePerMinute > MeteringService.MAX_GLOBAL_USAGE_PER_MINUTE ) {
                    this.#alarmService.create('metering:excessiveGlobalUsageRate', `Global usage rate is excessive: ${usagePerMinute} micro-cents per minute`, {
                        usagePerMinute,
                        maxAllowedPerMinute: MeteringService.MAX_GLOBAL_USAGE_PER_MINUTE,
                    });
                }
            }
            await this.#superUserService.sudo(async () => {
                await this.#kvStore.set({
                    key: `${METRICS_PREFIX}:lastGlobalUsageCheck`,
                    value: {
                        total: currTotal,
                        timestamp: now,
                    },
                });
            });
        }
    }
}
//# sourceMappingURL=MeteringService.js.map