# Loukkai Mahjong WebSocket Events Reference

## Overview

All events use Socket.IO. Events are either:
- **Broadcast** (`io.to(SOCKET_ROOM(roomId))`) → sent to ALL players in the room
- **Private** (`io.to(`user:${userId}`)`) → sent to a SPECIFIC player only

---

## 1. Room & Lobby Events

### `mahjong:update_players`
**Target:** Broadcast  
**When:** Player joins/leaves room  
```json
[
  { "userId": "1", "name": "Player 1" },
  { "userId": "2", "name": "Player 2" },
  { "userId": "3", "name": "Player 3" }
]
```

### `mahjong:update_guests`
**Target:** Broadcast  
**When:** Guest list changes  
```json
[
  { "userId": "5", "name": "Spectator 1" }
]
```

### `mahjong:update_round_players`
**Target:** Broadcast  
**When:** Round players status changes (join, leave, reconnect)  
```json
[
  { "userId": "1", "name": "Player 1", "seat": 1, "is_active": true, "is_auto": false },
  { "userId": "2", "name": "Player 2", "seat": 2, "is_active": true, "is_auto": false },
  { "userId": "3", "name": "Player 3", "seat": 3, "is_active": false, "is_auto": true }
]
```

### `mahjong:joined_as_guest`
**Target:** Private (to joining user)  
**When:** Player joins a room that's already playing and they're not a round player  
```json
// No payload
```

### `mahjong:waiting_for_players`
**Target:** Broadcast  
**When:** Not enough players to start (need minimum 2)  
```json
// No payload
```

---

## 2. Countdown & Round Start Events

### `mahjong:countdown_started`
**Target:** Broadcast  
**When:** 15-second countdown begins before round starts  
```json
// No payload
```

### `mahjong:countdown`
**Target:** Broadcast  
**When:** Every second during pre-round countdown  
```json
{ "remaining": 12 }
```

### `mahjong:countdown_cancelled`
**Target:** Broadcast  
**When:** Countdown cancelled (player left, not enough players)  
```json
// No payload
```

### `mahjong:show_start_round`
**Target:** Broadcast  
**When:** Countdown finished, ready to start round  
```json
// No payload
```

### `mahjong:round_started`
**Target:** Broadcast  
**When:** Round officially starts  
```json
{
  "round_id": 42,
  "players": [
    { "user_id": "1", "name": "Player 1", "seat_position": 1 },
    { "user_id": "2", "name": "Player 2", "seat_position": 2 },
    { "user_id": "3", "name": "Player 3", "seat_position": 3 }
  ]
}
```

---

## 3. Dice & First Player Events

### `mahjong:start_rolling_dice`
**Target:** Broadcast  
**When:** Dice rolling animation should start  
```json
// No payload
```

### `mahjong:dice_rolled`
**Target:** Broadcast  
**When:** Dice result determined  
```json
{
  "dice": [3, 5],
  "total": 8
}
```

### `mahjong:user_to_play`
**Target:** Broadcast  
**When:** First player selected / current turn player changes  
```json
{
  "user_id": "2",
  "user_name": "Player 2"
}
```

---

## 4. Tile Dealing & Shuffling Events

### `mahjong:start_shuffling`
**Target:** Broadcast  
**When:** Tiles are being shuffled  
```json
// No payload
```

### `mahjong:dealing_tiles`
**Target:** Broadcast  
**When:** Tiles are being dealt to players  
```json
// No payload
```

### `mahjong:wall_count_updated`
**Target:** Broadcast  
**When:** Wall tile count changes (after draw, shown tile take, etc.)  
```json
{ "wallCount": 42 }
```

### `mahjong:initial_hand_state`
**Target:** Private (to each player)  
**When:** After dealing, after any meld action, after discard  
```json
[
  {
    "last_discard_tile": null,
    "pong": [
      {
        "pong_key": "dot_3",
        "tiles": [
          { "id": 10, "type": "dot", "number": 3, "copy_no": 1 },
          { "id": 11, "type": "dot", "number": 3, "copy_no": 2 },
          { "id": 12, "type": "dot", "number": 3, "copy_no": 3 }
        ]
      }
    ],
    "chow": [],
    "kong": [],
    "discarded_tiles": [
      { "id": 5, "type": "bamboo", "number": 7, "copy_no": 1 }
    ],
    "userId": "1",
    "user_name": "Player 1",
    "isSelf": true,
    "seat_position": 1,
    "tileCount": 10,
    "tiles": [
      { "id": 1, "type": "dot", "number": 1, "copy_no": 1 },
      { "id": 2, "type": "dot", "number": 2, "copy_no": 1 },
      { "id": 3, "type": "dot", "number": 3, "copy_no": 4 },
      { "id": 4, "type": "bamboo", "number": 5, "copy_no": 1 },
      { "id": 6, "type": "bamboo", "number": 6, "copy_no": 1 },
      { "id": 7, "type": "bamboo", "number": 7, "copy_no": 2 },
      { "id": 8, "type": "dot", "number": 8, "copy_no": 1 },
      { "id": 9, "type": "dot", "number": 9, "copy_no": 1 },
      { "id": 13, "type": "dot", "number": 4, "copy_no": 1 },
      { "id": 14, "type": "dot", "number": 4, "copy_no": 2 }
    ]
  },
  {
    "last_discard_tile": null,
    "pong": [],
    "chow": [],
    "kong": [],
    "discarded_tiles": [],
    "userId": "2",
    "user_name": "Player 2",
    "isSelf": false,
    "seat_position": 2,
    "tileCount": 13,
    "tiles": [
      { "id": null, "type": "hidden", "number": null, "copy_no": null },
      { "id": null, "type": "hidden", "number": null, "copy_no": null }
    ]
  }
]
```

**Notes:**
- `isSelf: true` → player sees their own real tiles
- `isSelf: false` → other players' tiles are hidden (`type: "hidden"`)
- Revealed melds (pong/kong/chow) are visible to everyone

---

## 5. Shown Tiles Events (NEW - Loukkai)

### `mahjong:shown_tiles_updated`
**Target:** Broadcast  
**When:** Shown tiles initialized, or a shown tile is taken and replaced  
```json
{
  "shownTiles": [
    { "id": 45, "type": "dot", "number": 7, "copy_no": 2 },
    { "id": 22, "type": "bamboo", "number": 3, "copy_no": 1 }
  ]
}
```

### `mahjong:can_take_shown_tile`
**Target:** Private (to player who just declared Kong)  
**When:** After Kong, player is offered to take a shown tile  
```json
{
  "shownTiles": [
    { "id": 45, "type": "dot", "number": 7, "copy_no": 2 },
    { "id": 22, "type": "bamboo", "number": 3, "copy_no": 1 }
  ]
}
```

### `mahjong:shown_tile_taken`
**Target:** Broadcast  
**When:** A player takes a shown tile  
```json
{
  "userId": "2",
  "tile": { "id": 45, "type": "dot", "number": 7, "copy_no": 2 },
  "tileIndex": 0
}
```

---

## 6. Turn Flow Events

### `mahjong:turn_countdown_started`
**Target:** Broadcast  
**When:** A player's turn begins  
```json
{
  "user_id": "1",
  "duration": 30
}
```

### `mahjong:turn_countdown`
**Target:** Broadcast  
**When:** Every second during a player's turn  
```json
{
  "user_id": "1",
  "remaining": 22
}
```

### `mahjong:turn_countdown_finished`
**Target:** Broadcast  
**When:** Turn timer expired (auto-discard will happen)  
```json
{
  "user_id": "1"
}
```

### `mahjong:cannot_discard`
**Target:** Private  
**When:** Player tries to discard out of turn or already discarded  
```json
{
  "message": "It is not your turn. Cannot discard."
}
```

---

## 7. Kong Events

### `mahjong:can_kong`
**Target:** Private (to player who can declare Kong from hand)  
**When:** After drawing a tile, player has 4 identical tiles  
```json
{
  "canKong": true,
  "groups": [
    {
      "tileKey": "dot_5",
      "tiles": [
        { "id": 20, "type": "dot", "number": 5, "copy_no": 1 },
        { "id": 21, "type": "dot", "number": 5, "copy_no": 2 },
        { "id": 22, "type": "dot", "number": 5, "copy_no": 3 },
        { "id": 23, "type": "dot", "number": 5, "copy_no": 4 }
      ]
    }
  ]
}
```

### `mahjong:can_interrupt_kong`
**Target:** Private (to player who can Kong from discard)  
**When:** Another player discards a tile and this player has 3 matching tiles  
```json
{
  "canKong": true,
  "groups": [
    {
      "tileKey": "bamboo_8",
      "tiles": [
        { "id": 30, "type": "bamboo", "number": 8, "copy_no": 1 },
        { "id": 31, "type": "bamboo", "number": 8, "copy_no": 2 },
        { "id": 32, "type": "bamboo", "number": 8, "copy_no": 3 }
      ]
    }
  ]
}
```

### `mahjong:can_normal_kong`
**Target:** Private  
**When:** Player reconnects and can claim Kong from last discard  
```json
{
  "canKong": true,
  "groups": [
    {
      "tileKey": "dot_2",
      "tiles": [
        { "id": 40, "type": "dot", "number": 2, "copy_no": 1 },
        { "id": 41, "type": "dot", "number": 2, "copy_no": 2 },
        { "id": 42, "type": "dot", "number": 2, "copy_no": 3 }
      ]
    }
  ]
}
```

### `mahjong:remove_kong_decision`
**Target:** Private  
**When:** Kong decision window expired or cancelled  
```json
// No payload
```

---

## 8. Pong Events

### `mahjong:can_interrupt_pong`
**Target:** Private (to player who can Pong from discard)  
**When:** Another player discards and this player has 2 matching tiles  
```json
{
  "canPong": true,
  "groups": [
    {
      "tileKey": "dot_6",
      "tiles": [
        { "id": 50, "type": "dot", "number": 6, "copy_no": 1 },
        { "id": 51, "type": "dot", "number": 6, "copy_no": 2 }
      ]
    }
  ]
}
```

### `mahjong:can_normal_pong`
**Target:** Private  
**When:** Player reconnects and can claim Pong from last discard  
```json
{
  "canPong": true,
  "groups": [
    {
      "tileKey": "bamboo_4",
      "tiles": [
        { "id": 60, "type": "bamboo", "number": 4, "copy_no": 1 },
        { "id": 61, "type": "bamboo", "number": 4, "copy_no": 2 }
      ]
    }
  ]
}
```

### `mahjong:remove_pong_decision`
**Target:** Private  
**When:** Pong decision window expired or cancelled  
```json
// No payload
```

---

## 9. Win Events

### `mahjong:ask_win_decision`
**Target:** Private (to left player who can win from discard)  
**When:** Left player can win using the discarded tile  
```json
{
  "message": "You can win by using discarded tile."
}
```

### `mahjong:remove_win_decision`
**Target:** Private or Broadcast  
**When:** Win decision expired or another action taken  
```json
// No payload
```

### `mahjong:winner_reveal`
**Target:** Broadcast  
**When:** A player wins the round  
```json
{
  "winner_user_id": "2",
  "winner_user_name": "Player 2",
  "pair": [
    { "id": 70, "type": "dot", "number": 9, "copy_no": 1 },
    { "id": 71, "type": "dot", "number": 9, "copy_no": 2 }
  ],
  "chow": [
    {
      "chow_key": "dot_1_2_3",
      "tiles": [
        { "id": 1, "type": "dot", "number": 1, "copy_no": 1 },
        { "id": 2, "type": "dot", "number": 2, "copy_no": 1 },
        { "id": 3, "type": "dot", "number": 3, "copy_no": 1 }
      ]
    }
  ],
  "pong": [
    {
      "pong_key": "dot_5",
      "tiles": [
        { "id": 20, "type": "dot", "number": 5, "copy_no": 1 },
        { "id": 21, "type": "dot", "number": 5, "copy_no": 2 },
        { "id": 22, "type": "dot", "number": 5, "copy_no": 3 }
      ]
    }
  ],
  "kong": [],
  "winType": "self-draw",
  "isPure": true,
  "payouts": [
    { "payerId": "1", "amount": 10 },
    { "payerId": "3", "amount": 10 }
  ],
  "consecutiveCount": undefined
}
```

**`winType` values:**
- `"self-draw"` — player drew the winning tile from wall
- `"left-discard"` — left player's discard completed the hand
- `"shown-tile"` — taken shown tile completed the hand

**`consecutiveCount`:** Only present for shown-tile pure wins. Represents N in formula `10 × 2^(N-1)`.

### `mahjong:payout_calculated`
**Target:** Broadcast  
**When:** Immediately after `mahjong:winner_reveal`  
```json
{
  "winnerId": "2",
  "winType": "left-discard",
  "isPure": false,
  "payouts": [
    { "payerId": "1", "amount": 2 },
    { "payerId": "3", "amount": 1 }
  ],
  "leftPlayerId": "1"
}
```

**Example for shown-tile pure win:**
```json
{
  "winnerId": "3",
  "winType": "shown-tile",
  "isPure": true,
  "payouts": [
    { "payerId": "1", "amount": 20 },
    { "payerId": "2", "amount": 20 }
  ],
  "consecutiveCount": 2
}
```

---

## 10. Round End Events

### `mahjong:draw_round`
**Target:** Broadcast  
**When:** Wall is exhausted with no winner  
```json
// No payload
```

### `mahjong:round_end`
**Target:** Broadcast  
**When:** Round officially ends (after win or draw)  
```json
// No payload
```

---

## 11. Tile Object Structure

Every tile in the system follows this structure:

```json
{
  "id": 45,
  "type": "dot",
  "number": 7,
  "copy_no": 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unique tile identifier |
| `type` | string | `"dot"` or `"bamboo"` (only 2 types in Loukkai) |
| `number` | number | Tile number (1-9) |
| `copy_no` | number | Copy number (1-4, since each tile has 4 copies) |

**Hidden tile (other player's hand):**
```json
{
  "id": null,
  "type": "hidden",
  "number": null,
  "copy_no": null
}
```

---

## 12. Event Flow Summary

### Normal Turn Flow:
```
mahjong:user_to_play → mahjong:turn_countdown_started
  → mahjong:turn_countdown (every second)
  → [Player discards] → mahjong:initial_hand_state (updated)
  → [Check interrupts] → mahjong:can_interrupt_kong / mahjong:can_interrupt_pong
  → mahjong:turn_countdown_finished (if timeout → auto-discard)
```

### Win Flow:
```
[Win detected] → mahjong:winner_reveal → mahjong:payout_calculated
  → [3 sec wait] → mahjong:round_end
```

### Kong → Shown Tile Flow:
```
mahjong:can_kong → [Player accepts]
  → mahjong:initial_hand_state (updated with Kong revealed)
  → mahjong:wall_count_updated (extra draw)
  → mahjong:can_take_shown_tile
  → [Player takes] → mahjong:shown_tile_taken → mahjong:shown_tiles_updated
  → mahjong:initial_hand_state (updated)
  → [Check win] → mahjong:winner_reveal (if win)
```

### Draw Flow:
```
[Wall empty] → mahjong:draw_round → [3 sec wait] → mahjong:round_end
```

---

## 13. Client → Server Events (Requests)

These are events the frontend SENDS to the server:

| Event | Payload | Description |
|-------|---------|-------------|
| `mahjong:join_room` | `{ roomId, user }` | Join a room |
| `mahjong:leave_room` | `{ userId }` | Leave room |
| `mahjong:sort_hand` | `{ roomId, userId, tiles }` | Sort hand tiles |
| `mahjong:discard_tile` | `{ roomId, userId, tileId }` | Discard a tile |
| `mahjong:accept_kong` | `{ roomId, userId, kongKey }` | Declare Kong from hand |
| `mahjong:pass_kong` | `{ roomId, userId }` | Pass Kong opportunity |
| `mahjong:accept_interrupt_kong` | `{ roomId, userId, kongKey }` | Claim Kong from discard |
| `mahjong:accept_interrupt_pong` | `{ roomId, userId, pongKey }` | Claim Pong from discard |
| `mahjong:accept_normal_kong` | `{ roomId, userId, kongKey }` | Claim Kong (reconnect) |
| `mahjong:pass_normal_kong` | `{ roomId, userId }` | Pass Kong (reconnect) |
| `mahjong:accept_normal_pong` | `{ roomId, userId, pongKey }` | Claim Pong (reconnect) |
| `mahjong:pass_normal_pong` | `{ roomId, userId }` | Pass Pong (reconnect) |
| `mahjong:accept_win` | `{ roomId, userId }` | Accept win from discard |
| `mahjong:pass_win` | `{ roomId, userId }` | Decline win from discard |
| `mahjong:take_shown_tile` | `{ roomId, userId, tileIndex }` | Take a shown tile (0 or 1) |

---

## 14. Payout Multiplier Reference

| Win Type | Hand Type | Left Player Pays | Others Pay |
|----------|-----------|-----------------|------------|
| Self-draw | Mixed | — | 1× each |
| Self-draw | Pure | — | 10× each |
| Left-discard | Mixed | 2× | 1× each |
| Left-discard | Pure | 10× | 5× each |
| Shown-tile | Mixed | — | 3× each |
| Shown-tile | Pure (1st) | — | 10× each |
| Shown-tile | Pure (2nd) | — | 20× each |
| Shown-tile | Pure (3rd) | — | 40× each |
| Shown-tile | Pure (4th) | — | 80× each |

Formula for shown-tile pure: `10 × 2^(N-1)` where N = consecutive shown tiles taken this turn.
