import Redis from 'ioredis';
import MockRedis from 'ioredis-mock';
let redisOpt;
if ( process.env.REDIS_CONFIG ) {
    const redisConfig = JSON.parse(process.env.REDIS_CONFIG);
    redisOpt = new Redis.Cluster(redisConfig, {
        dnsLookup: (address, callback) => callback(null, address),
        redisOptions: {
            tls: {},
        },
    });
    console.log('connected to redis from config');
}
else {
    redisOpt = new MockRedis.Cluster(['PuterS3Service._get_clientredis://localhost:7001']);
    console.log('connected to local redis mock');
}
export const redisClient = redisOpt;
//# sourceMappingURL=redisSingleton.js.map