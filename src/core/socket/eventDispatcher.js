import logger from "../../config/logger.js";
import mahjongEvents from "../../modules/mahjong/index.js";

class EventDispatcher {
  constructor() {
    this.events = {
      ...mahjongEvents,

      "ping": this.ping,
    };
  }

  dispatch(socket, event, payload, io) {
    try {
      logger.info({
        type: "SOCKET",
        action: "EVENT_RECEIVED",
        event,
        userId: socket.user?.id,
        socketId: socket.id,
        payload,
      });

      const handler = this.events[event];

      if (!handler) {
        logger.warn({
          type: "SOCKET",
          action: "UNKNOWN_EVENT",
          event,
        });
        return;
      }

      handler(socket, payload, io);

    } catch (err) {
      logger.error({
        type: "SOCKET",
        action: "EVENT_ERROR",
        event,
        userId: socket.user?.id,
        socketId: socket.id,
        error: err.message,
      });

      socket.emit("error", { message: err.message });
    }
  }

  ping(socket) {
    socket.emit("pong", { message: "pong from server" });
  }
}

export default new EventDispatcher();