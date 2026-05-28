# Implementation Plan

## Overview
This implementation plan rewrites the MahJongRoomManager.js to implement the Loukkai Mahjong variant with 72 tiles, 2-3 players, shown tiles mechanic, restricted win sources, and complete payout system.

## Tasks

### 1. Backup & Setup
**Requirements:** None  
**Description:** Create backup of current MahJongRoomManager.js and add new Redis keys for shown tiles system.

**Sub-tasks:**
- Copy current MahJongRoomManager.js to MahJongRoomManager.backup.js
- Add SHOWN_TILES_KEY(roomId) constant
- Add SHOWN_TILES_TAKEN_THIS_TURN_KEY(roomId, userId) constant
- Add PAYOUT_DATA_KEY(roomId) constant
- Update clearRoomData() to delete new keys on cleanup

---

### 2. Player Count Validation
**Requirements:** R1, R15  
**Description:** Enforce 2-3 player limit throughout game flow.

**Sub-tasks:**
- Update joinRoom() to reject if 3 players already in room (change from 4 to 3)
- Update tryStartRound() minimum player check (keep 2 minimum)
- Update startRound() to validate 2-3 players before dealing
- Update error messages: "Room full (max 3 players)"

---

### 3. Shown Tiles System - Initialization
**Requirements:** R2  
**Description:** Implement shown tiles reveal before dealing and storage in Redis.

**Sub-tasks:**
- Create revealShownTiles(roomId, io) function
- Call revealShownTiles() in shuffleAndDealTiles() BEFORE dealing tiles
- Take 2 tiles from wall using redis.lpop(WALL_KEY)
- Store in SHOWN_TILES_KEY as JSON array
- Emit 'mahjong:shown_tiles_updated' event with 2 tiles
- Update getState() to include shown tiles in state

---

### 4. Shown Tiles System - Taking Mechanism
**Requirements:** R2, R13  
**Description:** Implement shown tile taking after Kong with replacement logic.

**Sub-tasks:**
- Create takeShownTile(roomId, userId, tileIndex, io) function
- Validate player has at least one Kong before allowing take
- Remove selected shown tile, add to player's hand
- Immediately replace with new tile from wall (redis.lpop)
- Update SHOWN_TILES_KEY with new tile
- Increment SHOWN_TILES_TAKEN_THIS_TURN_KEY counter
- Emit 'mahjong:shown_tile_taken' and 'mahjong:shown_tiles_updated' events
- Create socket event handler for 'mahjong:take_shown_tile' request

---

### 5. Turn Flow - Draw and Win Check
**Requirements:** R3, R5  
**Description:** Modify startPlayerTurn() to check self-draw win immediately after draw.

**Sub-tasks:**
- Reset SHOWN_TILES_TAKEN_THIS_TURN_KEY at turn start
- After setting current turn player, check self-draw win using checkWinningHand()
- If canWin, call handleWin() with source='self-draw' and isPure flag
- If no win, proceed to Kong check (existing logic)
- Keep 30-second countdown and auto-discard logic

---

### 6. Kong Flow - Extra Draw and Shown Tile Offer
**Requirements:** R2, R3, R7  
**Description:** After Kong, draw extra tile, offer shown tile, check win, allow chaining.

**Sub-tasks:**
- Modify acceptKong() to call afterKong() helper
- Modify acceptInterruptKong() to call afterKong() helper
- Modify acceptNormalKong() to call afterKong() helper
- Create afterKong(roomId, userId, io) function:
  - Draw 1 extra tile from wall
  - Check win (self-draw)
  - If win, handle win and return
  - If no win, emit 'mahjong:can_take_shown_tile' with shown tiles
  - Wait 3-4 seconds for decision
  - Check if another Kong possible, emit 'mahjong:can_kong' if yes

---

### 7. Win Detection - Structure Validation
**Requirements:** R4  
**Description:** Rewrite checkWinningHand() to validate 4 sets + 1 pair (mixed or pure).

**Sub-tasks:**
- Rewrite checkWinningHand(roomId, userId) function
- Get player's concealed tiles and revealed melds (Pong/Kong from previous actions)
- Calculate concealedMeldsNeeded = 4 - revealedMelds.length
- Build tile counts from concealed tiles
- Try each possible pair (2 identical tiles)
- For each pair, call canFormExactMelds() with backtracking
- Return { canWin: boolean, pairKey, structure }
- Keep existing canFormExactMelds() backtracking logic (Pong first, then Chow)

---

### 8. Win Detection - Pure Hand Check
**Requirements:** R8  
**Description:** Add pure hand detection to win validation.

**Sub-tasks:**
- Create checkPureHand(concealedTiles, revealedMelds) function
- Collect all tiles: concealed + revealed Pong/Kong/Chow tiles
- Check if all tiles are same type (all dot OR all bamboo)
- Return boolean isPure
- Update checkWinningHand() to call checkPureHand() and include isPure in result
- Update checkWinUsingDiscard() to call checkPureHand() and include isPure in result

---

### 9. Win Sources - Left Player Restriction
**Requirements:** R5  
**Description:** Restrict discard wins to left player only.

**Sub-tasks:**
- Create getLeftPlayer(roomId, currentUserId) helper function
- In anti-clockwise order, return previous player in turn sequence
- Modify handleAfterDiscard() to only check win for left player
- Remove win checks for other players (keep Kong/Pong checks for all)
- Update win decision prompt to only show for left player

---

### 10. Win Sources - Shown Tile Win
**Requirements:** R5, R11  
**Description:** Implement win by taking shown tile.

**Sub-tasks:**
- Modify takeShownTile() to check win after adding tile to hand
- If checkWinningHand() returns canWin, call handleWin() with source='shown-tile'
- Pass isPure flag and consecutive count to handleWin()
- Handle win immediately (no discard needed)

---

### 11. Remove Chow from Discard
**Requirements:** R6  
**Description:** Remove all chow-from-discard logic.

**Sub-tasks:**
- Remove checkChowUsingDiscard() function
- Remove acceptNormalChow() function
- Remove passNormalChow() function
- Remove all chow checks from handleAfterDiscard()
- Remove 'mahjong:can_normal_chow' emit statements
- Remove ACCEPT_NORMAL_CHOW and PASS_NORMAL_CHOW from event handlers (index.js)
- Keep chow detection in win validation (for tiles already in hand)

---

### 12. Payout Calculation - Self-Draw
**Requirements:** R9  
**Description:** Calculate payout for self-draw wins.

**Sub-tasks:**
- Create calculatePayout(roomId, winnerId, winType, isPure, consecutiveCount) function
- For winType='self-draw':
  - If isPure: all other players pay 10× bet
  - If not pure: all other players pay 1× bet
- Return { winnerId, winType, isPure, payouts: [{payerId, amount}] }
- Store in PAYOUT_DATA_KEY(roomId)

---

### 13. Payout Calculation - Left Discard
**Requirements:** R10  
**Description:** Calculate payout for left player's discard wins.

**Sub-tasks:**
- Extend calculatePayout() for winType='left-discard'
- Identify left player using getLeftPlayer()
- If isPure: left pays 10×, others pay 5×
- If not pure: left pays 2×, others pay 1×
- Include leftPlayerId in payout data

---

### 14. Payout Calculation - Shown Tile
**Requirements:** R11  
**Description:** Calculate payout for shown tile wins with consecutive multiplier.

**Sub-tasks:**
- Extend calculatePayout() for winType='shown-tile'
- If not pure: all pay 3×
- If pure: calculate consecutive multiplier = 10 × 2^(N-1)
  - N = value from SHOWN_TILES_TAKEN_THIS_TURN_KEY
- Include consecutiveCount in payout data

---

### 15. Win Handling - Unified Flow
**Requirements:** R5, R14  
**Description:** Create unified handleWin() function for all win types.

**Sub-tasks:**
- Create handleWin(roomId, winnerId, winSource, isPure, io) function
- Determine winType from winSource ('self-draw', 'left-discard', 'shown-tile')
- Get consecutive count if shown-tile win
- Call calculatePayout() with all parameters
- Store winning hand structure using existing storeWinningData()
- Emit 'mahjong:winner_reveal' with winner, hand, winType, isPure, payouts
- Emit 'mahjong:payout_calculated' with detailed breakdown
- Call endRound()

---

### 16. Priority System - Win > Kong > Pong
**Requirements:** R7  
**Description:** Ensure correct interrupt priority after discard.

**Sub-tasks:**
- Modify handleAfterDiscard() priority order:
  1. Check left player can win (3-4 sec decision)
  2. If no win, check any player can Kong (3-4 sec decision)
  3. If no Kong, check any player can Pong (3-4 sec decision)
  4. If no interrupts, next player draws
- Keep existing decision timeout logic (3-4 seconds with auto-pass)

---

### 17. Player View Hand State - Shown Tiles
**Requirements:** R2, R13  
**Description:** Include shown tiles in player view hand state.

**Sub-tasks:**
- Modify buildPlayerViewHandState() to include shown tiles
- Add shownTiles field to hand state object
- Update all hand state emits to include shown tiles
- Ensure shown tiles visible to all players (not hidden)

---

### 18. Draw Condition
**Requirements:** R16  
**Description:** Handle draw when wall is exhausted.

**Sub-tasks:**
- Before each draw (startPlayerTurn, afterKong), check wall count
- If wall empty (llen = 0), emit 'mahjong:draw_round'
- Set DRAW_STATUS_KEY(roomId) = true
- Call endRound() with no winner
- No payout on draw

---

### 19. Frontend Events - Complete Set
**Requirements:** R13, R14  
**Description:** Ensure all new events are emitted correctly.

**Sub-tasks:**
- Verify 'mahjong:shown_tiles_updated' emitted on: init, take, replace
- Verify 'mahjong:can_take_shown_tile' emitted after each Kong
- Verify 'mahjong:shown_tile_taken' emitted when player takes
- Verify 'mahjong:winner_reveal' includes: winType, isPure, payouts, consecutiveCount
- Verify 'mahjong:payout_calculated' emitted with full breakdown

---

### 20. Code Cleanup
**Requirements:** R17  
**Description:** Remove obsolete code and temporary markers.

**Sub-tasks:**
- Remove all `// temporary codes. Delete later.` sections
- Remove GAME_START_KEY, GAME_END_KEY, temporaryStartRound, temporaryEndRound
- Remove commented-out test code blocks
- Remove empty event files: discardTile.js, drawTile.js, startGame.js
- Remove unused imports
- Add comments for key sections (shown tiles, payout, win detection)

---

### 21. Integration Testing
**Requirements:** All  
**Description:** Manual testing of complete game flow.

**Sub-tasks:**
- Test 2-player game: full round with self-draw win
- Test 3-player game: full round with left-discard win
- Test shown tile win: Kong → take shown tile → win
- Test consecutive shown tile: multiple Kongs → multiple shown tiles → win
- Test pure hand bonus: all dot win, all bamboo win
- Test mixed hand: dot + bamboo win
- Test draw condition: wall exhausted
- Test Pong/Kong interrupts from any player
- Test left player win restriction (other players cannot win from discard)
- Verify payouts calculated correctly for all win types

---

## Task Dependency Graph

```json
{
  "1": [],
  "2": ["1"],
  "3": ["1"],
  "4": ["3"],
  "5": ["2", "3"],
  "6": ["4", "5"],
  "7": ["5", "6"],
  "8": ["7"],
  "9": ["7", "8"],
  "10": ["4", "6"],
  "11": ["7"],
  "12": ["7"],
  "13": ["7"],
  "14": ["7"],
  "15": ["8", "9", "10", "12", "13", "14"],
  "16": ["9", "11", "15"],
  "17": ["15", "16"],
  "18": ["16"],
  "19": ["17", "18"],
  "20": ["19"],
  "21": ["20"],
  "waves": [
    ["1"],
    ["2", "3"],
    ["4", "5"],
    ["6"],
    ["7"],
    ["8", "11", "12", "13", "14"],
    ["9", "10"],
    ["15"],
    ["16"],
    ["17", "18"],
    ["19"],
    ["20"],
    ["21"]
  ]
}
```
