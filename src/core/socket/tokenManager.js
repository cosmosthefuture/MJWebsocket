import logger from "../../config/logger.js";

const REFRESH_BEFORE_MS = 30 * 1000; // 30 seconds before expiry

class TokenManager {
  /**
   * Start token lifecycle for a socket
   */
  start(socket) {
    this.clear(socket);
    this.schedule(socket);
  }

  /**
   * Schedule refresh event before token expires
   */
  schedule(socket) {
    try {
      if (!socket.tokenExp) {
        throw new Error("Missing tokenExp on socket");
      }

      const now = Date.now();
      const expiryMs = socket.tokenExp * 1000;
      const ttlMs = expiryMs - now;

      // token already expired
      if (ttlMs <= 0) {
        logger.warn({
          type: "SOCKET",
          action: "TOKEN_ALREADY_EXPIRED",
          userId: socket.user?.id,
          socketId: socket.id
        });

        socket.emit("ws:refresh_required");
        return;
      }

      // schedule refresh before expiry
      const timeout = Math.max(ttlMs - REFRESH_BEFORE_MS, 0);

      socket.refreshTimer = setTimeout(() => {
        logger.info({
          type: "SOCKET",
          action: "TOKEN_REFRESH_REQUIRED",
          userId: socket.user?.id,
          socketId: socket.id
        });

        socket.emit("ws:refresh_required");
      }, timeout);

      logger.info({
        type: "SOCKET",
        action: "TOKEN_SCHEDULED",
        userId: socket.user?.id,
        socketId: socket.id,
        expiresInMs: ttlMs,
        refreshInMs: timeout
      });

    } catch (err) {
      logger.error({
        type: "SOCKET",
        action: "TOKEN_SCHEDULE_ERROR",
        error: err.message,
        socketId: socket.id
      });

      socket.emit("ws:refresh_failed");
      socket.disconnect();
    }
  }

  /**
   * Clear existing timer
   */
  clear(socket) {
    if (socket.refreshTimer) {
      clearTimeout(socket.refreshTimer);
      socket.refreshTimer = null;

      logger.info({
        type: "SOCKET",
        action: "TOKEN_TIMER_CLEARED",
        socketId: socket.id
      });
    }
  }
}

export default new TokenManager();