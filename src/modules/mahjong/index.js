import EVENTS from "./constants/events.js";
import joinRoom from "./events/joinRoom.js";
import leaveRoom from "./events/leaveRoom.js";
import MahJongRoomManager from "./room/MahJongRoomManager.js";

export default {
  [EVENTS.JOIN_ROOM]: joinRoom,
  [EVENTS.LEAVE_ROOM]: leaveRoom,
  [EVENTS.SORT_HAND]: MahJongRoomManager.sortHand,
  [EVENTS.DISCARD_TILE]: MahJongRoomManager.discardTile,
  [EVENTS.ACCEPT_KONG]: MahJongRoomManager.acceptKong,
  [EVENTS.PASS_KONG]: MahJongRoomManager.passKong,
  [EVENTS.ACCEPT_INTERRUPT_KONG]: MahJongRoomManager.acceptInterruptKong,
  [EVENTS.ACCEPT_INTERRUPT_PONG]: MahJongRoomManager.acceptInterruptPong,
  [EVENTS.ACCEPT_NORMAL_KONG]: MahJongRoomManager.acceptNormalKong,
  [EVENTS.PASS_NORMAL_KONG]: MahJongRoomManager.passNormalKong,
  [EVENTS.ACCEPT_NORMAL_PONG]: MahJongRoomManager.acceptNormalPong,
  [EVENTS.PASS_NORMAL_PONG]: MahJongRoomManager.passNormalPong,
  // REMOVED: ACCEPT_NORMAL_CHOW and PASS_NORMAL_CHOW (no chow from discard in Loukkai Mahjong)
  [EVENTS.ACCEPT_WIN]: MahJongRoomManager.acceptWin,
  [EVENTS.PASS_WIN]: MahJongRoomManager.passWin,
  [EVENTS.TAKE_SHOWN_TILE]: MahJongRoomManager.takeShownTile
};
