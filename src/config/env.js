function parseArray(value) {
  if (!value) return [];
  return value.split(",").map((item) => item.trim());
}

const env = {
  app: {
    port: Number(process.env.PORT) || 3000,
    env: process.env.APP_ENV || "local",
    isProduction: process.env.APP_ENV === "production",
  },

  api: {
    baseUrl: process.env.LARAVEL_API_URL,
    internalKey: process.env.LARAVEL_API_INTERNAL_KEY
  },

  socket: {
    secret: process.env.SOCKET_SECRET,
    corsOrigins: parseArray(process.env.SOCKET_CORS_ORIGINS)
  },

  jwt: {
    secret: process.env.JWT_SECRET_KEY
  },

  cors: {
    origins: parseArray(process.env.CORS_ORIGINS),
  },

  log: {
    level: process.env.LOG_LEVEL || "info",
  },
};

/**
 * 🔥 Validation (fail fast)
 */
function validateEnv(config) {
  const errors = [];

  if (!config.api.baseUrl) {
    errors.push("LARAVEL_API_URL is required");
  }

  if (!config.socket.secret) {
    errors.push("SOCKET_SECRET is required");
  }

  if (!config.app.port) {
    errors.push("PORT is required");
  }

  if (errors.length > 0) {
    console.error("❌ ENV VALIDATION FAILED:");
    errors.forEach((err) => console.error(`- ${err}`));
    process.exit(1); // stop app immediately
  }
}

validateEnv(env);

/**
 * 🔒 Freeze to prevent modification
 */
export default Object.freeze(env);
