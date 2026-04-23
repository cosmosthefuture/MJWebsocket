import MahJongRoomManager from "../room/MahJongRoomManager.js";
import EVENTS from "../constants/events.js";
import log from "../logs/mahjong.logger.js";

export default async function (socket, payload, io) {
  try {
    const userId = socket.user.id;

    await MahJongRoomManager.leaveRoom(userId, socket, io);
    // if (!roomId) return;

    // socket.leave(`mahjong:${roomId}`);
    // socket.mahjongRoomId = null;

    // socket.to(`mahjong:${roomId}`).emit(EVENTS.PLAYER_LEFT, {
    //   userId,
    // });

    // log.info({ action: "LEAVE_ROOM", userId, roomId });

  } catch (err) {
    socket.emit(EVENTS.ERROR, { message: err.message });

    log.error({ action: "LEAVE_ROOM_FAIL", error: err.message });
  }
}