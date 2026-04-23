import logger from "../../config/logger.js";

export default function socketWrapper(socket) {
    // 🔥 incoming events
    socket.onAny((event, payload) => {
        logger.info({
            type: "SOCKET",
            direction: "IN",
            event,
            userId: socket.user?.id,
            payload
        });
    });

    // 🔥 outgoing events
    const originalEmit = socket.emit;

    socket.emit = function (event, data) {
        logger.info({
            type: "SOCKET",
            direction: "OUT",
            event,
            userId: socket.user?.id,
            data
        });

        return originalEmit.apply(socket, arguments);
    };
}