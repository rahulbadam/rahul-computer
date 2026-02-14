const { use, def } = globalThis.__puter_extension_globals__.useapi;
const { use: puter } = globalThis.__puter_extension_globals__.useapi;
const extension = globalThis.__puter_extension_globals__.extensionObjectRegistry["c2462d89-4a59-4957-ad97-4d6207a0b18b"];
const console = extension.console;
const runtime = extension.runtime;
const config = extension.config;
const registry = extension.registry;
const register = registry.register;
const global_config = globalThis.__puter_extension_globals__.global_config
import fs from 'fs/promises';
import os from 'os';
const { Controller, Get, ExtensionController } = extension.import('extensionController');

@Controller('/serverInfo', [...config.allowedUsernames])
class ServerInfoController extends ExtensionController {
    @Get('', { subdomain: 'api' })
    async getServerInfo (req, res) {
        const osData = {
            platform: os.platform(),
            type: os.type(),
            release: os.release(),
            pretty: `${os.type()} ${os.release()}`,
        };

        const cpus = os.cpus();
        const cpuData = {
            model: cpus[0]?.model || 'Unknown',
            cores: cpus.length,
        };

        const ramData = {
            total: os.totalmem(),
            free: os.freemem(),
            totalGB: (os.totalmem() / 1073741824).toFixed(2),
            freeGB: (os.freemem() / 1073741824).toFixed(2),
        };

        const uptimeSeconds = os.uptime();
        const uptimeData = {
            seconds: uptimeSeconds,
            days: Math.floor(uptimeSeconds / 86400),
            hours: Math.floor((uptimeSeconds % 86400) / 3600),
            minutes: Math.floor((uptimeSeconds % 3600) / 60),
            pretty: `${Math.floor(uptimeSeconds / 86400)}d ${Math.floor((uptimeSeconds % 86400) / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
        };

        let diskData = { total: 'N/A', free: 'N/A', used: 'N/A' };
        try {
            const stats = await fs.statfs('/');
            const totalGB = (stats.blocks * stats.bsize / 1073741824);
            const freeGB = (stats.bfree * stats.bsize / 1073741824);
            const usedGB = (totalGB - freeGB).toFixed(2);
            diskData = { total: totalGB.toFixed(2), free: freeGB.toFixed(2), used: usedGB };
        } catch ( err ) {
            console.error('Disk stats error:', err);
        }

        const response = {
            os: osData,
            cpu: cpuData,
            ram: ramData,
            uptime: uptimeData,
            disk: diskData,
            loadavg: os.loadavg(),
            hostname: os.hostname(),
        };

        res.json(response);
    }
}

(new ServerInfoController()).registerRoutes();