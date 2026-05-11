import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),

  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,

  tls: {},

  maxRetriesPerRequest: null,

  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },

  reconnectOnError() {
    return true;
  },
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("❌ Redis error:", err));

export default redis;