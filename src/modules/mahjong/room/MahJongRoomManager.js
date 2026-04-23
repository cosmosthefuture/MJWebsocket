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
const COUNTDOWN_KEY = (roomId) => `room:${roomId}:countdown_end`;

const ROOM_DICE_KEY = (roomId) => `room:${roomId}:dice`;
const ROOM_FIRST_PLAYER_KEY = (roomId) => `room:${roomId}:first_player`;

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

        const state = await this.getState(roomId);
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
          socket.emit("mahjong:user_to_play_first_selected", {
            user_id_to_play_first: firstPlayer.user_id,
            user_name_to_play_first: firstPlayer.user_name,
          });
        } else if (phase == "round_end") {
          socket.emit("mahjong:round_end");
        }
      } else if (status === "countdown") {
        const state = await this.getState(roomId);
        socket.emit(events.JOIN_SUCCESS, state);

        const players = await redis.hgetall(PLAYERS_KEY(roomId));
        const playerList = Object.values(players).map(JSON.parse);
        io.to(SOCKET_ROOM(roomId)).emit("mahjong:update_players", playerList);

        // 👉 sync countdown only
        await this.syncCountdown(socket, roomId);
      } else {
        // 👉 waiting
        await this.tryStartRound(roomId, io, socket);
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
  static async tryStartRound(roomId, io, socket) {
    const status = await redis.get(ROOM_STATUS_KEY(roomId));

    if (status && status !== "waiting") return;

    const state = await this.getState(roomId);
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

    await this.startCountdown(roomId, io);
  }

  static async startCountdown(roomId, io) {
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

    this.runCountdown(roomId, endTime, io);
  }

  static runCountdown(roomId, endTime, io) {
    const interval = setInterval(async () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
      console.log(remaining);
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

        await this.startRound(roomId, io);
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
  static async startRound(roomId, io) {
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

    await this.rollDice(roomId, data.players, io);
  }

  // ================= DICE =================
  static async rollDice(roomId, roundPlayers, io) {
    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "dice_rolling");
    io.to(SOCKET_ROOM(roomId)).emit("mahjong:start_rolling_dice");

    await this.wait(10000);

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

    io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play_first_selected", {
      user_id_to_play_first: user_to_play_first.user_id,
      user_name_to_play_first: user_to_play_first.name,
    });

    // this temporary round end codes // might delete later
    await this.wait(3000);
    await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), "round_end");
    const round = await redis.get(ROUND_KEY(roomId));
    const roundData = JSON.parse(round);
    await ToLaravelService.endRound(roundData.roundId);
    io.to(SOCKET_ROOM(roomId)).emit("mahjong:round_end");
    await this.wait(5000);
    await this.clearRoomData(roomId, io);
  }

  // ================= END ROUND =================
  static async endRound(roomId, io) {
    await redis.set(ROOM_STATUS_KEY(roomId), "waiting");

    await redis.del(ROUND_KEY(roomId));
    await redis.del(ROUND_PLAYERS_KEY(roomId));

    // move guests → normal players
    const guests = await redis.hgetall(GUESTS_KEY(roomId));

    for (const [userId, data] of Object.entries(guests)) {
      await redis.hdel(GUESTS_KEY(roomId), userId);
    }

    io.to(SOCKET_ROOM(roomId)).emit("round_ended");

    await this.tryStartRound(roomId, io);
  }

  // ================= Temporary Function =================
  static async clearRoomData(roomId, io) {
    const players = await redis.hgetall(PLAYERS_KEY(roomId));

    const userIds = Object.values(players).map((p) => JSON.parse(p).userId);

    const guestUsers = await redis.hgetall(GUESTS_KEY(roomId));

    const guestIds = Object.values(guestUsers).map((g) => JSON.parse(g).userId);

    const allUsers = [...userIds, ...guestIds];

    await Promise.all(
      allUsers.map((userId) => redis.del(PLAYER_ROOM_KEY(userId))),
    );

    await Promise.all([
      redis.del(ROOM_KEY(roomId)),
      redis.del(MATCH_KEY(roomId)),
      redis.del(ROUND_KEY(roomId)),
      redis.del(PLAYERS_KEY(roomId)),
      redis.del(ROUND_PLAYERS_KEY(roomId)),
      redis.del(GUESTS_KEY(roomId)),
      redis.del(ROOM_STATUS_KEY(roomId)),
      redis.del(ROOM_PLAYING_PHASE_KEY(roomId)),
      redis.del(COUNTDOWN_KEY(roomId)),
      redis.del(ROOM_DICE_KEY(roomId)),
      redis.del(ROOM_FIRST_PLAYER_KEY(roomId)),
    ]);

    io.in(SOCKET_ROOM(roomId)).socketsLeave(SOCKET_ROOM(roomId));
  }

  // ================= STATE =================
  static async getState(roomId) {
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
    ]);

    // parse safely
    let dice = null;
    let firstPlayer = null;

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
    };
  }

  static wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static async recoverRoomState(roomId, user, socket, io) {
    const data = await ToLaravelService.getRoomData(roomId);
    roomMemoryStore.set(roomId, data);
    const state = await this.getState(roomId);
    socket.join(SOCKET_ROOM(roomId));
    socket.emit("mahjong:current_state", state);
    const status = await redis.get(ROOM_STATUS_KEY(roomId));
    if (!status || status == "waiting") {
      await this.tryStartRound(roomId, io, socket);
    } else if (status == "countdown") {
      const endTime = await redis.get(COUNTDOWN_KEY(roomId));
      this.runCountdown(roomId, endTime, io);
    } else if (status == "playing") {
      const round_exist = await redis.exists(ROUND_KEY(roomId));
      if(!round_exist) {
        await this.startRound(roomId, io);
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

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play_first_selected", {
          user_id_to_play_first: user_to_play_first.user_id,
          user_name_to_play_first: user_to_play_first.name,
        });
      } else if (phase == "user_to_play_first_selected") {
        const firstPlayerRaw = await redis.get(ROOM_FIRST_PLAYER_KEY(roomId));
        const firstPlayer = JSON.parse(firstPlayerRaw);

        io.to(SOCKET_ROOM(roomId)).emit("mahjong:user_to_play_first_selected", {
          user_id_to_play_first: firstPlayer.user_id,
          user_name_to_play_first: firstPlayer.user_name,
        });
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
