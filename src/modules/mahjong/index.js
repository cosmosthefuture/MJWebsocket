import EVENTS from "./constants/events.js";
import joinRoom from "./events/joinRoom.js";
import leaveRoom from "./events/leaveRoom.js";

export default {
  [EVENTS.JOIN_ROOM]: joinRoom,
  [EVENTS.LEAVE_ROOM]: leaveRoom,
};