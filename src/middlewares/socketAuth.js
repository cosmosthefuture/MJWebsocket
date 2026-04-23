import jwt from "jsonwebtoken";
import logger from "../config/logger.js";
import env from "../config/env.js";

export default (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(" ")[1];

    if (!token) {
      throw new Error("Token missing");
    }

    // 🔥 VERIFY LOCALLY (NO API)
    const payload = jwt.verify(token, env.jwt.secret);

    // optional: check purpose
    if (payload.purpose !== "websocket") {
      throw new Error("Invalid token purpose");
    }

    // attach user
    socket.user = {
      id: payload.user_id,
      name: payload.name
    };

    socket.token = token;
    socket.tokenExp = payload.exp; // 🔥 important

    logger.info({
      type: "SOCKET",
      action: "AUTH_SUCCESS",
      userId: socket.user.id
    });

    next();

  } catch (err) {
    logger.error({
      type: "SOCKET",
      action: "AUTH_FAIL",
      error: err.message
    });

    next(new Error("invalid_or_expired_ws_token"));
  }
};