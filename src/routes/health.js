import express from "express";
import redis from "../config/redis.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// temporary, delete later

router.post("/state/clear/:roomId", async (req, res) => {
  try {
    const ROOM_KEY = (roomId) => `room:${roomId}`;
    const MATCH_KEY = (roomId) => `room:${roomId}:match`;
    const ROUND_KEY = (roomId) => `room:${roomId}:round`;

    const PLAYERS_KEY = (roomId) => `room:${roomId}:players`;
    const ROUND_PLAYERS_KEY = (roomId) => `room:${roomId}:round_players`;
    const GUESTS_KEY = (roomId) => `room:${roomId}:guests`;

    const PLAYER_ROOM_KEY = (userId) => `player:${userId}`;

    const ROOM_STATUS_KEY = (roomId) => `room:${roomId}:status`;
    const ROOM_PLAYING_PHASE_KEY = (roomId) => `room:${roomId}:phase`;
    const PLAYING_PHASE_WITH_TILE_KEY = (roomId) =>
      `room:${roomId}:playing_phase_with_tile`;
    const COUNTDOWN_KEY = (roomId) => `room:${roomId}:countdown_end`;

    const ROOM_DICE_KEY = (roomId) => `room:${roomId}:dice`;
    const ROOM_FIRST_PLAYER_KEY = (roomId) => `room:${roomId}:first_player`;

    const WALL_KEY = (roomId) => `room:${roomId}:round:wall`;

    const HAND_KEY = (roomId, userId) => `room:${roomId}:round:hand:${userId}`;

    const DISCARD_KEY = (roomId) => `room:${roomId}:round:discards`;

    const PLAYER_DISCARD_TILES_KEY = (roomId, userId) =>
      `room:${roomId}:round:discard_tiles:${userId}`;

    const LAST_DISCARD_KEY = (roomId) => `room:${roomId}:round:last_discard`;

    const DISCARD_REACTION_KEY = (roomId) =>
      `room:${roomId}:round:discard_reaction`;

    const PLAYER_VIEW_HAND_KEY = (roomId, userId) =>
      `room:${roomId}:round:player_view_hand:${userId}`;

    const CHOW_KEY = (roomId, userId) =>
      `mahjong:${roomId}:player:${userId}:chow`;

    const PONG_KEY = (roomId, userId) =>
      `mahjong:${roomId}:player:${userId}:pong`;

    const KONG_KEY = (roomId, userId) =>
      `mahjong:${roomId}:player:${userId}:kong`;

    const CURRENT_TURN_PLAYER_KEY = (roomId) =>
      `mahjong:room:${roomId}:current_turn_player`;

    const TURN_COUNTDOWN_END_KEY = (roomId) =>
      `mahjong:room:${roomId}:turn_countdown_end`;

    const DRAW_STATUS_KEY = (roomId) => `mahjong:room:${roomId}:draw`;

    const WINNING_DATA_KEY = (roomId) =>
      `mahjong:room:${roomId}:winning_data`;

    const { roomId } = req.params;
    const players = await redis.hgetall(PLAYERS_KEY(roomId));

    const userIds = Object.values(players).map((p) => JSON.parse(p).userId);

    const guestUsers = await redis.hgetall(GUESTS_KEY(roomId));

    const guestIds = Object.values(guestUsers).map((g) => JSON.parse(g).userId);

    const allUsers = [...userIds, ...guestIds];

    /**
     * remove player -> room mapping
     */
    await Promise.all(
      allUsers.map((userId) => redis.del(PLAYER_ROOM_KEY(userId))),
    );

    /**
     * =====================================
     * Get round players
     * =====================================
     */
    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const roundPlayers = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    /**
     * =====================================
     * Delete per-player keys
     * =====================================
     */
    for (const player of roundPlayers) {
      const userId = player.userId;

      await Promise.all([
        redis.del(HAND_KEY(roomId, userId)),
        redis.del(PLAYER_VIEW_HAND_KEY(roomId, userId)),
        redis.del(CHOW_KEY(roomId, userId)),
        redis.del(PONG_KEY(roomId, userId)),
        redis.del(KONG_KEY(roomId, userId)),
        redis.del(PLAYER_DISCARD_TILES_KEY(roomId, userId)),
      ]);
    }

    /**
     * =====================================
     * Delete room-level keys
     * =====================================
     */
    await Promise.all([
      redis.del(ROOM_KEY(roomId)),
      redis.del(MATCH_KEY(roomId)),
      redis.del(ROUND_KEY(roomId)),

      redis.del(PLAYERS_KEY(roomId)),
      redis.del(ROUND_PLAYERS_KEY(roomId)),
      redis.del(GUESTS_KEY(roomId)),

      redis.del(ROOM_STATUS_KEY(roomId)),
      redis.del(ROOM_PLAYING_PHASE_KEY(roomId)),
      redis.del(PLAYING_PHASE_WITH_TILE_KEY(roomId)),

      redis.del(COUNTDOWN_KEY(roomId)),
      redis.del(TURN_COUNTDOWN_END_KEY(roomId)),

      redis.del(ROOM_DICE_KEY(roomId)),
      redis.del(ROOM_FIRST_PLAYER_KEY(roomId)),

      redis.del(WALL_KEY(roomId)),
      redis.del(DISCARD_KEY(roomId)),
      redis.del(LAST_DISCARD_KEY(roomId)),
      redis.del(DISCARD_REACTION_KEY(roomId)),

      redis.del(CURRENT_TURN_PLAYER_KEY(roomId)),

      redis.del(WINNING_DATA_KEY(roomId)),
      redis.del(DRAW_STATUS_KEY(roomId)),
    ]);
    return res.status(200).json({
        status: "success",
        message: "clear all states"
    })
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

export default router;
