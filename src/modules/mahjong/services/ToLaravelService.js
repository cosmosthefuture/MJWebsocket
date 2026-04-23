import apiClient from "../../../core/services/apiClient.js";
import logger from "../../../config/logger.js";

class ToLaravelService {
  // ===== ROOM =====
  async getRoomData(roomId) {
    try {
      const res = await apiClient.get(
        `/internal/mah-jong-game-rooms/${roomId}/get-data`,
      );
      return res.data.data;
    } catch (err) {
      logger.error({
        type: "API",
        action: "GET_ROOM_DATA_FAIL",
        roomId,
        error: err.message,
      });

      throw err;
    }
  }

  // ===== MATCH =====
  async getCurrentMatch(roomId) {
    try {
      const res = await apiClient.get(
        `/internal/mah-jong-game-rooms/${roomId}/get-current-match`,
      );
      return res.data.data;
    } catch (err) {
      logger.error({
        type: "API",
        action: "GET_CURRENT_MATCH_FAIL",
        roomId,
        error: err.message,
      });

      throw err;
    }
  }

  // ===== ROUND =====
  async startRound(roomId) {
    try {
      const res = await apiClient.post(
        `/internal/mah-jong-game-rooms/${roomId}/start-round`,
      );

      return res.data.data;
    } catch (err) {
      logger.error({
        type: "API",
        action: "START_ROUND_FAIL",
        roomId,
        error: err.message,
      });

      throw err;
    }
  }

  async leaveRoom(roomId, userId) {
    try {
      const res = await apiClient.post(
        `/internal/mah-jong-game-rooms/${roomId}/leave-room`,
        {
          user_id: userId,
        },
      );

      return res.data.data;
    } catch (err) {
      logger.error({
        type: "API",
        action: "LEAVE_ROOM_FAIL",
        roomId,
        error: err.message,
      });

      throw err;
    }
  }

  async updateRoundPlayerActiveStatus(roundId, userId) {
    try {
      const res = await apiClient.post(
        `/internal/mah-jong-game-rounds/${roundId}/update-round-player-active-status`,
        {
          user_id: userId,
        },
      );
    } catch (err) {
      logger.error({
        type: "API",
        action: "Update_Round_Player_Active_Status",
        roomId,
        error: err.message,
      });

      throw err;
    }
  }

  async endRound(roundId) {
    try {
      const res = await apiClient.post(
        `/internal/mah-jong-game-rounds/${roundId}/end-round`
      );
    } catch (err) {
      logger.error({
        type: "API",
        action: "ROUND_END",
        roomId,
        error: err.message,
      });

      throw err;
    }
  }
}

export default new ToLaravelService();
