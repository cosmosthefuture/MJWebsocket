import eventDispatcher from "./eventDispatcher.js";
import socketWrapper from "./socketWrapper.js";
import tokenManager from "./tokenManager.js";
import authService from "../services/authService.js";
import logger from "../../config/logger.js";
import jwt from "jsonwebtoken";
import env from "../../config/env.js";

class SocketManager {
  init(io) {
    io.on("connection", (socket) => {
      logger.info({
        type: "SOCKET",
        action: "CONNECTED",
        userId: socket.user?.id,
        socketId: socket.id,
      });

      // 🔥 logging wrapper
      socketWrapper(socket);

      // 🔥 start refresh scheduler
      tokenManager.start(socket);

      // 🔥 handle refresh from client
      socket.on("ws:refresh", ({ token }) => {
        try {
          const payload = jwt.verify(token, env.jwt.secret);

          if (payload.purpose !== "websocket") {
            throw new Error("Invalid token purpose");
          }

          socket.user = {
            id: payload.user_id,
            name: payload.name,
          };
          socket.token = token;
          socket.tokenExp = payload.exp;

          logger.info({
            type: "SOCKET",
            action: "TOKEN_REFRESH_SUCCESS",
            userId: socket.user.id,
          });

          tokenManager.start(socket);
        } catch (err) {
          logger.error({
            type: "SOCKET",
            action: "TOKEN_REFRESH_FAIL",
            error: err.message,
          });

          socket.emit("ws:refresh_failed");
          socket.disconnect();
        }
      });

      // 🔥 all events
      socket.onAny((event, payload) => {
        eventDispatcher.dispatch(socket, event, payload, io);
      });

      // 🔌 disconnect
      socket.on("disconnect", (reason) => {
        logger.info({
          type: "SOCKET",
          action: "DISCONNECTED",
          userId: socket.user?.id,
          socketId: socket.id,
          reason,
        });
      });
    });
  }
}

export default new SocketManager();
