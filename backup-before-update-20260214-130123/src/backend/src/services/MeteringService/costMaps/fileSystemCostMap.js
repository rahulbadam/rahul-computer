import { toMicroCents } from '../utils.js';
export const FILE_SYSTEM_COST_MAP = {
    'filesystem:ingress:bytes': 0,
    'filesystem:delete:bytes': 0,
    'filesystem:egress:bytes': toMicroCents(0.12 / 1024 / 1024 / 1024),
    'filesystem:cached-egress:bytes': toMicroCents(0.1 / 1024 / 1024 / 1024),
};
//# sourceMappingURL=fileSystemCostMap.js.map