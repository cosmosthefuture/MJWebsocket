// import MahJongRoomManager from "../room/MahJongRoomManager.js";
// import EVENTS from "../constants/events.js";
// import log from "../logs/mahjong.logger.js";
// import env from "../../../config/env.js";
// import jwt from "jsonwebtoken";

// const SOCKET_ROOM = (roomId) => `mahjong:${roomId}`;

// export default async function (socket, payload, io) {
//   try {
//     const { roomId, token } = payload;
//     // 🔥 VERIFY TOKEN
//     const decoded = jwt.verify(token, env.jwt.secret);

//     if (decoded.purpose !== "mahjong_join") {
//       throw new Error("Invalid token purpose");
//     }

//     if (decoded.room_id !== roomId) {
//       throw new Error("Room mismatch");
//     }

//     if (decoded.user_id !== socket.user.id) {
//       throw new Error("User mismatch");
//     }

//     const user = socket.user;

//     await MahJongRoomManager.joinRoom({
//       roomId,
//       user,
//       io,
//       socket,
//     });

//     socket.mahjongRoomId = roomId;

//     // cleanup on disconnect
//     if (!socket._mjCleanup) {
//       socket.on("disconnect", async () => {
//         const userId = socket.user?.id;
//         const roomId = socket.mahjongRoomId;

//         if (!userId || !roomId) return;

//         await MahJongRoomManager.leaveRoom(userId, io);
//       });

//       socket._mjCleanup = true;
//     }

//     const state = await MahJongRoomManager.getState(roomId);

//     socket.emit(EVENTS.JOIN_SUCCESS, state);

//     log.info({ action: "JOIN_ROOM", userId: user.id, roomId });
//   } catch (err) {
//     socket.emit(EVENTS.ERROR, { message: err.message });

//     log.error({ action: "JOIN_ROOM_FAIL", error: err.message });
//   }
// }



import MahJongRoomManager from "../room/MahJongRoomManager.js";
import EVENTS from "../constants/events.js";
import log from "../logs/mahjong.logger.js";
import env from "../../../config/env.js";
import jwt from "jsonwebtoken";

export default async function (socket, payload, io) {
  try {
    const { roomId, token } = payload;

    // ===== VERIFY TOKEN =====
    const decoded = jwt.verify(token, env.jwt.secret);

    if (decoded.purpose !== "mahjong_join") {
      throw new Error("Invalid token purpose");
    }

    if (decoded.room_id !== roomId) {
      throw new Error("Room mismatch");
    }

    if (decoded.user_id !== socket.user.id) {
      throw new Error("User mismatch");
    }

    const user = socket.user;

    await MahJongRoomManager.joinRoom({ roomId, user, socket, io });

    socket.mahjongRoomId = roomId;

    // ===== DISCONNECT =====
    if (!socket._mjCleanup) {
      socket.on("disconnect", async () => {
        const userId = socket.user?.id;
        const roomId = socket.mahjongRoomId;

        if (!userId || !roomId) return;

        await MahJongRoomManager.leaveRoom(userId, socket, io);
      });

      socket._mjCleanup = true;
    }

    // const state = await MahJongRoomManager.getState(roomId);

    // socket.emit(EVENTS.JOIN_SUCCESS, state);

    log.info({ action: "JOIN_ROOM", userId: user.id, roomId });
  } catch (err) {
    socket.emit(EVENTS.ERROR, { message: err.message });
    log.error({ action: "JOIN_ROOM_FAIL", error: err.message });
  }
}
