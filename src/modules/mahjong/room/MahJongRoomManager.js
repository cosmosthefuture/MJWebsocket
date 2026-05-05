import redis from "../../../config/redis.js";
import events from "../constants/events.js";
import ToLaravelService from "../services/ToLaravelService.js";
import roomMemoryStore from "../state/MahJongState.js";

const SOCKET_ROOM = (roomId) => `mahjong:${roomId}`;

// ===== KEYS =====
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

const CHOW_KEY = (roomId, userId) => `mahjong:${roomId}:player:${userId}:chow`;

const PONG_KEY = (roomId, userId) => `mahjong:${roomId}:player:${userId}:pong`;

const KONG_KEY = (roomId, userId) => `mahjong:${roomId}:player:${userId}:kong`;

const CURRENT_TURN_PLAYER_KEY = (roomId) =>
  `mahjong:room:${roomId}:current_turn_player`;

const TURN_COUNTDOWN_END_KEY = (roomId) =>
  `mahjong:room:${roomId}:turn_countdown_end`;

export const WINNING_DATA_KEY = (roomId) =>
  `mahjong:room:${roomId}:winning_data`;

export default class MahJongRoomManager {
  static async joinRoom({ roomId, user, socket, io }) {
    const { id: userId, name } = user;

    const existingRoom = await redis.get(PLAYER_ROOM_KEY(userId));
    if (existingRoom && existingRoom !== String(roomId)) {
      throw new Error("Already in another room");
    }

    const room = await this.ensureRoom(roomId);
    const match = await this.ensureMatch(roomId);

    if (room && match && !roomMemoryStore.has(roomId)) {
      await this.recoverRoomState(roomId, user, socket, io);
    } else {
      const playerCount = await redis.hlen(PLAYERS_KEY(roomId));
      if (playerCount >= 4) {
        throw new Error("Room full");
      }

      // ===== add to room players =====
      const player = { userId, name };
      await redis.hset(PLAYERS_KEY(roomId), userId, JSON.stringify(player));
      await redis.set(PLAYER_ROOM_KEY(userId), roomId);

      socket.join(SOCKET_ROOM(roomId));
      socket.join(`user:${userId}`);

      const status = await redis.get(ROOM_STATUS_KEY(roomId));

      if (status === "playing") {
        const roundPlayerRaw = await redis.hget(
          ROUND_PLAYERS_KEY(roomId),
          userId,
        );

        if (roundPlayerRaw) {
          const roundPlayer = JSON.parse(roundPlayerRaw);

          roundPlayer.is_active = true;
          roundPlayer.is_auto = false;

          await redis.hset(
            ROUND_PLAYERS_KEY(roomId),
            userId,
            JSON.stringify(roundPlayer),
          );

          // update that user status to backend
          const round = await redis.get(ROUND_KEY(roomId));
          const roundData = JSON.parse(round);

          await ToLaravelService.updateRoundPlayerActiveStatus(
            roundData.roundId,
            userId,
          );

          // notify frontend
          const roundPlayers = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

          io.to(SOCKET_ROOM(roomId)).emit(
            "mahjong:update_round_players",
            Object.values(roundPlayers).map(JSON.parse),
          );
        } else {
          // 👉 guest
          await redis.hset(GUESTS_KEY(roomId), userId, JSON.stringify(player));
          socket.emit("mahjong:joined_as_guest");
        }

        const state = await this.getState(roomId, userId);
        socket.emit(events.JOIN_SUCCESS, state);

        const players = await redis.hgetall(PLAYERS_KEY(roomId));
        const playerList = Object.values(players).map(JSON.parse);

        const guests = await redis.hgetall(GUESTS_KEY(roomId));
        const guestList = Object.values(guests).map(JSON.parse);

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:update_players", playerList);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:update_guests", guestList);

        const phase = await redis.get(ROOM_PLAYING_PHASE_KEY(roomId));
        if (phase == "dice_rolling") {
          socket.emit("mahjong:start_rolling_dice");
        } else if (phase == "dice_rolling_end") {
          const diceRaw = await redis.get(ROOM_DICE_KEY(roomId));

          if (diceRaw) {
            const { d1, d2, total } = JSON.parse(diceRaw);

            socket.emit("mahjong:dice_rolled", {
              dice: [d1, d2],
              total,
            });
          }
        } else if (phase == "user_to_play_first_selected") {
          const firstPlayerRaw = await redis.get(ROOM_FIRST_PLAYER_KEY(roomId));
          const firstPlayer = JSON.parse(firstPlayerRaw);
          socket.emit("mahjong:user_to_play", {
            user_id: firstPlayer.user_id,
            user_name: firstPlayer.user_name,
          });
        } else if (phase == "shuffling_tiles") {
          io.to(SOCKET_ROOM(roomId)).emit("mahjong:start_shuffling");
        } else if (phase == "dealing_tiles") {
          const wallCount = await redis.llen(WALL_KEY(roomId));

          socket.emit("mahjong:wall_count_updated", {
            wallCount,
          });

          const hand_state = await redis.get(
            PLAYER_VIEW_HAND_KEY(roomId, userId),
          );
          if (hand_state) {
            io.to(`user:${userId}`).emit(
              "mahjong:initial_hand_state",
              JSON.parse(hand_state),
            );
          }
        } else if (phase == "round_end") {
          socket.emit("mahjong:round_end");
        }
      } else if (status === "countdown") {
        const state = await this.getState(roomId, userId);
        socket.emit(events.JOIN_SUCCESS, state);

        const players = await redis.hgetall(PLAYERS_KEY(roomId));
        const playerList = Object.values(players).map(JSON.parse);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:update_players", playerList);

        // 👉 sync countdown only
        await this.syncCountdown(socket, roomId);
      } else {
        // 👉 waiting
        await this.tryStartRound(roomId, io, socket, userId);
      }
    }

    // io.to(SOCKET_ROOM(roomId)).emit(events.PLAYER_JOINED, player);
  }

  static async leaveRoom(userId, socket, io) {
    const roomId = await redis.get(PLAYER_ROOM_KEY(userId));
    if (!roomId) return;

    // ===== ALWAYS REMOVE FROM LOBBY & GUEST =====
    await redis.hdel(PLAYERS_KEY(roomId), userId);
    await redis.hdel(GUESTS_KEY(roomId), userId);
    socket.leave(`mahjong:${roomId}`);
    socket.leave(`user:${userId}`);

    await ToLaravelService.leaveRoom(roomId, userId);

    // ===== CHECK ROUND PLAYER =====
    const roundPlayerRaw = await redis.hget(ROUND_PLAYERS_KEY(roomId), userId);

    if (roundPlayerRaw) {
      // 🔥 DO NOT DELETE → mark inactive + auto
      const roundPlayer = JSON.parse(roundPlayerRaw);

      roundPlayer.is_active = false;
      roundPlayer.is_auto = true;

      await redis.hset(
        ROUND_PLAYERS_KEY(roomId),
        userId,
        JSON.stringify(roundPlayer),
      );

      // notify frontend
      const roundPlayers = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

      io.to(SOCKET_ROOM(roomId)).emit(
        "mahjong:update_round_players",
        Object.values(roundPlayers).map(JSON.parse),
      );
    }

    // ===== EMIT PLAYER LEFT (for lobby UI) =====
    io.to(SOCKET_ROOM(roomId)).emit(events.PLAYER_LEFT, { userId });

    // ===== UPDATE PLAYERS LIST =====
    const players = await redis.hgetall(PLAYERS_KEY(roomId));
    io.to(SOCKET_ROOM(roomId)).emit(
      "mahjong:update_players",
      Object.values(players).map(JSON.parse),
    );

    // ===== UPDATE GUESTS LIST =====
    const guests = await redis.hgetall(GUESTS_KEY(roomId));
    io.to(SOCKET_ROOM(roomId)).emit(
      "mahjong:update_guests",
      Object.values(guests).map(JSON.parse),
    );

    // ===== CLEAN USER ROOM =====
    await redis.del(PLAYER_ROOM_KEY(userId));
  }

  // ================= ENSURE ROOM =================
  static async ensureRoom(roomId) {
    const exists = await redis.exists(ROOM_KEY(roomId));

    if (!exists) {
      const data = await ToLaravelService.getRoomData(roomId);
      await redis.set(
        ROOM_KEY(roomId),
        JSON.stringify({
          roomId,
          roomName: data.room_name,
          roomCode: data.room_code,
          maxPlayers: 4,
          roundQtyPerMatch: data.round_qty_per_match,
        }),
      );

      roomMemoryStore.set(roomId, data);
    }
    return exists;
  }

  // ================= ENSURE MATCH =================
  static async ensureMatch(roomId) {
    const match = await redis.get(MATCH_KEY(roomId));

    if (!match) {
      const data = await ToLaravelService.getCurrentMatch(roomId);

      await redis.set(
        MATCH_KEY(roomId),
        JSON.stringify({
          matchId: data.match_id,
          totalRounds: data.total_rounds,
          currentRoundId: data.current_round_id,
          status: data.status,
        }),
      );
    }
    return match;
  }

  // ================= TRY START ROUND =================
  static async tryStartRound(roomId, io, socket, userId) {
    const status = await redis.get(ROOM_STATUS_KEY(roomId));

    if (status && status !== "waiting") return;

    const state = await this.getState(roomId, userId);
    socket.emit(events.JOIN_SUCCESS, state);

    const players = await redis.hgetall(PLAYERS_KEY(roomId));
    const playerList = Object.values(players).map(JSON.parse);

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:update_players", playerList);

    if (playerList.length < 2) {
      await redis.set(ROOM_STATUS_KEY(roomId), "waiting");
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:waiting_for_players");
      return;
    }

    const exists = await redis.exists(COUNTDOWN_KEY(roomId));
    if (exists) return;

    await this.startCountdown(socket, roomId, io);
  }

  static async startCountdown(socket, roomId, io) {
    const now = Date.now();
    const endTime = now + 15000;

    const lock = await redis.set(
      COUNTDOWN_KEY(roomId),
      endTime,
      "NX",
      "PX",
      20000,
    );

    if (!lock) return;

    await redis.set(ROOM_STATUS_KEY(roomId), "countdown");

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:countdown_started");

    this.runCountdown(socket, roomId, endTime, io);
  }

  static runCountdown(socket, roomId, endTime, io) {
    const interval = setInterval(async () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
      const count = await redis.hlen(PLAYERS_KEY(roomId));

      // ❌ cancel if not enough players
      if (count < 2) {
        clearInterval(interval);

        await redis.del(COUNTDOWN_KEY(roomId));
        await redis.set(ROOM_STATUS_KEY(roomId), "waiting");

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:countdown_cancelled");
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:waiting_for_players");
        return;
      }

      io.to(SOCKET_ROOM(roomId)).emit("mahjong:countdown", { remaining });

      if (remaining <= 0) {
        clearInterval(interval);

        await redis.del(COUNTDOWN_KEY(roomId));

        const players = await redis.hgetall(PLAYERS_KEY(roomId));
        const playerList = Object.values(players).map(JSON.parse);

        if (playerList.length < 2) {
          await redis.set(ROOM_STATUS_KEY(roomId), "waiting");
          io.to(SOCKET_ROOM(roomId)).emit("mahjong:waiting_for_players");
          return;
        }

        await this.startRound(socket, roomId, io);
      }
    }, 1000);
  }

  static async syncCountdown(socket, roomId) {
    const endTime = await redis.get(COUNTDOWN_KEY(roomId));
    if (!endTime) return;

    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

    if (remaining > 0) {
      socket.emit("mahjong:countdown", { remaining });
    }
  }

  // ================= START ROUND =================
  static async startRound(socket, roomId, io) {
    await redis.set(ROOM_STATUS_KEY(roomId), "playing");
    // await this.wait(10000);
    // call backend
    const data = await ToLaravelService.startRound(roomId);

    await redis.set(
      ROUND_KEY(roomId),
      JSON.stringify({
        roundId: data.round_id,
      }),
    );

    // assign round players (max 4)
    await redis.del(ROUND_PLAYERS_KEY(roomId));

    for (const p of data.players) {
      const player = {
        userId: p.user_id,
        name: p.name,
        seat: p.seat_position,
        is_active: true,
        is_auto: false,
      };

      await redis.hset(
        ROUND_PLAYERS_KEY(roomId),
        p.user_id,
        JSON.stringify(player),
      );
    }

    const roundPlayers = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));
    const roundPlayerList = Object.values(roundPlayers).map(JSON.parse);

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:round_started", data);
    io.to(SOCKET_ROOM(roomId)).emit(
      "mahjong:update_round_players",
      roundPlayerList,
    );

    await this.rollDice(socket, roomId, data.players, io);
  }

  // ================= DICE =================
  static async rollDice(socket, roomId, roundPlayers, io) {
    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "dice_rolling");
    io.to(SOCKET_ROOM(roomId)).emit("mahjong:start_rolling_dice");

    await this.wait(5000);

    const sorted = [...roundPlayers].sort(
      (a, b) => a.seat_position - b.seat_position,
    );

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    await redis.set(ROOM_DICE_KEY(roomId), JSON.stringify({ d1, d2, total }));

    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "dice_rolling_end");
    io.to(SOCKET_ROOM(roomId)).emit("mahjong:dice_rolled", {
      dice: [d1, d2],
      total,
    });

    await this.wait(2000);

    const index = (total - 1) % sorted.length;
    const user_to_play_first = sorted[index];

    await redis.set(
      ROOM_FIRST_PLAYER_KEY(roomId),
      JSON.stringify({
        user_id: user_to_play_first.user_id,
        user_name: user_to_play_first.name,
      }),
    );

    await redis.set(
      ROOM_PLAYING_PHASE_KEY(roomId),
      "user_to_play_first_selected",
    );

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play", {
      user_id: user_to_play_first.user_id,
      user_name: user_to_play_first.name,
    });

    await this.shuffleAndDealTiles(
      socket,
      roomId,
      user_to_play_first.user_id,
      io,
    );

    await redis.set(
      PLAYING_PHASE_WITH_TILE_KEY(roomId),
      "playing_game_with_tile",
    );

    // this temporary round end codes // might delete later
    // await this.wait(120000);
    // await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "round_end");
    // const round = await redis.get(ROUND_KEY(roomId));
    // const roundData = JSON.parse(round);
    // await ToLaravelService.endRound(roundData.roundId);
    // io.to(SOCKET_ROOM(roomId)).emit("mahjong:round_end");
    // await this.wait(5000);
    // await this.clearRoomData(roomId, io);
  }

  // ================= SHUFFLE and DEAL =================
  static async shuffleAndDealTiles(socket, roomId, firstPlayerId, io) {
    const round = await redis.get(ROUND_KEY(roomId));
    const roundData = JSON.parse(round);

    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "shuffling_tiles");

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:start_shuffling");

    // 1. Get shuffled full tile objects from backend
    const tiles = await ToLaravelService.getShuffledTiles(roundData.roundId);

    await this.wait(5000);

    // 2. Clear old wall and store shuffled wall
    await redis.del(WALL_KEY(roomId));

    for (const tile of tiles) {
      await redis.rpush(WALL_KEY(roomId), JSON.stringify(tile));
    }

    // 3. Get round players ordered by seat
    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    // console.log("PLAYERS:: ", players)
    // 4. Clear old hands + old player view hands
    for (const player of players) {
      await redis.del(HAND_KEY(roomId, player.userId));

      await redis.del(PLAYER_VIEW_HAND_KEY(roomId, player.userId));
    }

    // 5. Deal 13 tiles round-robin
    for (let i = 0; i < 13; i++) {
      for (const player of players) {
        const tile = await redis.lpop(WALL_KEY(roomId));

        await redis.rpush(HAND_KEY(roomId, player.userId), tile);
      }
    }

    // 6. Give 14th tile to first player
    const extraTile = await redis.lpop(WALL_KEY(roomId));

    await redis.rpush(HAND_KEY(roomId, firstPlayerId), extraTile);

    const wallCount = await redis.llen(WALL_KEY(roomId));

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
      wallCount,
    });

    // 7. Reset discard
    await redis.del(DISCARD_KEY(roomId));
    await redis.del(LAST_DISCARD_KEY(roomId));

    // =================================================
    // 8. Build + Store + Send player-specific hand state
    // =================================================

    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "dealing_tiles");
    io.to(SOCKET_ROOM(roomId)).emit("mahjong:dealing_tiles");
    // temp waiting. might delete later
    // await this.wait(5000);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawTiles.map((tile) => JSON.parse(tile));

        // Own hand → actual tiles
        if (currentPlayer.userId === targetPlayer.userId) {
          handState.push({
            last_discard_tile: null,
            pong: null,
            chow: null,
            kong: null,
            discarded_tiles: null,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        }

        // Other players → hidden tiles
        else {
          handState.push({
            last_discard_tile: null,
            pong: null,
            chow: null,
            kong: null,
            discarded_tiles: null,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      // Store full player view in Redis
      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      // Send to user's private room
      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    const firstPlayerRaw = await redis.get(ROOM_FIRST_PLAYER_KEY(roomId));
    const firstPlayer = JSON.parse(firstPlayerRaw);
    await this.startPlayerTurn(socket, roomId, firstPlayer.user_id, io);
  }

  static async startPlayerTurn(socket, roomId, userId, io) {
    await redis.set(CURRENT_TURN_PLAYER_KEY(roomId), userId);

    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "waiting_discard");

    // temporary codes. delete later
    // const testTiles = [
    //   // ===== KONG (4 same tiles) =====
    //   {
    //     id: 8881,
    //     type: "bamboo",
    //     number: 1,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 8882,
    //     type: "bamboo",
    //     number: 1,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 8883,
    //     type: "bamboo",
    //     number: 1,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 8884,
    //     type: "bamboo",
    //     number: 1,
    //     copy_no: 4,
    //   },

    //   // ===== OTHER 10 TILES =====
    //   {
    //     id: 8885,
    //     type: "dot",
    //     number: 1,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 8886,
    //     type: "dot",
    //     number: 2,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 8887,
    //     type: "dot",
    //     number: 3,
    //     copy_no: 3,
    //   },

    //   {
    //     id: 8888,
    //     type: "bamboo",
    //     number: 5,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 8889,
    //     type: "bamboo",
    //     number: 6,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 11000,
    //     type: "bamboo",
    //     number: 7,
    //     copy_no: 3,
    //   },

    //   {
    //     id: 11001,
    //     type: "dot",
    //     number: 8,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 11002,
    //     type: "dot",
    //     number: 8,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 11003,
    //     type: "dot",
    //     number: 8,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 11004,
    //     type: "bamboo",
    //     number: 4,
    //     copy_no: 3,
    //   },
    // ];

    // await redis.del(HAND_KEY(roomId, userId));
    // for (const tile of testTiles) {
    //   await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    // }
    // temporary codes. delete later

    const duration = 60;

    const countdownEndTime = Date.now() + duration * 1000;

    await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
    await redis.set(TURN_COUNTDOWN_END_KEY(roomId), countdownEndTime);

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw).map(JSON.parse);

    const currentPlayer = players.find(
      (player) => Number(player.userId) === Number(userId),
    );

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play", {
      user_id: userId,
      user_name: currentPlayer?.name || null,
    });

    io.to(`user:${userId}`).emit("mahjong:turn_countdown_started", {
      user_id: userId,
      duration: 60,
    });

    const result = await this.checkWinningHand(roomId, userId);
    if (result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await this.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    } else {
      const kongData = await this.checkKongExist(roomId, userId);
      if (kongData.canKong) {
        io.to(`user:${userId}`).emit("mahjong:can_kong", {
          canKong: true,
          groups: kongData.groups,
        });
      }
    }

    let remaining = duration;

    const countdownInterval = setInterval(async () => {
      const winningDataExist = await redis.get(WINNING_DATA_KEY(roomId));
      const alreadyDiscardedRaw = await redis.get(LAST_DISCARD_KEY(roomId));
      const alreadyDiscarded = alreadyDiscardedRaw
        ? JSON.parse(alreadyDiscardedRaw)
        : null;
      if (winningDataExist || alreadyDiscarded?.discard_by == userId) {
        remaining = 0;
      }
      remaining--;

      io.to(`user:${userId}`).emit("mahjong:turn_countdown", {
        user_id: userId,
        remaining,
      });

      /**
       * Timeout
       */
      if (remaining <= 0) {
        clearInterval(countdownInterval);

        io.to(`user:${userId}`).emit("mahjong:turn_countdown_finished", {
          user_id: userId,
        });

        /**
         * Auto discard last tile
         */
        const already_discard_tile_raw = await redis.get(
          LAST_DISCARD_KEY(roomId),
        );
        const already_discard_tile = already_discard_tile_raw
          ? JSON.parse(already_discard_tile_raw)
          : null;
        if (
          !already_discard_tile_raw ||
          already_discard_tile?.discard_by !== userId
        ) {
          const lastTile = await redis.lindex(HAND_KEY(roomId, userId), -1);

          const parsedTile = lastTile ? JSON.parse(lastTile) : null;

          io.to(`user:${userId}`).emit("mahjong:remove_kong_decision");

          await this.discardTile(
            socket,
            {
              roomId,
              userId,
              tileId: parsedTile.id,
            },
            io,
          );
        }
      }
    }, 1000);
  }

  static async acceptKong(socket, payload, io) {
    const { roomId, userId, kongKey } = payload;

    const countdownEndTime = await redis.get(TURN_COUNTDOWN_END_KEY(roomId));
    const remainingSeconds = Math.max(
      0,
      Math.ceil((Number(countdownEndTime) - Date.now()) / 1000),
    );
    if (remainingSeconds <= 0) {
      return;
    }

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    let tiles = rawTiles.map((tile) => JSON.parse(tile));

    /**
     * =========================================
     * Find kong tiles
     * =========================================
     */

    const kongTiles = [];
    const remainTiles = [];

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      if (key === kongKey && kongTiles.length < 4) {
        kongTiles.push(tile);
      } else {
        remainTiles.push(tile);
      }
    }

    /**
     * Safety check
     */
    if (kongTiles.length < 4) {
      throw new Error("Invalid kong tiles");
    }

    /**
     * =========================================
     * Replace hand in Redis
     * =========================================
     */

    await redis.del(HAND_KEY(roomId, userId));

    for (const tile of remainTiles) {
      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    }

    /**
     * =========================================
     * Save kong data
     * =========================================
     *
     * store as list:
     * KONG_KEY(roomId, userId)
     */

    await redis.rpush(
      KONG_KEY(roomId, userId),
      JSON.stringify({
        kong_key: kongKey,
        tiles: kongTiles,
      }),
    );

    /**
     * =========================================
     * Draw replacement tile from wall
     * Kong must draw 1 extra tile
     * =========================================
     */

    let drawTile = await redis.rpop(WALL_KEY(roomId));
    const wallCount = await redis.llen(WALL_KEY(roomId));

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
      wallCount,
    });

    if (drawTile) {
      drawTile = JSON.parse(drawTile);

      // temporary test change
      // drawTile.type = "bamboo";
      // drawTile.number = 9;
      // drawTile.copy_no = 3;

      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(drawTile));
    }

    /**
     * =========================================
     * Rebuild player view hand state
     * =========================================
     */

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const kongData = rawKong.map((item) => JSON.parse(item));
        const pongData = rawPong.map((item) => JSON.parse(item));
        const chowData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);
        /**
         * Self → real tiles
         */
        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          /**
           * Others → hidden hand
           */
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      /**
       * Save updated player view
       */
      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      /**
       * Emit updated hand
       */
      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    /**
     * =========================================
     * Continue same player's turn
     * because Kong draws extra tile
     * =========================================
     */

    const winning_hand_result = await MahJongRoomManager.checkWinningHand(
      roomId,
      userId,
    );
    if (winning_hand_result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await MahJongRoomManager.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));

      await MahJongRoomManager.endRound(roomId, io);
      return;
    }
    // await this.startPlayerTurn(roomId, userId, io);
  }

  static async acceptInterruptKong(socket, payload, io) {
    const { roomId, userId, kongKey } = payload;

    const current_turn_player_id = await redis.get(
      CURRENT_TURN_PLAYER_KEY(roomId),
    );

    await redis.del(DISCARD_REACTION_KEY(roomId));
    await redis.set(
      DISCARD_REACTION_KEY(roomId),
      JSON.stringify({
        claimed: true,
        claimedBy: userId,
      }),
    );

    const discardRaw = await redis.get(LAST_DISCARD_KEY(roomId));

    if (!discardRaw) {
      throw new Error("No discard tile found");
    }

    const discardTileData = JSON.parse(discardRaw);
    const discardTile = discardTileData.tile;

    const discardKey = `${discardTile.type}_${discardTile.number}`;

    if (discardKey !== kongKey) {
      throw new Error("Invalid kong key");
    }

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    const kongTiles = [];
    const remainTiles = [];

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      /**
       * Only take 3 from hand
       */
      if (key === kongKey && kongTiles.length < 3) {
        kongTiles.push(tile);
      } else {
        remainTiles.push(tile);
      }
    }

    /**
     * Add discarded tile as 4th tile
     */
    kongTiles.push(discardTile);

    /**
     * Safety check
     */
    if (kongTiles.length !== 4) {
      throw new Error("Invalid interrupt kong tiles");
    }

    /**
     * =========================================
     * Replace hand in Redis
     * =========================================
     */

    await redis.del(HAND_KEY(roomId, userId));

    for (const tile of remainTiles) {
      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    }

    /**
     * Remove discard because claimed
     */
    await redis.del(LAST_DISCARD_KEY(roomId));

    /**
     * =========================================
     * Save kong data
     * =========================================
     */

    await redis.rpush(
      KONG_KEY(roomId, userId),
      JSON.stringify({
        kong_key: kongKey,
        tiles: kongTiles,
      }),
    );

    /**
     * =========================================
     * Kong replacement draw
     * =========================================
     */

    let drawTile = await redis.rpop(WALL_KEY(roomId));
    const wallCount = await redis.llen(WALL_KEY(roomId));

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
      wallCount,
    });
    if (drawTile) {
      drawTile = JSON.parse(drawTile);

      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(drawTile));
    }

    /**
     * =========================================
     * Rebuild player view
     * =========================================
     */

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );
        const kongData = rawKong.map((item) => JSON.parse(item));
        const pongData = rawPong.map((item) => JSON.parse(item));
        const chowData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    /**
     * Kong claimer becomes current turn player
     */
    // await this.startPlayerTurn(roomId, userId, io);

    await redis.set(CURRENT_TURN_PLAYER_KEY(roomId), userId);

    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "waiting_discard");

    const duration = 60;

    const countdownEndTime = Date.now() + duration * 1000;

    await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
    await redis.set(TURN_COUNTDOWN_END_KEY(roomId), countdownEndTime);

    const currentPlayer = players.find(
      (player) => Number(player.userId) === Number(userId),
    );

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play", {
      user_id: userId,
      user_name: currentPlayer?.name || null,
    });

    io.to(`user:${userId}`).emit("mahjong:turn_countdown_started", {
      user_id: userId,
      duration: 60,
    });

    const result = await MahJongRoomManager.checkWinningHand(roomId, userId);
    if (result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await MahJongRoomManager.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    }

    let remaining = duration;

    const countdownInterval = setInterval(async () => {
      const winningDataExist = await redis.get(WINNING_DATA_KEY(roomId));
      const alreadyDiscardedRaw = await redis.get(LAST_DISCARD_KEY(roomId));
      const alreadyDiscarded = alreadyDiscardedRaw
        ? JSON.parse(alreadyDiscardedRaw)
        : null;
      if (winningDataExist || alreadyDiscarded?.discard_by == userId) {
        remaining = 0;
      }
      remaining--;

      io.to(`user:${userId}`).emit("mahjong:turn_countdown", {
        user_id: userId,
        remaining,
      });

      /**
       * Timeout
       */
      if (remaining <= 0) {
        clearInterval(countdownInterval);

        io.to(`user:${userId}`).emit("mahjong:turn_countdown_finished", {
          user_id: userId,
        });

        /**
         * Auto discard last tile
         */

        const already_discard_tile_raw = await redis.get(
          LAST_DISCARD_KEY(roomId),
        );
        const already_discard_tile = already_discard_tile_raw
          ? JSON.parse(already_discard_tile_raw)
          : null;
        if (
          !already_discard_tile_raw ||
          already_discard_tile?.discard_by !== userId
        ) {
          await MahJongRoomManager.discardTile(
            socket,
            {
              roomId: roomId,
              userId: userId,
              tileId: drawTile.id,
            },
            io,
          );
        }
      }
    }, 1000);
  }

  static async acceptInterruptPong(socket, payload, io) {
    const { roomId, userId, pongKey } = payload;

    const current_turn_player_id = await redis.get(
      CURRENT_TURN_PLAYER_KEY(roomId),
    );

    await redis.del(DISCARD_REACTION_KEY(roomId));
    await redis.set(
      DISCARD_REACTION_KEY(roomId),
      JSON.stringify({
        claimed: true,
        claimedBy: userId,
      }),
    );

    const discardRaw = await redis.get(LAST_DISCARD_KEY(roomId));

    if (!discardRaw) {
      throw new Error("No discard tile found");
    }

    const discardTileData = JSON.parse(discardRaw);
    const discardTile = discardTileData.tile;

    const discardKey = `${discardTile.type}_${discardTile.number}`;

    if (discardKey !== pongKey) {
      throw new Error("Invalid pong key");
    }

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    const pongTiles = [];
    const remainTiles = [];

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      /**
       * Only take 2 from hand
       */
      if (key === pongKey && pongTiles.length < 2) {
        pongTiles.push(tile);
      } else {
        remainTiles.push(tile);
      }
    }

    /**
     * Add discarded tile as 3th tile
     */
    pongTiles.push(discardTile);

    /**
     * Safety check
     */
    if (pongTiles.length !== 3) {
      throw new Error("Invalid interrupt pong tiles");
    }

    /**
     * =========================================
     * Replace hand in Redis
     * =========================================
     */

    await redis.del(HAND_KEY(roomId, userId));

    for (const tile of remainTiles) {
      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    }

    /**
     * Remove discard because claimed
     */
    await redis.del(LAST_DISCARD_KEY(roomId));

    /**
     * =========================================
     * Save pong data
     * =========================================
     */

    await redis.rpush(
      PONG_KEY(roomId, userId),
      JSON.stringify({
        pong_key: pongKey,
        tiles: pongTiles,
      }),
    );

    /**
     * =========================================
     * Rebuild player view
     * =========================================
     */

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const kongData = rawKong.map((item) => JSON.parse(item));
        const pongData = rawPong.map((item) => JSON.parse(item));
        const chowData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    /**
     * Kong claimer becomes current turn player
     */
    // await this.startPlayerTurn(roomId, userId, io);

    await redis.set(CURRENT_TURN_PLAYER_KEY(roomId), userId);

    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "waiting_discard");

    const duration = 60;

    const countdownEndTime = Date.now() + duration * 1000;

    await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
    await redis.set(TURN_COUNTDOWN_END_KEY(roomId), countdownEndTime);

    const currentPlayer = players.find(
      (player) => Number(player.userId) === Number(userId),
    );

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play", {
      user_id: userId,
      user_name: currentPlayer?.name || null,
    });

    io.to(`user:${userId}`).emit("mahjong:turn_countdown_started", {
      user_id: userId,
      duration: 60,
    });

    const result = await MahJongRoomManager.checkWinningHand(roomId, userId);
    if (result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await MahJongRoomManager.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    }

    let remaining = duration;

    const countdownInterval = setInterval(async () => {
      const winningDataExist = await redis.get(WINNING_DATA_KEY(roomId));
      if (winningDataExist) {
        remaining = 0;
      }
      remaining--;

      io.to(`user:${userId}`).emit("mahjong:turn_countdown", {
        user_id: userId,
        remaining,
      });

      /**
       * Timeout
       */
      if (remaining <= 0) {
        clearInterval(countdownInterval);

        io.to(`user:${userId}`).emit("mahjong:turn_countdown_finished", {
          user_id: userId,
        });

        /**
         * Auto discard last tile
         */

        const already_discard_tile_raw = await redis.get(
          LAST_DISCARD_KEY(roomId),
        );
        const already_discard_tile = already_discard_tile_raw
          ? JSON.parse(already_discard_tile_raw)
          : null;
        if (
          !already_discard_tile_raw ||
          already_discard_tile?.discard_by !== userId
        ) {
          const lastTile = await redis.lindex(HAND_KEY(roomId, 1), -1);

          const parsedTile = lastTile ? JSON.parse(lastTile) : null;
          await MahJongRoomManager.discardTile(
            socket,
            {
              roomId: roomId,
              userId: userId,
              tileId: parsedTile.id,
            },
            io,
          );
        }
      }
    }, 1000);
  }

  static async passKong(socket, payload, io) {
    const { roomId, userId } = payload;
    // io.to(`user:${userId}`).emit("mahjong:remove_kong_decision");
    const result = await MahJongRoomManager.checkWinningHand(roomId, userId);

    if (result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await this.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    }
  }

  static async discardTile(socket, payload, io) {
    const { roomId, userId, tileId } = payload;

    const currentTurnUserId = await redis.get(CURRENT_TURN_PLAYER_KEY(roomId));

    if (Number(currentTurnUserId) !== Number(userId)) {
      io.to(`user:${userId}`).emit("mahjong:cannot_discard", {
        message: "It is not your turn. Cannot discard.",
      });
      return;
    }

    /**
     * =====================================
     * 2. Check already discarded or not
     * =====================================
     */

    const existingLastDiscardRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const existingLastDiscard = existingLastDiscardRaw
      ? JSON.parse(existingLastDiscardRaw)
      : null;

    if (existingLastDiscard && existingLastDiscard?.discard_by == userId) {
      io.to(`user:${userId}`).emit("mahjong:cannot_discard", {
        message: "You already discarded this turn.",
      });
      return;
    }

    /**
     * =====================================
     * 3. Get hand tiles
     * =====================================
     */

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));
    // console.log("HAND TILES", tiles);

    /**
     * =====================================
     * 4. Find discard tile
     * =====================================
     */

    const discardTile = tiles.find(
      (tile) => Number(tile.id) === Number(tileId),
    );
    // console.log("DIS TILE", discardTile);
    // if (!discardTile) {
    //   return {
    //     success: false,
    //     message: "Tile not found in hand.",
    //   };
    // }

    /**
     * =====================================
     * 5. Remove full hand and rebuild
     * safer than lrem with JSON
     * =====================================
     */

    const remainingTiles = tiles.filter(
      (tile) => Number(tile.id) !== Number(tileId),
    );

    await redis.del(HAND_KEY(roomId, userId));

    for (const tile of remainingTiles) {
      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    }

    /**
     * =====================================
     * 6. Store last discard
     * =====================================
     */

    await redis.set(
      LAST_DISCARD_KEY(roomId),
      JSON.stringify({ tile: discardTile, discard_by: userId }),
    );

    const last_dis_tile = await redis.get(LAST_DISCARD_KEY(roomId));
    // console.log("HHHHHHHHHH", last_dis_tile);

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const kongData = rawKong.map((item) => JSON.parse(item));
        const pongData = rawPong.map((item) => JSON.parse(item));
        const chowData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

        /**
         * Self → real tiles
         */
        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: discardTile,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          /**
           * Others → hidden hand
           */
          handState.push({
            last_discard_tile: discardTile,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      /**
       * Save updated player view
       */
      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      /**
       * Emit updated hand
       */
      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
      // console.log("HS IN DISCARD FUNC", handState);
    }

    await MahJongRoomManager.handleAfterDiscard(
      socket,
      roomId,
      userId,
      discardTile,
      io,
    );
  }

  static async handleAfterDiscard(
    socket,
    roomId,
    discardedByUserId,
    discardTile,
    io,
  ) {
    // temporary codes. delete later
    // const nextMap = {
    //   1: 3,
    //   2: 1,
    //   3: 2,
    // };

    // const remaining_user = nextMap[discardedByUserId];

    // const testTiles = [
    //   // ===== KONG (4 same tiles) =====
    //   {
    //     id: 8881,
    //     type: discardTile.type,
    //     number: discardTile.number,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 8882,
    //     type: discardTile.type,
    //     number: discardTile.number,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 8883,
    //     type: "dot",
    //     number: 456,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 8884,
    //     type: "bamboo",
    //     number: 13,
    //     copy_no: 4,
    //   },

    //   // ===== OTHER 10 TILES =====
    //   {
    //     id: 8885,
    //     type: "dot",
    //     number: 11,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 8886,
    //     type: "dot",
    //     number: 21,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 8887,
    //     type: "dot",
    //     number: 31,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 8888,
    //     type: "bamboo",
    //     number: 15,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 8889,
    //     type: "bamboo",
    //     number: 61,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 11000,
    //     type: "bamboo",
    //     number: 17,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 11001,
    //     type: "dot",
    //     number: 17,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 11002,
    //     type: "dot",
    //     number: 171,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 11003,
    //     type: "dot",
    //     number: 71,
    //     copy_no: 3,
    //   },
    // ];

    // // const testTiles = [
    // //   // ===== KONG (4 same tiles) =====
    // //   {
    // //     id: 9991,
    // //     type: "bamboo",
    // //     number: 3,
    // //     copy_no: 1,
    // //   },
    // //   {
    // //     id: 9992,
    // //     type: "bamboo",
    // //     number: 3,
    // //     copy_no: 2,
    // //   },
    // //   {
    // //     id: 9993,
    // //     type: "bamboo",
    // //     number: 3,
    // //     copy_no: 3,
    // //   },
    // //   {
    // //     id: 9994,
    // //     type: discardTile.type,
    // //     number: discardTile.number,
    // //     copy_no: 3,
    // //   },

    // //   // ===== OTHER 10 TILES =====
    // //   {
    // //     id: 9995,
    // //     type: "dot",
    // //     number: 1,
    // //     copy_no: 1,
    // //   },
    // //   {
    // //     id: 9996,
    // //     type: "dot",
    // //     number: 2,
    // //     copy_no: 1,
    // //   },
    // //   {
    // //     id: 9997,
    // //     type: "dot",
    // //     number: 3,
    // //     copy_no: 1,
    // //   },

    // //   {
    // //     id: 9998,
    // //     type: "bamboo",
    // //     number: 5,
    // //     copy_no: 1,
    // //   },
    // //   {
    // //     id: 9999,
    // //     type: "bamboo",
    // //     number: 6,
    // //     copy_no: 1,
    // //   },
    // //   {
    // //     id: 10000,
    // //     type: "bamboo",
    // //     number: 7,
    // //     copy_no: 1,
    // //   },

    // //   {
    // //     id: 10001,
    // //     type: "dot",
    // //     number: 7,
    // //     copy_no: 1,
    // //   },
    // //   {
    // //     id: 10002,
    // //     type: "dot",
    // //     number: 7,
    // //     copy_no: 2,
    // //   },
    // //   {
    // //     id: 10003,
    // //     type: "dot",
    // //     number: 7,
    // //     copy_no: 3,
    // //   },
    // // ];

    // await redis.del(HAND_KEY(roomId, remaining_user));
    // for (const tile of testTiles) {
    //   await redis.rpush(HAND_KEY(roomId, remaining_user), JSON.stringify(tile));
    // }

    // const playerViewRaw = await redis.get(
    //   PLAYER_VIEW_HAND_KEY(roomId, remaining_user),
    // );

    // if (playerViewRaw) {
    //   const handState = JSON.parse(playerViewRaw);

    //   const updatedHandState = handState.map((player) => {
    //     /**
    //      * only update self player tiles
    //      */
    //     if (Number(player.userId) === Number(remaining_user)) {
    //       return {
    //         ...player,
    //         tileCount: testTiles.length,
    //         tiles: testTiles,
    //       };
    //     }

    //     return player;
    //   });

    //   await redis.set(
    //     PLAYER_VIEW_HAND_KEY(roomId, remaining_user),
    //     JSON.stringify(updatedHandState),
    //   );
    // }
    // temporary codes. delete later

    /**
     * =====================================
     * 1. Reset discard reaction state
     * =====================================
     */

    await redis.set(
      DISCARD_REACTION_KEY(roomId),
      JSON.stringify({
        claimed: false,
        claimedBy: null,
      }),
    );

    /**
     * =====================================
     * 2. Get all round players
     * =====================================
     */

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    /**
     * =====================================
     * 3. Exclude discarder
     * =====================================
     */

    const targetPlayers = players.filter(
      (player) => Number(player.userId) !== Number(discardedByUserId),
    );

    // check win
    for (const player of targetPlayers) {
      const result = await this.checkWinUsingDiscard(
        roomId,
        player.userId,
        discardTile,
      );
      if (result.canWin) {
        await redis.rpush(
          HAND_KEY(roomId, player.userId),
          JSON.stringify(discardTile),
        );
        await this.storeWinningData(roomId, player.userId);
        const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
        const winningData = JSON.parse(winningDataRaw);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
        await MahJongRoomManager.endRound(roomId, io);
        return;
        // await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      }
    }

    const currentIndex = players.findIndex(
      (player) => Number(player.userId) === Number(discardedByUserId),
    );

    if (currentIndex === -1) {
      console.log({
        success: false,
        message: "Current player not found in round players",
      });
      return {
        success: false,
        message: "Current player not found in round players",
      };
    }

    /**
     * =====================================
     * 4. Get next player
     * circular turn logic
     * =====================================
     */

    let nextIndex = currentIndex + 1;

    if (nextIndex >= players.length) {
      nextIndex = 0;
    }

    const nextPlayer = players[nextIndex];

    const newTargetPlayers = targetPlayers.filter(
      (player) => Number(player.userId) !== Number(nextPlayer.userId),
    );
    /**
     * =====================================
     * 5. KONG CHECK
     * exposed kong from discard
     * need 3 same tiles in hand
     * =====================================
     */
    const current_wall_count = await redis.llen(WALL_KEY(roomId));

    const kongPlayers = [];
    let kongPlayer = null;

    if (current_wall_count > 0) {
      for (const player of newTargetPlayers) {
        const canKongData = await this.checkKongUsingDiscard(
          roomId,
          player.userId,
          discardTile,
        );

        if (canKongData.canKong) {
          kongPlayers.push(player);
          kongPlayer = player;
          io.to(`user:${player.userId}`).emit("mahjong:can_interrupt_kong", {
            canKong: canKongData.canKong,
            groups: canKongData.groups,
          });
          break;
        }
      }
    }

    if (kongPlayers.length > 0) {
      await this.wait(3000);
      const reactionRaw = await redis.get(DISCARD_REACTION_KEY(roomId));

      const reaction = reactionRaw ? JSON.parse(reactionRaw) : null;

      if (reaction?.claimed) {
        return;
      }
      io.to(`user:${kongPlayer.userId}`).emit("mahjong:remove_kong_decision");
    } else {
      const pongPlayers = [];
      let pongPlayer = null;
      for (const player of newTargetPlayers) {
        const canPongData = await this.checkPongUsingDiscard(
          roomId,
          player.userId,
          discardTile,
        );

        if (canPongData.canPong) {
          pongPlayers.push(player);
          pongPlayer = player;
          io.to(`user:${player.userId}`).emit("mahjong:can_interrupt_pong", {
            canPong: canPongData.canPong,
            groups: canPongData.groups,
          });
          break;
        }
      }

      if (pongPlayers.length > 0) {
        await this.wait(3000);
        const reactionRaw = await redis.get(DISCARD_REACTION_KEY(roomId));

        const reaction = reactionRaw ? JSON.parse(reactionRaw) : null;

        if (reaction?.claimed) {
          return;
        }
        io.to(`user:${pongPlayer.userId}`).emit("mahjong:remove_pong_decision");
      }
    }

    /**
     * =====================================
     * 7. Nobody claimed
     * start next normal turn
     * =====================================
     */

    // const wallCount = await redis.llen(WALL_KEY(roomId));
    // if (wallCount <= 0) {
    //   io.to(SOCKET_ROOM(roomId)).emit("mahjong:draw_round");
    // }

    await this.startNextTurn(socket, roomId, io);
  }

  static async checkWinUsingDiscard(roomId, userId, discardTile) {
    // // temporary codes. delete later
    // await redis.del(HAND_KEY(roomId, userId));

    // const testTiles = [
    //   // ===== KONG (4 same tiles) =====
    //   {
    //     id: 9991,
    //     type: discardTile.type,
    //     number: discardTile.number,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9992,
    //     type: discardTile.type,
    //     number: discardTile.number,
    //     copy_no: 2,
    //   },
    //   // {
    //   //   id: 9993,
    //   //   type: discardTile.type,
    //   //   number: discardTile.number,
    //   //   copy_no: 3,
    //   // },
    //   {
    //     id: 9994,
    //     type: "bamboo",
    //     number: 9,
    //     copy_no: 3,
    //   },

    //   // ===== OTHER 10 TILES =====
    //   {
    //     id: 9995,
    //     type: "dot",
    //     number: 1,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9996,
    //     type: "dot",
    //     number: 2,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9997,
    //     type: "dot",
    //     number: 3,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 9998,
    //     type: "bamboo",
    //     number: 5,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9999,
    //     type: "bamboo",
    //     number: 6,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 10000,
    //     type: "bamboo",
    //     number: 7,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 10001,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 10002,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 10003,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 3,
    //   },

    //   {
    //     id: 10004,
    //     type: "bamboo",
    //     number: 9,
    //     copy_no: 1,
    //   },
    // ];

    // for (const tile of testTiles) {
    //   await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    // }

    // const playerViewRawTest = await redis.get(
    //   PLAYER_VIEW_HAND_KEY(roomId, userId),
    // );

    // if (playerViewRawTest) {
    //   const handState = JSON.parse(playerViewRawTest);

    //   const updatedHandState = handState.map((player) => {
    //     /**
    //      * update self player only
    //      */
    //     if (Number(player.userId) === Number(userId)) {
    //       return {
    //         ...player,
    //         tileCount: testTiles.length,
    //         tiles: testTiles,
    //       };
    //     }

    //     /**
    //      * keep others unchanged
    //      */
    //     return player;
    //   });

    //   await redis.set(
    //     PLAYER_VIEW_HAND_KEY(roomId, userId),
    //     JSON.stringify(updatedHandState),
    //   );
    // }
    // // temporary codes. delete later

    /**
     * =====================================
     * 1. Get player view hand state
     * =====================================
     */
    const playerViewRaw = await redis.get(PLAYER_VIEW_HAND_KEY(roomId, userId));

    if (!playerViewRaw) {
      return {
        canWin: false,
        reason: "No player view found",
      };
    }

    const handState = JSON.parse(playerViewRaw);

    const selfPlayer = handState.find(
      (player) => Number(player.userId) === Number(userId),
    );

    if (!selfPlayer) {
      return {
        canWin: false,
        reason: "Player data not found",
      };
    }

    /**
     * =====================================
     * 2. Get concealed hand tiles
     * =====================================
     */
    const tiles = [...(selfPlayer.tiles || [])];

    /**
     * Add discard tile temporarily
     */
    tiles.push(discardTile);

    /**
     * =====================================
     * 3. Count revealed melds
     * =====================================
     */
    let revealedMeldCount = 0;

    if (selfPlayer.chow && Array.isArray(selfPlayer.chow)) {
      revealedMeldCount += selfPlayer.chow.length;
    }

    if (selfPlayer.pong && Array.isArray(selfPlayer.pong)) {
      revealedMeldCount += selfPlayer.pong.length;
    }

    if (selfPlayer.kong && Array.isArray(selfPlayer.kong)) {
      revealedMeldCount += selfPlayer.kong.length;
    }

    /**
     * Need total:
     * 4 melds + 1 pair
     */
    const remainingMeldsNeeded = 4 - revealedMeldCount;

    if (remainingMeldsNeeded < 0) {
      return {
        canWin: false,
        reason: "Too many revealed melds",
      };
    }

    /**
     * =====================================
     * 4. Build tile counts
     * =====================================
     */
    const counts = {};

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      counts[key] = (counts[key] || 0) + 1;
    }

    /**
     * =====================================
     * 5. Try every possible pair
     * =====================================
     */
    // for (const key in counts) {
    //   if (counts[key] >= 2) {
    //     /**
    //      * Assume this is the pair
    //      */
    //     counts[key] -= 2;

    //     const canWin = this.canFormMeldsByCount(
    //       { ...counts },
    //       remainingMeldsNeeded,
    //     );

    //     if (canWin) {
    //       counts[key] += 2;

    //       return {
    //         canWin: true,
    //         winningPair: key,
    //         discardTile,
    //         revealedMeldCount,
    //         remainingMeldsNeeded,
    //       };
    //     }

    //     /**
    //      * Restore
    //      */
    //     counts[key] += 2;
    //   }
    // }

    const canWin = this.canWinWithMeldsAndPair(counts, remainingMeldsNeeded);

    return canWin
      ? {
          canWin: true,
          revealedMeldCount,
          remainingMeldsNeeded,
        }
      : {
          canWin: false,
          reason: "No valid winning structure",
        };

    return {
      canWin: false,
      reason: "No valid winning pattern",
    };
  }

  static async checkKongUsingDiscard(roomId, userId, discardTile) {
    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    const tileMap = {};
    const kongGroups = [];

    /**
     * Group same tiles
     */
    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      if (!tileMap[key]) {
        tileMap[key] = [];
      }

      tileMap[key].push(tile);
    }

    const discardKey = `${discardTile.type}_${discardTile.number}`;

    /**
     * Need 3 same tiles in hand
     */
    if (tileMap[discardKey] && tileMap[discardKey].length >= 3) {
      kongGroups.push({
        tileKey: discardKey,

        /**
         * FULL 4 TILES
         */
        tiles: [...tileMap[discardKey].slice(0, 3), discardTile],
      });
    }

    return {
      canKong: kongGroups.length > 0,
      groups: kongGroups,
    };
  }

  static async checkPongUsingDiscard(roomId, userId, discardTile) {
    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    const tileMap = {};
    const pongGroups = [];

    /**
     * Group same tiles
     */
    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      if (!tileMap[key]) {
        tileMap[key] = [];
      }

      tileMap[key].push(tile);
    }

    const discardKey = `${discardTile.type}_${discardTile.number}`;

    /**
     * Need 2 same tiles in hand
     */
    if (tileMap[discardKey] && tileMap[discardKey].length >= 2) {
      pongGroups.push({
        tileKey: discardKey,

        /**
         * FULL 3 TILES
         */
        tiles: [...tileMap[discardKey].slice(0, 2), discardTile],
      });
    }

    return {
      canPong: pongGroups.length > 0,
      groups: pongGroups,
    };
  }

  static async checkChowUsingDiscard(roomId, userId, discardTile) {
    /**
     * honors cannot chow
     * (if you only have dot / bamboo now,
     * this can be ignored)
     */
    const allowedTypes = ["dot", "bamboo"];

    if (!allowedTypes.includes(discardTile.type)) {
      return {
        canChow: false,
        groups: [],
      };
    }

    /**
     * Get player hand tiles
     */
    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    /**
     * Find all possible chow groups
     */
    const chowGroups = [];

    const n = Number(discardTile.number);
    const type = discardTile.type;

    /**
     * possible patterns:
     * [n-2, n-1, n]
     * [n-1, n, n+1]
     * [n, n+1, n+2]
     */
    const patterns = [
      [n - 2, n - 1],
      [n - 1, n + 1],
      [n + 1, n + 2],
    ];

    for (const pattern of patterns) {
      const [a, b] = pattern;

      /**
       * must stay inside 1~9
       */
      if (a < 1 || a > 9 || b < 1 || b > 9) {
        continue;
      }

      const tileA = tiles.find(
        (tile) => tile.type === type && Number(tile.number) === a,
      );

      const tileB = tiles.find(
        (tile) => tile.type === type && Number(tile.number) === b,
      );

      if (tileA && tileB) {
        chowGroups.push({
          tileKey: `${type}_${a}_${n}_${b}`,
          tiles: [
            tileA,
            {
              ...discardTile,
              fromDiscard: true,
            },
            tileB,
          ].sort((x, y) => Number(x.number) - Number(y.number)),
        });
      }
    }

    return {
      canChow: chowGroups.length > 0,
      groups: chowGroups,
    };
  }

  static async acceptNormalKong(socket, payload, io) {
    const { roomId, userId, kongKey } = payload;

    // const current_turn_player_id = await redis.get(
    //   CURRENT_TURN_PLAYER_KEY(roomId),
    // );

    // await redis.del(DISCARD_REACTION_KEY(roomId));
    // await redis.set(
    //   DISCARD_REACTION_KEY(roomId),
    //   JSON.stringify({
    //     claimed: true,
    //     claimedBy: userId,
    //   }),
    // );

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const discardTileData = JSON.parse(discardTileRaw);
    const discardTile = discardTileData.tile;

    const discardKey = `${discardTile.type}_${discardTile.number}`;

    if (discardKey !== kongKey) {
      throw new Error("Invalid kong key");
    }

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    const kongTiles = [];
    const remainTiles = [];

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      /**
       * Only take 3 from hand
       */
      if (key === kongKey && kongTiles.length < 3) {
        kongTiles.push(tile);
      } else {
        remainTiles.push(tile);
      }
    }

    /**
     * Add discarded tile as 4th tile
     */
    kongTiles.push(discardTile);

    /**
     * Safety check
     */
    if (kongTiles.length !== 4) {
      throw new Error("Invalid interrupt kong tiles");
    }

    /**
     * =========================================
     * Replace hand in Redis
     * =========================================
     */

    await redis.del(HAND_KEY(roomId, userId));

    for (const tile of remainTiles) {
      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    }

    /**
     * Remove discard because claimed
     */
    await redis.del(LAST_DISCARD_KEY(roomId));

    /**
     * =========================================
     * Save kong data
     * =========================================
     */

    await redis.rpush(
      KONG_KEY(roomId, userId),
      JSON.stringify({
        kong_key: kongKey,
        tiles: kongTiles,
      }),
    );

    /**
     * =========================================
     * Kong replacement draw
     * =========================================
     */

    let drawTile = await redis.rpop(WALL_KEY(roomId));

    const wallCount = await redis.llen(WALL_KEY(roomId));

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
      wallCount,
    });

    if (drawTile) {
      drawTile = JSON.parse(drawTile);

      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(drawTile));
    }

    /**
     * =========================================
     * Rebuild player view
     * =========================================
     */

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );
        const kongData = rawKong.map((item) => JSON.parse(item));
        const pongData = rawPong.map((item) => JSON.parse(item));
        const chowData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    const winning_hand_result = await MahJongRoomManager.checkWinningHand(
      roomId,
      userId,
    );
    if (winning_hand_result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await MahJongRoomManager.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    }
    // await this.startPlayerTurn(roomId, userId, io);
  }

  static async acceptNormalPong(socket, payload, io) {
    const { roomId, userId, pongKey } = payload;

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const discardTileData = JSON.parse(discardTileRaw);
    const discardTile = discardTileData.tile;

    const discardKey = `${discardTile.type}_${discardTile.number}`;

    if (discardKey !== pongKey) {
      throw new Error("Invalid pong key");
    }

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    const pongTiles = [];
    const remainTiles = [];

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      /**
       * Only take 2 from hand
       */
      if (key === pongKey && pongTiles.length < 2) {
        pongTiles.push(tile);
      } else {
        remainTiles.push(tile);
      }
    }

    /**
     * Add discarded tile as 4th tile
     */
    pongTiles.push(discardTile);

    /**
     * Safety check
     */
    if (pongTiles.length !== 3) {
      throw new Error("Invalid normal pong tiles");
    }

    /**
     * =========================================
     * Replace hand in Redis
     * =========================================
     */

    await redis.del(HAND_KEY(roomId, userId));

    for (const tile of remainTiles) {
      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    }

    /**
     * Remove discard because claimed
     */
    await redis.del(LAST_DISCARD_KEY(roomId));

    /**
     * =========================================
     * Save pong data
     * =========================================
     */

    await redis.rpush(
      PONG_KEY(roomId, userId),
      JSON.stringify({
        pong_key: pongKey,
        tiles: pongTiles,
      }),
    );

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );
        const kongData = rawKong.map((item) => JSON.parse(item));
        const pongData = rawPong.map((item) => JSON.parse(item));
        const chowData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    const winning_hand_result = await MahJongRoomManager.checkWinningHand(
      roomId,
      userId,
    );
    if (winning_hand_result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await MahJongRoomManager.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    }
    // await this.startPlayerTurn(roomId, userId, io);
  }

  static async acceptNormalChow(socket, payload, io) {
    const { roomId, userId, chowKey } = payload;

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));

    if (!discardTileRaw) {
      throw new Error("No discard tile found");
    }

    const discardTileData = JSON.parse(discardTileRaw);
    const discardTile = discardTileData.tile;

    const chowData = await MahJongRoomManager.checkChowUsingDiscard(
      roomId,
      userId,
      discardTile,
    );

    if (!chowData.canChow) {
      throw new Error("Cannot chow");
    }

    const selectedGroup = chowData.groups.find(
      (group) => group.tileKey === chowKey,
    );

    if (!selectedGroup) {
      throw new Error("Invalid chow key");
    }

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    let tiles = rawTiles.map((tile) => JSON.parse(tile));

    /**
     * =========================================
     * Remove 2 required tiles from hand
     * (discard tile is included separately)
     * =========================================
     */
    const chowTiles = [];
    const remainTiles = [];

    /**
     * exclude discard tile
     * only remove 2 from hand
     */
    const neededTiles = selectedGroup.tiles.filter((tile) => !tile.fromDiscard);

    for (const tile of tiles) {
      const index = neededTiles.findIndex(
        (need) =>
          need.type === tile.type &&
          Number(need.number) === Number(tile.number),
      );

      if (index !== -1) {
        chowTiles.push(tile);
        neededTiles.splice(index, 1);
      } else {
        remainTiles.push(tile);
      }
    }

    /**
     * add discard tile as 3rd tile
     */
    chowTiles.push(discardTile);

    /**
     * =========================================
     * Safety check
     * =========================================
     */
    if (chowTiles.length !== 3) {
      throw new Error("Invalid chow tiles");
    }

    /**
     * =========================================
     * Replace hand in Redis
     * =========================================
     */
    await redis.del(HAND_KEY(roomId, userId));

    for (const tile of remainTiles) {
      await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    }

    /**
     * Remove discard because claimed
     */
    await redis.del(LAST_DISCARD_KEY(roomId));

    /**
     * =========================================
     * Save chow data
     * =========================================
     */
    await redis.rpush(
      CHOW_KEY(roomId, userId),
      JSON.stringify({
        chow_key: chowKey,
        tiles: chowTiles.sort((a, b) => Number(a.number) - Number(b.number)),
      }),
    );

    /**
     * =========================================
     * Rebuild player view hand state
     * =========================================
     */
    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const kongData = rawKong.map((item) => JSON.parse(item));

        const pongData = rawPong.map((item) => JSON.parse(item));

        const chowStoredData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowStoredData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowStoredData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    const winning_hand_result = await MahJongRoomManager.checkWinningHand(
      roomId,
      userId,
    );
    if (winning_hand_result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await MahJongRoomManager.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    }
  }

  static async passNormalKong(socket, payload, io) {
    const { roomId, userId } = payload;

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const discardTileData = JSON.parse(discardTileRaw);
    const discardTile = discardTileData.tile;
    const discardedUserId = discardTileData.discard_by;

    const pongData = await MahJongRoomManager.checkPongUsingDiscard(
      roomId,
      userId,
      discardTile,
    );

    if (pongData.canPong) {
      io.to(`user:${userId}`).emit("mahjong:can_normal_pong", {
        canPong: pongData.canPong,
        groups: pongData.groups,
      });
    } else {
      const chowData = await MahJongRoomManager.checkChowUsingDiscard(
        roomId,
        userId,
        discardTile,
      );
      if (chowData.canChow) {
        io.to(`user:${userId}`).emit("mahjong:can_normal_chow", {
          canChow: chowData.canChow,
          groups: chowData.groups,
        });
      } else {
        await redis.del(LAST_DISCARD_KEY(roomId));
        await redis.rpush(
          PLAYER_DISCARD_TILES_KEY(roomId, discardedUserId),
          JSON.stringify(discardTile),
        );

        const drawTile = await redis.lpop(WALL_KEY(roomId));

        const wallCount = await redis.llen(WALL_KEY(roomId));

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
          wallCount,
        });

        await redis.rpush(HAND_KEY(roomId, userId), drawTile);

        const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

        const players = Object.values(roundPlayersRaw)
          .map(JSON.parse)
          .sort((a, b) => a.seat - b.seat);

        for (const currentPlayer of players) {
          const handState = [];

          for (const targetPlayer of players) {
            const rawPlayerTiles = await redis.lrange(
              HAND_KEY(roomId, targetPlayer.userId),
              0,
              -1,
            );

            const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

            const rawKong = await redis.lrange(
              KONG_KEY(roomId, targetPlayer.userId),
              0,
              -1,
            );

            const rawPong = await redis.lrange(
              PONG_KEY(roomId, targetPlayer.userId),
              0,
              -1,
            );

            const rawChow = await redis.lrange(
              CHOW_KEY(roomId, targetPlayer.userId),
              0,
              -1,
            );
            const kongData = rawKong.map((item) => JSON.parse(item));
            const pongData = rawPong.map((item) => JSON.parse(item));
            const chowData = rawChow.map((item) => JSON.parse(item));

            const ownDiscardTilesRaw = await redis.lrange(
              PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
              0,
              -1,
            );

            const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

            if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
              handState.push({
                last_discard_tile: null,
                pong: pongData,
                chow: chowData,
                kong: kongData,
                discarded_tiles: ownDiscardTiles,
                userId: targetPlayer.userId,
                user_name: targetPlayer.name,
                isSelf: true,
                seat_position: targetPlayer.seat,
                tileCount: parsedTiles.length,
                tiles: parsedTiles,
              });
            } else {
              handState.push({
                last_discard_tile: null,
                pong: pongData,
                chow: chowData,
                kong: kongData,
                discarded_tiles: ownDiscardTiles,
                userId: targetPlayer.userId,
                user_name: targetPlayer.name,
                isSelf: false,
                seat_position: targetPlayer.seat,
                tileCount: parsedTiles.length,
                tiles: Array.from({ length: parsedTiles.length }, () => ({
                  id: null,
                  type: "hidden",
                  number: null,
                  copy_no: null,
                })),
              });
            }
          }

          await redis.set(
            PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
            JSON.stringify(handState),
          );

          io.to(`user:${currentPlayer.userId}`).emit(
            "mahjong:initial_hand_state",
            handState,
          );
        }

        const winning_hand_result = await MahJongRoomManager.checkWinningHand(
          roomId,
          userId,
        );
        if (winning_hand_result.canWin) {
          io.to(`user:${userId}`).emit("mahjong:you_win");
          await MahJongRoomManager.storeWinningData(roomId, userId);
          const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
          const winningData = JSON.parse(winningDataRaw);
          io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
          await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
          await MahJongRoomManager.endRound(roomId, io);
          return;
        }
      }
    }
  }

  static async passNormalPong(socket, payload, io) {
    const { roomId, userId } = payload;

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const discardTileData = JSON.parse(discardTileRaw);
    const discardTile = discardTileData.tile;
    const discardedUserId = discardTileData.discard_by;

    const chowData = await MahJongRoomManager.checkChowUsingDiscard(
      roomId,
      userId,
      discardTile,
    );

    if (chowData.canChow) {
      io.to(`user:${userId}`).emit("mahjong:can_normal_chow", {
        canChow: chowData.canChow,
        groups: chowData.groups,
      });
    } else {
      await redis.del(LAST_DISCARD_KEY(roomId));
      await redis.rpush(
        PLAYER_DISCARD_TILES_KEY(roomId, discardedUserId),
        JSON.stringify(discardTile),
      );

      const drawTile = await redis.lpop(WALL_KEY(roomId));

      const wallCount = await redis.llen(WALL_KEY(roomId));

      io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
        wallCount,
      });

      await redis.rpush(HAND_KEY(roomId, userId), drawTile);

      const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

      const players = Object.values(roundPlayersRaw)
        .map(JSON.parse)
        .sort((a, b) => a.seat - b.seat);

      for (const currentPlayer of players) {
        const handState = [];

        for (const targetPlayer of players) {
          const rawPlayerTiles = await redis.lrange(
            HAND_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

          const rawKong = await redis.lrange(
            KONG_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const rawPong = await redis.lrange(
            PONG_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const rawChow = await redis.lrange(
            CHOW_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );
          const kongData = rawKong.map((item) => JSON.parse(item));
          const pongData = rawPong.map((item) => JSON.parse(item));
          const chowData = rawChow.map((item) => JSON.parse(item));

          const ownDiscardTilesRaw = await redis.lrange(
            PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

          if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
            handState.push({
              last_discard_tile: null,
              pong: pongData,
              chow: chowData,
              kong: kongData,
              discarded_tiles: ownDiscardTiles,
              userId: targetPlayer.userId,
              user_name: targetPlayer.name,
              isSelf: true,
              seat_position: targetPlayer.seat,
              tileCount: parsedTiles.length,
              tiles: parsedTiles,
            });
          } else {
            handState.push({
              last_discard_tile: null,
              pong: pongData,
              chow: chowData,
              kong: kongData,
              discarded_tiles: ownDiscardTiles,
              userId: targetPlayer.userId,
              user_name: targetPlayer.name,
              isSelf: false,
              seat_position: targetPlayer.seat,
              tileCount: parsedTiles.length,
              tiles: Array.from({ length: parsedTiles.length }, () => ({
                id: null,
                type: "hidden",
                number: null,
                copy_no: null,
              })),
            });
          }
        }

        await redis.set(
          PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
          JSON.stringify(handState),
        );

        io.to(`user:${currentPlayer.userId}`).emit(
          "mahjong:initial_hand_state",
          handState,
        );
      }

      const winning_hand_result = await MahJongRoomManager.checkWinningHand(
        roomId,
        userId,
      );
      if (winning_hand_result.canWin) {
        io.to(`user:${userId}`).emit("mahjong:you_win");
        await MahJongRoomManager.storeWinningData(roomId, userId);
        const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
        const winningData = JSON.parse(winningDataRaw);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
        await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
        await MahJongRoomManager.endRound(roomId, io);
        return;
      }
    }
  }

  static async passNormalChow(socket, payload, io) {
    const { roomId, userId } = payload;

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const discardTileData = JSON.parse(discardTileRaw);
    const discardTile = discardTileData.tile;
    const discardedUserId = discardTileData.discard_by;

    await redis.del(LAST_DISCARD_KEY(roomId));
    await redis.rpush(
      PLAYER_DISCARD_TILES_KEY(roomId, discardedUserId),
      JSON.stringify(discardTile),
    );

    const drawTile = await redis.lpop(WALL_KEY(roomId));
    const wallCount = await redis.llen(WALL_KEY(roomId));

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
      wallCount,
    });
    await redis.rpush(HAND_KEY(roomId, userId), drawTile);

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    for (const currentPlayer of players) {
      const handState = [];

      for (const targetPlayer of players) {
        const rawPlayerTiles = await redis.lrange(
          HAND_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

        const rawKong = await redis.lrange(
          KONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawPong = await redis.lrange(
          PONG_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const rawChow = await redis.lrange(
          CHOW_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );
        const kongData = rawKong.map((item) => JSON.parse(item));
        const pongData = rawPong.map((item) => JSON.parse(item));
        const chowData = rawChow.map((item) => JSON.parse(item));

        const ownDiscardTilesRaw = await redis.lrange(
          PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
          0,
          -1,
        );

        const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

        if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: true,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: parsedTiles,
          });
        } else {
          handState.push({
            last_discard_tile: null,
            pong: pongData,
            chow: chowData,
            kong: kongData,
            discarded_tiles: ownDiscardTiles,
            userId: targetPlayer.userId,
            user_name: targetPlayer.name,
            isSelf: false,
            seat_position: targetPlayer.seat,
            tileCount: parsedTiles.length,
            tiles: Array.from({ length: parsedTiles.length }, () => ({
              id: null,
              type: "hidden",
              number: null,
              copy_no: null,
            })),
          });
        }
      }

      await redis.set(
        PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
        JSON.stringify(handState),
      );

      io.to(`user:${currentPlayer.userId}`).emit(
        "mahjong:initial_hand_state",
        handState,
      );
    }

    const winning_hand_result = await MahJongRoomManager.checkWinningHand(
      roomId,
      userId,
    );
    if (winning_hand_result.canWin) {
      io.to(`user:${userId}`).emit("mahjong:you_win");
      await MahJongRoomManager.storeWinningData(roomId, userId);
      const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
      const winningData = JSON.parse(winningDataRaw);
      io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
      await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
      await MahJongRoomManager.endRound(roomId, io);
      return;
    }
  }

  static async startNextTurn(socket, roomId, io) {
    const currentTurnUserId = await redis.get(CURRENT_TURN_PLAYER_KEY(roomId));

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    /**
     * =====================================
     * 3. Find current player index
     * =====================================
     */

    const currentIndex = players.findIndex(
      (player) => Number(player.userId) === Number(currentTurnUserId),
    );

    if (currentIndex === -1) {
      console.log({
        success: false,
        message: "Current player not found in round players",
      });
      return {
        success: false,
        message: "Current player not found in round players",
      };
    }

    /**
     * =====================================
     * 4. Get next player
     * circular turn logic
     * =====================================
     */

    let nextIndex = currentIndex + 1;

    if (nextIndex >= players.length) {
      nextIndex = 0;
    }

    const nextPlayer = players[nextIndex];

    await redis.set(CURRENT_TURN_PLAYER_KEY(roomId), nextPlayer.userId);

    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "waiting_discard");

    const duration = 60;

    const countdownEndTime = Date.now() + duration * 1000;

    await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
    await redis.set(TURN_COUNTDOWN_END_KEY(roomId), countdownEndTime);

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play", {
      user_id: nextPlayer.userId,
      user_name: nextPlayer?.name || null,
    });

    io.to(`user:${nextPlayer.userId}`).emit("mahjong:turn_countdown_started", {
      user_id: nextPlayer.userId,
      duration: 60,
    });

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const discardTileData = JSON.parse(discardTileRaw);
    const discardTile = discardTileData.tile;
    const discardedUserId = discardTileData.discard_by;

    // temporary codes
    // const testTiles = [
    //   // ===== KONG (4 same tiles) =====
    //   {
    //     id: 9991,
    //     type: discardTile.type,
    //     number: discardTile.number,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9992,
    //     type: discardTile.type,
    //     number: discardTile.number,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 9993,
    //     type: discardTile.type,
    //     number: discardTile.number,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 9994,
    //     type: "dot",
    //     number: 43,
    //     copy_no: 3,
    //   },

    //   // ===== OTHER 10 TILES =====
    //   {
    //     id: 9995,
    //     type: "dot",
    //     number: 1,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9996,
    //     type: "dot",
    //     number: 2,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9997,
    //     type: "dot",
    //     number: 3,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 9998,
    //     type: "bamboo",
    //     number: 5,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9999,
    //     type: "bamboo",
    //     number: 6,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 10000,
    //     type: "bamboo",
    //     number: 7,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 10001,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 10002,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 10003,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 3,
    //   },
    // ];

    // await redis.del(HAND_KEY(roomId, nextPlayer.userId));
    // for (const tile of testTiles) {
    //   await redis.rpush(
    //     HAND_KEY(roomId, nextPlayer.userId),
    //     JSON.stringify(tile),
    //   );
    // }

    // const playerViewRaw = await redis.get(
    //   PLAYER_VIEW_HAND_KEY(roomId, nextPlayer.userId),
    // );

    // if (playerViewRaw) {
    //   const handState = JSON.parse(playerViewRaw);

    //   const updatedHandState = handState.map((player) => {
    //     /**
    //      * only update self player tiles
    //      */
    //     if (Number(player.userId) === Number(nextPlayer.userId)) {
    //       return {
    //         ...player,
    //         tileCount: testTiles.length,
    //         tiles: testTiles,
    //       };
    //     }

    //     return player;
    //   });

    //   await redis.set(
    //     PLAYER_VIEW_HAND_KEY(roomId, nextPlayer.userId),
    //     JSON.stringify(updatedHandState),
    //   );
    // }
    // temporary codes. delete later

    // check kong
    const kongData = await MahJongRoomManager.checkKongUsingDiscard(
      roomId,
      nextPlayer.userId,
      discardTile,
    );
    const pongData = await MahJongRoomManager.checkPongUsingDiscard(
      roomId,
      nextPlayer.userId,
      discardTile,
    );
    const chowData = await MahJongRoomManager.checkChowUsingDiscard(
      roomId,
      nextPlayer.userId,
      discardTile,
    );
    let drawTile = null;
    let wallCount = await redis.llen(WALL_KEY(roomId));

    if (!kongData.canKong && !pongData.canPong && !chowData.canChow) {
      if (wallCount <= 0) {
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:draw_round");
        await MahJongRoomManager.endRound(roomId, io);
        return;
      }
      await MahJongRoomManager.wait(1200);
      await redis.del(LAST_DISCARD_KEY(roomId));

      await redis.rpush(
        PLAYER_DISCARD_TILES_KEY(roomId, discardedUserId),
        JSON.stringify(discardTile),
      );

      drawTile = await redis.lpop(WALL_KEY(roomId));

      wallCount = await redis.llen(WALL_KEY(roomId));

      io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
        wallCount,
      });

      await redis.rpush(HAND_KEY(roomId, nextPlayer.userId), drawTile);

      const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

      const players = Object.values(roundPlayersRaw)
        .map(JSON.parse)
        .sort((a, b) => a.seat - b.seat);

      for (const currentPlayer of players) {
        const handState = [];

        for (const targetPlayer of players) {
          const rawPlayerTiles = await redis.lrange(
            HAND_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const parsedTiles = rawPlayerTiles.map((tile) => JSON.parse(tile));

          const rawKong = await redis.lrange(
            KONG_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const rawPong = await redis.lrange(
            PONG_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const rawChow = await redis.lrange(
            CHOW_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );
          const kongData = rawKong.map((item) => JSON.parse(item));
          const pongData = rawPong.map((item) => JSON.parse(item));
          const chowData = rawChow.map((item) => JSON.parse(item));

          const ownDiscardTilesRaw = await redis.lrange(
            PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
            0,
            -1,
          );

          const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

          if (Number(currentPlayer.userId) === Number(targetPlayer.userId)) {
            handState.push({
              last_discard_tile: null,
              pong: pongData,
              chow: chowData,
              kong: kongData,
              discarded_tiles: ownDiscardTiles,
              userId: targetPlayer.userId,
              user_name: targetPlayer.name,
              isSelf: true,
              seat_position: targetPlayer.seat,
              tileCount: parsedTiles.length,
              tiles: parsedTiles,
            });
          } else {
            handState.push({
              last_discard_tile: null,
              pong: pongData,
              chow: chowData,
              kong: kongData,
              discarded_tiles: ownDiscardTiles,
              userId: targetPlayer.userId,
              user_name: targetPlayer.name,
              isSelf: false,
              seat_position: targetPlayer.seat,
              tileCount: parsedTiles.length,
              tiles: Array.from({ length: parsedTiles.length }, () => ({
                id: null,
                type: "hidden",
                number: null,
                copy_no: null,
              })),
            });
          }
        }

        await redis.set(
          PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
          JSON.stringify(handState),
        );

        io.to(`user:${currentPlayer.userId}`).emit(
          "mahjong:initial_hand_state",
          handState,
        );
      }

      const winning_hand_result = await MahJongRoomManager.checkWinningHand(
        roomId,
        nextPlayer.userId,
      );
      console.log("WH In NP: ", winning_hand_result);
      if (winning_hand_result.canWin) {
        io.to(`user:${nextPlayer.userId}`).emit("mahjong:you_win");
        await MahJongRoomManager.storeWinningData(roomId, nextPlayer.userId);
        const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
        const winningData = JSON.parse(winningDataRaw);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:winner_reveal", winningData);
        await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
        await MahJongRoomManager.endRound(roomId, io);
        return;
      }
    } else {
      if (wallCount <= 0) {
        if (pongData.canPong) {
          io.to(`user:${nextPlayer.userId}`).emit("mahjong:can_normal_pong", {
            canPong: pongData.canPong,
            groups: pongData.groups,
          });
        } else if (!pongData.canPong && chowData.canChow) {
          io.to(`user:${nextPlayer.userId}`).emit("mahjong:can_normal_chow", {
            canChow: chowData.canChow,
            groups: chowData.groups,
          });
        } else if (!pongData.canPong && !chowData.canChow) {
          io.to(SOCKET_ROOM(roomId)).emit("mahjong:draw_round");
          await MahJongRoomManager.endRound(roomId, io);
          return;
        }
      } else {
        if (kongData.canKong) {
          io.to(`user:${nextPlayer.userId}`).emit("mahjong:can_normal_kong", {
            canKong: kongData.canKong,
            groups: kongData.groups,
          });
        } else if (!kongData.canKong && pongData.canPong) {
          io.to(`user:${nextPlayer.userId}`).emit("mahjong:can_normal_pong", {
            canPong: pongData.canPong,
            groups: pongData.groups,
          });
        } else if (!pongData.canPong && chowData.canChow) {
          io.to(`user:${nextPlayer.userId}`).emit("mahjong:can_normal_chow", {
            canChow: chowData.canChow,
            groups: chowData.groups,
          });
        }
      }
    }

    let remaining = duration;

    const countdownInterval = setInterval(async () => {
      const winningDataExist = await redis.get(WINNING_DATA_KEY(roomId));
      const alreadyDiscardedRaw = await redis.get(LAST_DISCARD_KEY(roomId));
      const alreadyDiscarded = alreadyDiscardedRaw
        ? JSON.parse(alreadyDiscardedRaw)
        : null;
      // console.log("ALREADY_DISCARD", alreadyDiscarded);
      // console.log("NEXT_PLAYER", nextPlayer);
      if (
        winningDataExist ||
        alreadyDiscarded?.discard_by == nextPlayer.userId
      ) {
        // console.log("shoud stop");
        // remaining = 0;
        clearInterval(countdownInterval);

        io.to(`user:${nextPlayer.userId}`).emit(
          "mahjong:turn_countdown_finished",
          {
            user_id: nextPlayer.userId,
          },
        );
        return;
      }
      remaining--;

      io.to(`user:${nextPlayer.userId}`).emit("mahjong:turn_countdown", {
        user_id: nextPlayer.userId,
        remaining,
      });

      /**
       * Timeout
       */
      if (remaining <= 0) {
        clearInterval(countdownInterval);

        io.to(`user:${nextPlayer.userId}`).emit(
          "mahjong:turn_countdown_finished",
          {
            user_id: nextPlayer.userId,
          },
        );

        // auto draw and auto discard

        if (kongData.canKong || pongData.canPong || chowData.canChow) {
          const current_last_discard_tile_raw = await redis.get(
            LAST_DISCARD_KEY(roomId),
          );
          const current_last_discard_tile = current_last_discard_tile_raw
            ? JSON.parse(current_last_discard_tile_raw)
            : null;
          if (
            current_last_discard_tile &&
            current_last_discard_tile.discard_by !== nextPlayer.userId
          ) {
            if (wallCount <= 0) {
              io.to(SOCKET_ROOM(roomId)).emit("mahjong:draw_round");
              await MahJongRoomManager.endRound(roomId, io);
              return;
            }

            await redis.del(LAST_DISCARD_KEY(roomId));

            await redis.rpush(
              PLAYER_DISCARD_TILES_KEY(
                roomId,
                current_last_discard_tile.discard_by,
              ),
              JSON.stringify(current_last_discard_tile.tile),
            );

            drawTile = await redis.lpop(WALL_KEY(roomId));
            // console.log("DRAW TILE", drawTile);

            const newWallCount = await redis.llen(WALL_KEY(roomId));

            io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
              newWallCount,
            });

            await redis.rpush(HAND_KEY(roomId, nextPlayer.userId), drawTile);

            const roundPlayersRaw = await redis.hgetall(
              ROUND_PLAYERS_KEY(roomId),
            );

            const players = Object.values(roundPlayersRaw)
              .map(JSON.parse)
              .sort((a, b) => a.seat - b.seat);

            for (const currentPlayer of players) {
              const handState = [];

              for (const targetPlayer of players) {
                const rawPlayerTiles = await redis.lrange(
                  HAND_KEY(roomId, targetPlayer.userId),
                  0,
                  -1,
                );

                const parsedTiles = rawPlayerTiles.map((tile) =>
                  JSON.parse(tile),
                );

                const rawKong = await redis.lrange(
                  KONG_KEY(roomId, targetPlayer.userId),
                  0,
                  -1,
                );

                const rawPong = await redis.lrange(
                  PONG_KEY(roomId, targetPlayer.userId),
                  0,
                  -1,
                );

                const rawChow = await redis.lrange(
                  CHOW_KEY(roomId, targetPlayer.userId),
                  0,
                  -1,
                );
                const kongData = rawKong.map((item) => JSON.parse(item));
                const pongData = rawPong.map((item) => JSON.parse(item));
                const chowData = rawChow.map((item) => JSON.parse(item));

                const ownDiscardTilesRaw = await redis.lrange(
                  PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
                  0,
                  -1,
                );

                const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);

                if (
                  Number(currentPlayer.userId) === Number(targetPlayer.userId)
                ) {
                  handState.push({
                    last_discard_tile: null,
                    pong: pongData,
                    chow: chowData,
                    kong: kongData,
                    discarded_tiles: ownDiscardTiles,
                    userId: targetPlayer.userId,
                    user_name: targetPlayer.name,
                    isSelf: true,
                    seat_position: targetPlayer.seat,
                    tileCount: parsedTiles.length,
                    tiles: parsedTiles,
                  });
                } else {
                  handState.push({
                    last_discard_tile: null,
                    pong: pongData,
                    chow: chowData,
                    kong: kongData,
                    discarded_tiles: ownDiscardTiles,
                    userId: targetPlayer.userId,
                    user_name: targetPlayer.name,
                    isSelf: false,
                    seat_position: targetPlayer.seat,
                    tileCount: parsedTiles.length,
                    tiles: Array.from({ length: parsedTiles.length }, () => ({
                      id: null,
                      type: "hidden",
                      number: null,
                      copy_no: null,
                    })),
                  });
                }
              }

              await redis.set(
                PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
                JSON.stringify(handState),
              );

              io.to(`user:${currentPlayer.userId}`).emit(
                "mahjong:initial_hand_state",
                handState,
              );
            }

            const winning_hand_result =
              await MahJongRoomManager.checkWinningHand(
                roomId,
                nextPlayer.userId,
              );
            if (winning_hand_result.canWin) {
              io.to(`user:${nextPlayer.userId}`).emit("mahjong:you_win");
              await MahJongRoomManager.storeWinningData(
                roomId,
                nextPlayer.userId,
              );
              const winningDataRaw = await redis.get(WINNING_DATA_KEY(roomId));
              const winningData = JSON.parse(winningDataRaw);
              io.to(SOCKET_ROOM(roomId)).emit(
                "mahjong:winner_reveal",
                winningData,
              );
              await redis.del(TURN_COUNTDOWN_END_KEY(roomId));
              await MahJongRoomManager.endRound(roomId, io);
              return;
            }
            const tileToDiscard = JSON.parse(drawTile);
            io.to(`user:${nextPlayer.userId}`).emit(
              "mahjong:remove_kong_decision",
            );
            io.to(`user:${nextPlayer.userId}`).emit(
              "mahjong:remove_pong_decision",
            );
            io.to(`user:${nextPlayer.userId}`).emit(
              "mahjong:remove_chow_decision",
            );

            await MahJongRoomManager.discardTile(
              socket,
              {
                roomId: roomId,
                userId: nextPlayer.userId,
                tileId: tileToDiscard.id,
              },
              io,
            );
            await MahJongRoomManager.wait(2000);
          } else if (!current_last_discard_tile) {
            const tile_to_discard_raw = await redis.lindex(
              HAND_KEY(roomId, nextPlayer.userId),
              -1,
            );
            const tile_to_discard = JSON.parse(tile_to_discard_raw);
            await MahJongRoomManager.discardTile(
              socket,
              {
                roomId: roomId,
                userId: nextPlayer.userId,
                tileId: tile_to_discard.id,
              },
              io,
            );
          }
        } else {
          const tileToDiscard = JSON.parse(drawTile);
          await MahJongRoomManager.discardTile(
            socket,
            {
              roomId: roomId,
              userId: nextPlayer.userId,
              tileId: tileToDiscard.id,
            },
            io,
          );
        }

        /**
         * Auto discard last tile
         */

        // await this.autoDiscardLastTile(roomId, userId, io);
      }
    }, 1000);
  }

  static async checkWinningHand(roomId, userId) {
    // // temporary codes. delete later
    // await redis.del(HAND_KEY(roomId, userId));

    // const testTiles = [
    //   {
    //     id: 46,
    //     type: "bamboo",
    //     number: 3,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 47,
    //     type: "bamboo",
    //     number: 3,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 48,
    //     type: "bamboo",
    //     number: 3,
    //     copy_no: 4,
    //   },
    //   {
    //     id: 3,
    //     type: "dot",
    //     number: 5,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 4,
    //     type: "dot",
    //     number: 5,
    //     copy_no: 4,
    //   },
    //   {
    //     id: 2,
    //     type: "dot",
    //     number: 5,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 49,
    //     type: "bamboo",
    //     number: 4,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 56,
    //     type: "bamboo",
    //     number: 5,
    //     copy_no: 4,
    //   },
    //   {
    //     id: 58,
    //     type: "bamboo",
    //     number: 6,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 37,
    //     type: "dot",
    //     number: 2,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 43,
    //     type: "dot",
    //     number: 1,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 68,
    //     type: "bamboo",
    //     number: 8,
    //     copy_no: 4,
    //   },
    //   {
    //     id: 71,
    //     type: "bamboo",
    //     number: 9,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 61,
    //     type: "bamboo",
    //     number: 7,
    //     copy_no: 1,
    //   },
    // ];

    // for (const tile of testTiles) {
    //   await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    // }

    // const playerViewRawTest = await redis.get(
    //   PLAYER_VIEW_HAND_KEY(roomId, userId),
    // );

    // if (playerViewRawTest) {
    //   const handState = JSON.parse(playerViewRawTest);

    //   const updatedHandState = handState.map((player) => {
    //     /**
    //      * update self player only
    //      */
    //     if (Number(player.userId) === Number(userId)) {
    //       return {
    //         ...player,
    //         tileCount: testTiles.length,
    //         tiles: testTiles,
    //       };
    //     }

    //     /**
    //      * keep others unchanged
    //      */
    //     return player;
    //   });

    //   await redis.set(
    //     PLAYER_VIEW_HAND_KEY(roomId, userId),
    //     JSON.stringify(updatedHandState),
    //   );
    // }
    // // temporary codes. delete later
    /**
     * =====================================
     * 1. Get player full hand view
     * =====================================
     */

    const playerViewRaw = await redis.get(PLAYER_VIEW_HAND_KEY(roomId, userId));

    const handState = JSON.parse(playerViewRaw);

    const selfPlayer = handState.find(
      (player) => Number(player.userId) === Number(userId),
    );

    const tiles = selfPlayer.tiles || [];

    let revealedMeldCount = 0;

    if (selfPlayer.chow && Array.isArray(selfPlayer.chow)) {
      revealedMeldCount += selfPlayer.chow.length;
    }

    if (selfPlayer.pong && Array.isArray(selfPlayer.pong)) {
      revealedMeldCount += selfPlayer.pong.length;
    }

    if (selfPlayer.kong && Array.isArray(selfPlayer.kong)) {
      revealedMeldCount += selfPlayer.kong.length;
    }

    const remainingMeldsNeeded = 4 - revealedMeldCount;

    // if (remainingMeldsNeeded < 0) {
    //   return {
    //     canWin: false,
    //     reason: "Too many revealed melds",
    //   };
    // }

    const counts = {};

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;
      counts[key] = (counts[key] || 0) + 1;
    }

    // for (const key in counts) {
    //   if (counts[key] >= 2) {
    //     counts[key] -= 2;

    //     if (this.canFormMeldsByCount({ ...counts }, remainingMeldsNeeded)) {
    //       counts[key] += 2;

    //       return {
    //         canWin: true,
    //         winningPair: key,
    //         revealedMeldCount,
    //         remainingMeldsNeeded,
    //       };
    //     }
    //     counts[key] += 2;
    //   }
    // }

    // return {
    //   canWin: false,
    //   reason: "No valid winning pattern",
    // };

    const canWin = this.canWinWithMeldsAndPair(counts, remainingMeldsNeeded);

    return canWin
      ? {
          canWin: true,
          revealedMeldCount,
          remainingMeldsNeeded,
        }
      : {
          canWin: false,
          reason: "No valid winning structure",
        };
  }

  static canWinWithMeldsAndPair(counts, meldsNeeded) {
    const keys = Object.keys(counts).sort((a, b) => {
      const [typeA, numA] = a.split("_");
      const [typeB, numB] = b.split("_");

      if (typeA !== typeB) return typeA.localeCompare(typeB);
      return Number(numA) - Number(numB);
    });

    console.log("======== START PAIR CHECK ========");
    console.log("Counts:", counts);
    console.log("Melds Needed:", meldsNeeded);

    for (const key of keys) {
      if (counts[key] >= 2) {
        console.log(`\n🟣 TRY PAIR: ${key}`);

        counts[key] -= 2;

        if (this.canFormExactMelds({ ...counts }, meldsNeeded, 0)) {
          console.log(`🟢 SUCCESS with pair: ${key}`);
          counts[key] += 2;
          return true;
        }

        console.log(`🔴 FAIL with pair: ${key}`);
        counts[key] += 2;
      }
    }

    console.log("❌ NO VALID PAIR FOUND");
    return false;
  }

  static canFormExactMelds(counts, meldsNeeded, depth = 0) {
    const indent = "  ".repeat(depth);

    const keys = Object.keys(counts).sort((a, b) => {
      const [typeA, numA] = a.split("_");
      const [typeB, numB] = b.split("_");

      if (typeA !== typeB) return typeA.localeCompare(typeB);
      return Number(numA) - Number(numB);
    });

    let firstKey = null;

    for (const key of keys) {
      if (counts[key] > 0) {
        firstKey = key;
        break;
      }
    }

    console.log(`${indent}---`);
    console.log(`${indent}Counts:`, counts);
    console.log(`${indent}MeldsNeeded:`, meldsNeeded);

    // ✅ base case
    if (!firstKey) {
      console.log(`${indent}✅ No tiles left. meldsNeeded=${meldsNeeded}`);
      return meldsNeeded === 0;
    }

    if (meldsNeeded < 0) {
      console.log(`${indent}❌ Melds exceeded`);
      return false;
    }

    const [type, numStr] = firstKey.split("_");
    const num = Number(numStr);

    console.log(`${indent}👉 Trying tile: ${firstKey}`);

    // -----------------------------
    // TRY PONG
    // -----------------------------
    if (counts[firstKey] >= 3) {
      console.log(`${indent}🟡 Try PONG: ${firstKey}`);

      const next = { ...counts };
      next[firstKey] -= 3;

      if (this.canFormExactMelds(next, meldsNeeded - 1, depth + 1)) {
        console.log(`${indent}✅ PONG success: ${firstKey}`);
        return true;
      }

      console.log(`${indent}❌ PONG failed: ${firstKey}`);
    }

    // -----------------------------
    // TRY CHOW
    // -----------------------------
    if (type !== "wind" && type !== "dragon") {
      const k2 = `${type}_${num + 1}`;
      const k3 = `${type}_${num + 2}`;

      if (counts[k2] > 0 && counts[k3] > 0) {
        console.log(`${indent}🟢 Try CHOW: ${firstKey}, ${k2}, ${k3}`);

        const next = { ...counts };
        next[firstKey]--;
        next[k2]--;
        next[k3]--;

        if (this.canFormExactMelds(next, meldsNeeded - 1, depth + 1)) {
          console.log(`${indent}✅ CHOW success: ${firstKey}`);
          return true;
        }

        console.log(`${indent}❌ CHOW failed: ${firstKey}`);
      } else {
        console.log(`${indent}⚪ CHOW not possible: ${firstKey}`);
      }
    }

    console.log(`${indent}🚫 Backtrack from: ${firstKey}`);
    return false;
  }

  // static canFormMeldsByCount(counts, meldsNeeded) {
  //   // base case
  //   if (meldsNeeded === 0) {
  //     for (const key in counts) {
  //       if (counts[key] > 0) return false;
  //     }
  //     return true;
  //   }

  //   // TRY ALL POSSIBLE START TILES (IMPORTANT FIX)
  //   for (const key in counts) {
  //     if (counts[key] <= 0) continue;

  //     const [type, numStr] = key.split("_");
  //     const num = Number(numStr);

  //     // -----------------------------
  //     // TRY PONG
  //     // -----------------------------
  //     if (counts[key] >= 3) {
  //       counts[key] -= 3;

  //       if (this.canFormMeldsByCount(counts, meldsNeeded - 1)) {
  //         counts[key] += 3;
  //         return true;
  //       }

  //       counts[key] += 3;
  //     }

  //     // -----------------------------
  //     // TRY CHOW
  //     // -----------------------------
  //     const key2 = `${type}_${num + 1}`;
  //     const key3 = `${type}_${num + 2}`;

  //     if (
  //       type !== "wind" &&
  //       type !== "dragon" && // safety if you have honors
  //       counts[key2] > 0 &&
  //       counts[key3] > 0
  //     ) {
  //       counts[key]--;
  //       counts[key2]--;
  //       counts[key3]--;

  //       if (this.canFormMeldsByCount(counts, meldsNeeded - 1)) {
  //         counts[key]++;
  //         counts[key2]++;
  //         counts[key3]++;
  //         return true;
  //       }

  //       counts[key]++;
  //       counts[key2]++;
  //       counts[key3]++;
  //     }
  //   }

  //   return false;
  // }

  static async checkKongExist(roomId, userId) {
    // temporary codes. delete later
    // await redis.del(HAND_KEY(roomId, userId));

    // const testTiles = [
    //   // ===== KONG (4 same tiles) =====
    //   {
    //     id: 9991,
    //     type: "bamboo",
    //     number: 3,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9992,
    //     type: "bamboo",
    //     number: 3,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 9993,
    //     type: "bamboo",
    //     number: 3,
    //     copy_no: 3,
    //   },
    //   {
    //     id: 9994,
    //     type: "bamboo",
    //     number: 3,
    //     copy_no: 4,
    //   },

    //   // ===== OTHER 10 TILES =====
    //   {
    //     id: 9995,
    //     type: "dot",
    //     number: 1,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9996,
    //     type: "dot",
    //     number: 2,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9997,
    //     type: "dot",
    //     number: 3,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 9998,
    //     type: "bamboo",
    //     number: 5,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 9999,
    //     type: "bamboo",
    //     number: 6,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 10000,
    //     type: "bamboo",
    //     number: 7,
    //     copy_no: 1,
    //   },

    //   {
    //     id: 10001,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 1,
    //   },
    //   {
    //     id: 10002,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 2,
    //   },
    //   {
    //     id: 10003,
    //     type: "dot",
    //     number: 7,
    //     copy_no: 3,
    //   },

    //   {
    //     id: 10004,
    //     type: "bamboo",
    //     number: 9,
    //     copy_no: 1,
    //   },
    // ];

    // for (const tile of testTiles) {
    //   await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(tile));
    // }
    // temporary codes. delete later

    const rawTiles = await redis.lrange(HAND_KEY(roomId, userId), 0, -1);

    const tiles = rawTiles.map((tile) => JSON.parse(tile));

    const tileMap = {};
    const kongGroups = [];

    for (const tile of tiles) {
      const key = `${tile.type}_${tile.number}`;

      if (!tileMap[key]) {
        tileMap[key] = [];
      }

      tileMap[key].push(tile);
    }

    /**
     * Find ALL possible kongs
     */
    for (const key in tileMap) {
      if (tileMap[key].length >= 4) {
        kongGroups.push({
          tileKey: key,
          tiles: tileMap[key].slice(0, 4),
        });
      }
    }

    return {
      canKong: kongGroups.length > 0,
      groups: kongGroups,
    };
  }

  static async storeWinningData(roomId, userId) {
    const playerViewRaw = await redis.get(PLAYER_VIEW_HAND_KEY(roomId, userId));

    const handState = JSON.parse(playerViewRaw);

    const selfPlayer = handState.find(
      (player) => Number(player.userId) === Number(userId),
    );

    if (!selfPlayer) {
      return {
        success: false,
        message: "Winner player data not found",
      };
    }

    const winningData = {
      winner_user_id: selfPlayer.userId,
      winner_user_name: selfPlayer.user_name || null,

      handTiles: selfPlayer.tiles || [],

      chow: selfPlayer.chow || [],
      pong: selfPlayer.pong || [],
      kong: selfPlayer.kong || [],
    };

    await redis.set(WINNING_DATA_KEY(roomId), JSON.stringify(winningData));

    return {
      success: true,
      message: "Winning data stored successfully",
      data: winningData,
    };
  }

  static async sortHand(socket, payload, io) {
    const { roomId, userId } = payload;

    const playing_phase_with_tile = await redis.get(
      PLAYING_PHASE_WITH_TILE_KEY(roomId),
    );

    if (playing_phase_with_tile !== "playing_game_with_tile") {
      return;
    }

    const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

    const players = Object.values(roundPlayersRaw)
      .map(JSON.parse)
      .sort((a, b) => a.seat - b.seat);

    const discardTileRaw = await redis.get(LAST_DISCARD_KEY(roomId));
    const discardTile = discardTileRaw ? JSON.parse(discardTileRaw) : null;
    const discard_tile = discardTile ? discardTile.tile : null;

    const handState = [];

    // const smartSortTiles = (tiles) => {
    //   const tileCountMap = {};

    //   for (const tile of tiles) {
    //     const key = `${tile.type}_${tile.number}`;
    //     tileCountMap[key] = (tileCountMap[key] || 0) + 1;
    //   }

    //   return tiles.sort((a, b) => {
    //     const typeOrder = {
    //       bamboo: 1,
    //       dot: 2,
    //     };

    //     const keyA = `${a.type}_${a.number}`;
    //     const keyB = `${b.type}_${b.number}`;

    //     const countA = tileCountMap[keyA] || 0;
    //     const countB = tileCountMap[keyB] || 0;

    //     if (countA !== countB) {
    //       return countB - countA;
    //     }

    //     const typeA = typeOrder[a.type] || 999;
    //     const typeB = typeOrder[b.type] || 999;

    //     if (typeA !== typeB) {
    //       return typeA - typeB;
    //     }

    //     if (a.number !== b.number) {
    //       return a.number - b.number;
    //     }

    //     return (a.copy_no || 0) - (b.copy_no || 0);
    //   });
    // };

    const smartSortTiles = (tiles) => {
      const typeOrder = {
        bamboo: 1,
        dot: 2,
      };

      /**
       * =====================================
       * 1. Build map
       * =====================================
       */
      const map = {};

      for (const tile of tiles) {
        const key = `${tile.type}_${tile.number}`;
        if (!map[key]) map[key] = [];
        map[key].push(tile);
      }

      const used = new Set();

      const result = [];

      /**
       * =====================================
       * 2. KONG (4 same)
       * =====================================
       */
      for (const key in map) {
        if (map[key].length >= 4) {
          result.push(...map[key].slice(0, 4));
          used.add(key);
        }
      }

      /**
       * =====================================
       * 3. PONG (3 same)
       * =====================================
       */
      for (const key in map) {
        if (used.has(key)) continue;

        if (map[key].length >= 3) {
          result.push(...map[key].slice(0, 3));
          used.add(key);
        }
      }

      /**
       * =====================================
       * 4. CHOW (sequence)
       * =====================================
       */
      const remainingTiles = tiles.filter((t) => {
        const key = `${t.type}_${t.number}`;
        return !used.has(key);
      });

      const sortedRemaining = remainingTiles.sort((a, b) => {
        if (a.type !== b.type) {
          return typeOrder[a.type] - typeOrder[b.type];
        }
        return a.number - b.number;
      });

      const visited = new Array(sortedRemaining.length).fill(false);

      for (let i = 0; i < sortedRemaining.length; i++) {
        if (visited[i]) continue;

        const a = sortedRemaining[i];
        const b = sortedRemaining[i + 1];
        const c = sortedRemaining[i + 2];

        if (
          b &&
          c &&
          a.type === b.type &&
          a.type === c.type &&
          a.number + 1 === b.number &&
          a.number + 2 === c.number
        ) {
          result.push(a, b, c);
          visited[i] = visited[i + 1] = visited[i + 2] = true;
        }
      }

      /**
       * =====================================
       * 5. LEFTOVER (pairs/singles)
       * =====================================
       */
      for (let i = 0; i < sortedRemaining.length; i++) {
        if (!visited[i]) {
          result.push(sortedRemaining[i]);
        }
      }

      return result;
    };

    for (const targetPlayer of players) {
      /**
       * =====================================
       * Get hand tiles
       * =====================================
       */
      const rawTiles = await redis.lrange(
        HAND_KEY(roomId, targetPlayer.userId),
        0,
        -1,
      );

      const parsedTiles = rawTiles.map(JSON.parse);

      /**
       * =====================================
       * Get melds (FIXED: use LRANGE, not GET)
       * =====================================
       */
      const rawChow = await redis.lrange(
        CHOW_KEY(roomId, targetPlayer.userId),
        0,
        -1,
      );

      const rawPong = await redis.lrange(
        PONG_KEY(roomId, targetPlayer.userId),
        0,
        -1,
      );

      const rawKong = await redis.lrange(
        KONG_KEY(roomId, targetPlayer.userId),
        0,
        -1,
      );

      const chow = rawChow.map(JSON.parse);
      const pong = rawPong.map(JSON.parse);
      const kong = rawKong.map(JSON.parse);

      const ownDiscardTilesRaw = await redis.lrange(
        PLAYER_DISCARD_TILES_KEY(roomId, targetPlayer.userId),
        0,
        -1,
      );

      const ownDiscardTiles = ownDiscardTilesRaw.map(JSON.parse);
      /**
       * =====================================
       * Self vs others view
       * =====================================
       */
      const isSelf = Number(targetPlayer.userId) === Number(userId);

      if (isSelf) {
        const sortedTiles = smartSortTiles(parsedTiles);
        // console.log("SORT_TILES", sortedTiles);
        await redis.del(HAND_KEY(roomId, targetPlayer.userId));

        for (const tile of sortedTiles) {
          await redis.rpush(
            HAND_KEY(roomId, targetPlayer.userId),
            JSON.stringify(tile),
          );
        }

        handState.push({
          last_discard_tile: discard_tile,
          chow,
          pong,
          kong,
          discarded_tiles: ownDiscardTiles,
          userId: targetPlayer.userId,
          user_name: targetPlayer.name,
          isSelf: true,
          seat_position: targetPlayer.seat,
          tileCount: sortedTiles.length,
          tiles: sortedTiles,
        });
      } else {
        handState.push({
          last_discard_tile: discard_tile,
          chow,
          pong,
          kong,
          discarded_tiles: ownDiscardTiles,
          userId: targetPlayer.userId,
          user_name: targetPlayer.name,
          isSelf: false,
          seat_position: targetPlayer.seat,
          tileCount: parsedTiles.length,
          tiles: Array.from({ length: parsedTiles.length }, () => ({
            id: null,
            type: "hidden",
            number: null,
            copy_no: null,
          })),
        });
      }
    }

    /**
     * Save private view
     */
    await redis.set(
      PLAYER_VIEW_HAND_KEY(roomId, userId),
      JSON.stringify(handState),
    );

    /**
     * Emit to player
     */
    io.to(`user:${userId}`).emit("mahjong:initial_hand_state", handState);
  }

  // ================= END ROUND =================
  static async endRound(roomId, io) {
    await this.wait(3000);
    const round = await redis.get(ROUND_KEY(roomId));
    const roundData = JSON.parse(round);
    await ToLaravelService.endRound(roundData.roundId);
    io.to(SOCKET_ROOM(roomId)).emit("mahjong:round_end");
    await this.wait(3000);
    await this.clearRoomData(roomId, io);
  }

  // ================= Temporary Function =================
  static async clearRoomData(roomId, io) {
    /**
     * =====================================
     * Get all players + guests
     * =====================================
     */
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
    ]);

    /**
     * =====================================
     * Remove sockets from room
     * =====================================
     */
    io.in(SOCKET_ROOM(roomId)).socketsLeave(SOCKET_ROOM(roomId));
  }

  // ================= STATE =================
  static async getState(roomId, userId) {
    const [
      room,
      match,
      round,
      players,
      roundPlayers,
      guests,
      status,
      countdownEnd,
      diceRaw,
      firstPlayerRaw,
      handStateRaw,
      wallCount,
    ] = await Promise.all([
      redis.get(ROOM_KEY(roomId)),
      redis.get(MATCH_KEY(roomId)),
      redis.get(ROUND_KEY(roomId)),
      redis.hgetall(PLAYERS_KEY(roomId)),
      redis.hgetall(ROUND_PLAYERS_KEY(roomId)),
      redis.hgetall(GUESTS_KEY(roomId)),
      redis.get(ROOM_STATUS_KEY(roomId)),
      redis.get(COUNTDOWN_KEY(roomId)),
      redis.get(ROOM_DICE_KEY(roomId)),
      redis.get(ROOM_FIRST_PLAYER_KEY(roomId)),
      userId
        ? redis.get(PLAYER_VIEW_HAND_KEY(roomId, userId))
        : Promise.resolve(null),
      redis.llen(WALL_KEY(roomId)),
    ]);

    // parse safely
    let dice = null;
    let firstPlayer = null;
    let handState = null;

    try {
      if (diceRaw) dice = JSON.parse(diceRaw);
    } catch (e) {
      console.error("Invalid dice data");
    }

    try {
      if (firstPlayerRaw) firstPlayer = JSON.parse(firstPlayerRaw);
    } catch (e) {
      console.error("Invalid first player data");
    }

    try {
      if (handStateRaw) {
        handState = JSON.parse(handStateRaw);
      }
    } catch (e) {
      console.error("Invalid hand state data");
    }

    return {
      room: room ? JSON.parse(room) : null,
      match: match ? JSON.parse(match) : null,
      round: round ? JSON.parse(round) : null,
      status,
      countdownRemaining: countdownEnd
        ? Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000))
        : null,
      players: Object.values(players).map(JSON.parse),
      roundPlayers: Object.values(roundPlayers).map(JSON.parse),
      guests: Object.values(guests).map(JSON.parse),

      // ✅ new fields
      dice, // { d1, d2, total }
      firstPlayer, // { user_id, user_name }
      handState,
      wallCount,
    };
  }

  static wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static async recoverRoomState(roomId, user, socket, io) {
    const data = await ToLaravelService.getRoomData(roomId);
    roomMemoryStore.set(roomId, data);
    const state = await this.getState(roomId, user.id);
    socket.join(SOCKET_ROOM(roomId));
    socket.join(`user:${user.id}`);
    socket.emit("mahjong:current_state", state);
    const status = await redis.get(ROOM_STATUS_KEY(roomId));
    if (!status || status == "waiting") {
      await this.tryStartRound(roomId, io, socket, user.id);
    } else if (status == "countdown") {
      const endTime = await redis.get(COUNTDOWN_KEY(roomId));
      this.runCountdown(socket, roomId, endTime, io);
    } else if (status == "playing") {
      const round_exist = await redis.exists(ROUND_KEY(roomId));
      if (!round_exist) {
        await this.startRound(socket, roomId, io);
        return;
      }
      const phase = await redis.get(ROOM_PLAYING_PHASE_KEY(roomId));
      if (phase == "dice_rolling") {
        const roundPlayers = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

        const players = Object.values(roundPlayers).map((player) => {
          const p = JSON.parse(player);

          return {
            user_id: p.userId,
            name: p.name,
            seat_position: p.seat,
          };
        });
        await this.rollDice(roomId, players, io);
      } else if (phase == "dice_rolling_end") {
        const roundPlayers = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

        const players = Object.values(roundPlayers).map((player) => {
          const p = JSON.parse(player);

          return {
            user_id: p.userId,
            name: p.name,
            seat_position: p.seat,
          };
        });
        const sorted = [...players].sort(
          (a, b) => a.seat_position - b.seat_position,
        );

        const diceRaw = await redis.get(ROOM_DICE_KEY(roomId));
        const diceData = JSON.parse(diceRaw);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:dice_rolled", {
          dice: [diceData.d1, diceData.d2],
          total: diceData.total,
        });
        const total = diceData.total;
        await this.wait(5000);

        const index = (total - 1) % sorted.length;
        const user_to_play_first = sorted[index];

        await redis.set(
          ROOM_FIRST_PLAYER_KEY(roomId),
          JSON.stringify({
            user_id: user_to_play_first.user_id,
            user_name: user_to_play_first.name,
          }),
        );

        await redis.set(
          ROOM_PLAYING_PHASE_KEY(roomId),
          "user_to_play_first_selected",
        );

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play", {
          user_id: user_to_play_first.user_id,
          user_name: user_to_play_first.name,
        });
      } else if (phase == "user_to_play_first_selected") {
        const firstPlayerRaw = await redis.get(ROOM_FIRST_PLAYER_KEY(roomId));
        const firstPlayer = JSON.parse(firstPlayerRaw);

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play", {
          user_id: firstPlayer.user_id,
          user_name: firstPlayer.user_name,
        });
      } else if (phase == "shuffling_tiles") {
        const firstPlayerRaw = await redis.get(ROOM_FIRST_PLAYER_KEY(roomId));
        const firstPlayer = JSON.parse(firstPlayerRaw);
        await this.shuffleAndDealTiles(roomId, firstPlayer.user_id, io);
      } else if (phase == "dealing_tiles") {
        // emit wall count
        const wallCount = await redis.llen(WALL_KEY(roomId));

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:wall_count_updated", {
          wallCount,
        });
        //
        const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));

        const players = Object.values(roundPlayersRaw)
          .map(JSON.parse)
          .sort((a, b) => a.seat - b.seat);

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:dealing_tiles");
        // temp waiting. might delete later
        // await this.wait(2000);

        for (const currentPlayer of players) {
          const handState = [];
          const data = await redis.get(
            PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
          );
          if (data) {
            io.to(`user:${currentPlayer.userId}`).emit(
              "mahjong:initial_hand_state",
              JSON.parse(data),
            );
            continue;
          }

          for (const targetPlayer of players) {
            const rawTiles = await redis.lrange(
              HAND_KEY(roomId, targetPlayer.userId),
              0,
              -1,
            );

            const parsedTiles = rawTiles.map((tile) => JSON.parse(tile));

            // Own hand → actual tiles
            if (currentPlayer.userId === targetPlayer.userId) {
              handState.push({
                last_discard_tile: null,
                pong: null,
                chow: null,
                kong: null,
                userId: targetPlayer.userId,
                user_name: targetPlayer.name,
                isSelf: true,
                seat_position: targetPlayer.seat,
                tileCount: parsedTiles.length,
                tiles: parsedTiles,
              });
            }

            // Other players → hidden tiles
            else {
              handState.push({
                last_discard_tile: null,
                pong: null,
                chow: null,
                kong: null,
                userId: targetPlayer.userId,
                user_name: targetPlayer.name,
                isSelf: false,
                seat_position: targetPlayer.seat,
                tileCount: parsedTiles.length,
                tiles: Array.from({ length: parsedTiles.length }, () => ({
                  id: null,
                  type: "hidden",
                  number: null,
                  copy_no: null,
                })),
              });
            }
          }

          // Store full player view in Redis
          await redis.set(
            PLAYER_VIEW_HAND_KEY(roomId, currentPlayer.userId),
            JSON.stringify(handState),
          );

          // Send to user's private room
          io.to(`user:${currentPlayer.userId}`).emit(
            "mahjong:initial_hand_state",
            handState,
          );
        }

        // this temporary round end codes // might delete later
        await this.wait(10000);
        await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "round_end");
        const round = await redis.get(ROUND_KEY(roomId));
        const roundData = JSON.parse(round);
        await ToLaravelService.endRound(roundData.roundId);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:round_end");
        await this.wait(5000);
        await this.clearRoomData(roomId, io);
      } else if (phase == "round_end") {
        const round = await redis.get(ROUND_KEY(roomId));
        const roundData = JSON.parse(round);
        await ToLaravelService.endRound(roundData.roundId);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:round_end");
        await this.wait(5000);
        await this.clearRoomData(roomId, io);
      }
    }
  }
}
