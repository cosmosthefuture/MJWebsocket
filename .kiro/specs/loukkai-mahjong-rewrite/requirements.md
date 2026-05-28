# Loukkai Mahjong Game Logic Rewrite

## Overview
Complete rewrite of MahJongRoomManager.js to implement the Loukkai variant of Mahjong, a regional variant played in Loukkai city, Myanmar.

## Current State
- Existing implementation has 6800+ lines with simplified rules
- Supports 2-4 players, has dot/bamboo/character tiles, standard win detection
- Has chow-from-discard, no shown tiles, no pure-hand requirements
- Payout system not implemented

## Target State
- Loukkai variant with 72 tiles (dot 1-9 × 4, bamboo 1-9 × 4)
- 2-3 players per round
- Shown tiles mechanic (2 always visible, Kong-holders can take)
- No chow from discard (chow only from hand)
- Win only from: self-draw, left player's discard, or shown tile
- Pure hand bonus system
- Complete payout calculation system
- Consecutive shown-tile pure-hand multiplier (within same turn)

## Key Requirements

### R1: Tile Set & Player Count
**Priority:** Critical  
**Description:** System must use exactly 72 tiles (dot 1-9 × 4 + bamboo 1-9 × 4) and support 2-3 players per round.

**Acceptance Criteria:**
- Backend getShuffledTiles returns 72 tiles
- Room validation allows 2-3 players only
- Deal logic: 13 tiles each, first player gets 14th
- No character tiles, no honor tiles

---

### R2: Shown Tiles System
**Priority:** Critical  
**Description:** Implement the shown tiles mechanic where 2 tiles are always visible and Kong-holders can take them.

**Acceptance Criteria:**
- Before dealing, reveal 2 tiles from wall face-up
- Store shown tiles in Redis (SHOWN_TILES_KEY)
- When a shown tile is taken, immediately replace from wall
- Only players with at least one completed Kong can take shown tiles
- Taking a shown tile is optional after each Kong
- Multiple Kongs in one turn = multiple shown tile opportunities
- Broadcast shown tiles state to all players

---

### R3: Turn Flow & Draw Logic
**Priority:** Critical  
**Description:** Implement correct turn flow: draw → check win → Kong → discard.

**Acceptance Criteria:**
- Anti-clockwise turn order
- Normal turn: draw from wall → check self-draw win → optionally declare Kong → discard
- After Kong: draw 1 extra tile → optionally take shown tile → check win again
- Kong chains: if extra tile completes another Kong, repeat
- 30-second turn timer with auto-discard
- Track "left player" correctly (previous in turn order)

---

### R4: Win Detection - Structure
**Priority:** Critical  
**Description:** Detect valid winning hands: 4 sets + 1 pair (mixed or pure).

**Acceptance Criteria:**
- Sets: Pong (3 identical), Chow (3 consecutive same type), Kong (4 identical)
- Pair: 2 identical tiles
- Win structure: exactly 4 sets + 1 pair = 14 tiles
- Both mixed hand (dot + bamboo) and pure hand (all one type) are valid wins
- Backtracking algorithm to find valid meld combinations
- Handle revealed melds (Pong/Kong/Chow from previous actions) + concealed tiles

---

### R5: Win Sources & Restrictions
**Priority:** Critical  
**Description:** Implement win source restrictions: self-draw, left player's discard only, or shown tile.

**Acceptance Criteria:**
- Self-draw win: player draws winning tile from wall
- Left-discard win: ONLY the left player's (previous in turn) discard can be used to win
- Shown tile win: player takes shown tile (requires Kong) and it completes winning hand
- Other players' discards cannot be used to win (only left player)
- Win check happens: after draw, after Kong extra draw, after taking shown tile

---

### R6: Chow Restrictions
**Priority:** Critical  
**Description:** Chow can ONLY be formed from tiles in hand. No chow from discard.

**Acceptance Criteria:**
- Remove all "chow from discard" logic
- Chow detection only for win validation (tiles already in hand)
- No interrupt-chow events
- No ACCEPT_NORMAL_CHOW / PASS_NORMAL_CHOW handlers

---

### R7: Pong & Kong from Discard
**Priority:** Critical  
**Description:** Pong and Kong can be claimed from ANY player's discard (interrupt).

**Acceptance Criteria:**
- After any player discards, check all other players for Pong/Kong
- Priority: Win (left player only) > Kong (any player) > Pong (any player)
- 3-4 second decision window with auto-pass
- Interrupt Pong: take discard + 2 from hand → reveal → becomes current player → discard
- Interrupt Kong: take discard + 3 from hand → reveal → draw extra → optionally take shown tile → discard

---

### R8: Pure Hand Detection
**Priority:** High  
**Description:** Detect if a winning hand is pure (all tiles same type) for payout multiplier.

**Acceptance Criteria:**
- Pure hand: all 14 tiles (including revealed melds) are same type (all dot OR all bamboo)
- Check complete final hand including: concealed tiles + revealed Pong/Kong/Chow + winning tile
- Return isPureHand boolean with win detection result

---

### R9: Payout Calculation - Self-Draw
**Priority:** High  
**Description:** Calculate payout for self-draw wins.

**Acceptance Criteria:**
- Self-draw normal (mixed): all other players pay 1× bet
- Self-draw pure: all other players pay 10× bet
- Store payout data: { winType: 'self-draw', isPure: boolean, payouts: [{userId, amount}] }

---

### R10: Payout Calculation - Left Discard
**Priority:** High  
**Description:** Calculate payout for left player's discard wins.

**Acceptance Criteria:**
- Left-discard normal: left player pays 2×, others pay 1×
- Left-discard pure: left player pays 10×, others pay 5×
- Identify left player correctly (previous in turn order)
- Store payout data with left player marked

---

### R11: Payout Calculation - Shown Tile
**Priority:** High  
**Description:** Calculate payout for shown tile wins with consecutive multiplier.

**Acceptance Criteria:**
- Shown tile normal (mixed): all pay 3×
- Shown tile pure: consecutive multiplier = `10 × 2^(N-1)` where N = shown tiles taken this turn
- Track shown tiles taken in current turn (reset on turn end)
- Examples: 1st shown tile = 10×, 2nd = 20×, 3rd = 40×, 4th = 80×
- Store consecutive count with payout data

---

### R12: Redis State Management
**Priority:** High  
**Description:** Update Redis keys for new game mechanics.

**Acceptance Criteria:**
- Add SHOWN_TILES_KEY(roomId) for 2 shown tiles
- Add SHOWN_TILES_TAKEN_THIS_TURN_KEY(roomId, userId) for consecutive counter
- Remove CHOW-related keys (no longer needed)
- Keep existing: HAND, PONG, KONG, WALL, DISCARD, TURN_PLAYER, etc.
- Clean up all keys on round end

---

### R13: Frontend Events - Shown Tiles
**Priority:** High  
**Description:** Emit events for shown tiles state changes.

**Acceptance Criteria:**
- `mahjong:shown_tiles_updated` → broadcast current 2 shown tiles
- `mahjong:can_take_shown_tile` → ask player if they want to take (after Kong)
- `mahjong:shown_tile_taken` → notify all players which tile was taken
- `mahjong:shown_tile_replaced` → notify new shown tile revealed

---

### R14: Frontend Events - Win & Payout
**Priority:** High  
**Description:** Emit win events with payout information.

**Acceptance Criteria:**
- `mahjong:winner_reveal` includes: winner, hand structure, win type, isPure, payouts
- `mahjong:payout_calculated` → detailed payout breakdown per player
- Show consecutive multiplier if shown-tile pure win

---

### R15: Player Count Validation
**Priority:** Medium  
**Description:** Enforce 2-3 player limit throughout game flow.

**Acceptance Criteria:**
- Room join: reject if 3 players already in room
- Countdown: require minimum 2 players
- Round start: validate 2-3 players before dealing
- Error messages: "Room full (max 3 players)" / "Need at least 2 players"

---

### R16: Draw Condition
**Priority:** Medium  
**Description:** Handle draw when wall is exhausted.

**Acceptance Criteria:**
- Check wall count before each draw
- If wall empty and no winner: emit `mahjong:draw_round`
- No payout on draw
- End round, clean up state

---

### R17: Code Cleanup
**Priority:** Low  
**Description:** Remove obsolete code and temporary markers.

**Acceptance Criteria:**
- Remove all `// temporary codes. Delete later.` sections
- Remove commented-out test code
- Remove empty event files (discardTile.js, drawTile.js, startGame.js)
- Remove GAME_START_KEY, GAME_END_KEY temporary keys
- Keep all logic in MahJongRoomManager.js (no refactoring yet)

---

## Non-Requirements
- Scoring system beyond payout multipliers (not in scope)
- Seat wind assignment (not in Loukkai variant)
- Special hands beyond pure hand (not in Loukkai variant)
- Code refactoring / clean architecture (deferred until after implementation)
- Character tiles, honor tiles (not in Loukkai variant)

## Technical Constraints
- Keep all logic in MahJongRoomManager.js (monolithic approach until working)
- Use existing Redis + Socket.IO + Express stack
- Backend (Laravel) handles: room/match/round persistence, tile shuffling
- Frontend expects existing event names where possible (minimize breaking changes)

## Success Criteria
- 2-3 players can complete a full round with Loukkai rules
- Shown tiles mechanic works correctly
- Win detection validates 4 sets + 1 pair (mixed or pure)
- Win sources restricted correctly (self-draw, left-discard, shown-tile only)
- Payout calculation accurate for all win types
- No chow from discard
- Pong/Kong from any player's discard works
- Consecutive shown-tile pure-hand multiplier calculates correctly
