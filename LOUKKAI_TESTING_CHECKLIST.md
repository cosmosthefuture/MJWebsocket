# Loukkai Mahjong - Integration Testing Checklist

## Overview
This document provides a comprehensive testing checklist for the Loukkai Mahjong implementation. All tasks (1-20) have been completed. This checklist covers Task 21: Integration Testing.

## Test Environment Setup
1. Start the websocket server
2. Start the Laravel backend
3. Open 2-3 browser windows/tabs for testing multiplayer scenarios
4. Ensure Redis is running

---

## Test Suite

### Test 1: 2-Player Game - Self-Draw Win
**Objective:** Verify basic 2-player game flow with self-draw win

**Steps:**
1. Player 1 joins room
2. Player 2 joins room
3. Verify room shows 2 players
4. Start round
5. Verify 2 shown tiles are revealed
6. Verify each player has 13 tiles (first player has 14)
7. Play through turns until a player achieves self-draw win
8. Verify win detection works correctly
9. Verify payout calculation:
   - Pure hand: loser pays 10×
   - Mixed hand: loser pays 1×
10. Verify round ends properly

**Expected Results:**
- ✅ Room accepts exactly 2 players
- ✅ Shown tiles visible to all players
- ✅ Self-draw win detected correctly
- ✅ Payout calculated correctly
- ✅ Round ends and cleans up state

---

### Test 2: 3-Player Game - Left-Discard Win
**Objective:** Verify 3-player game with left player discard win

**Steps:**
1. Player 1, 2, and 3 join room
2. Verify room shows 3 players
3. Attempt to add 4th player → should be rejected
4. Start round
5. Play through turns
6. Arrange for left player to discard a tile that completes another player's hand
7. Verify only the left player's discard triggers win prompt
8. Accept win
9. Verify payout calculation:
   - Pure hand: left pays 10×, others pay 5×
   - Mixed hand: left pays 2×, others pay 1×

**Expected Results:**
- ✅ Room accepts maximum 3 players
- ✅ 4th player rejected with "Room full (max 3 players)"
- ✅ Only left player's discard can be used to win
- ✅ Other players' discards do NOT trigger win
- ✅ Payout calculated correctly for left-discard win

---

### Test 3: Shown Tile Win - Single Take
**Objective:** Verify shown tile win mechanism

**Steps:**
1. Start a game with 2-3 players
2. Player declares Kong
3. Verify player draws extra tile
4. Verify "can take shown tile" prompt appears
5. Player takes a shown tile
6. Verify taken tile is replaced immediately
7. Verify new shown tile is broadcast
8. If taken tile completes hand, verify win is detected
9. Verify payout calculation:
   - Pure hand: all pay 10× (1st consecutive)
   - Mixed hand: all pay 3×

**Expected Results:**
- ✅ Kong triggers extra draw
- ✅ Shown tile offer appears after Kong
- ✅ Taken shown tile replaced immediately
- ✅ Win detected if hand completed
- ✅ Payout calculated correctly

---

### Test 4: Consecutive Shown Tile - Pure Hand Multiplier
**Objective:** Verify consecutive shown tile multiplier formula

**Steps:**
1. Start a game
2. Player declares Kong → takes shown tile (1st)
3. If another Kong possible, declare Kong → takes shown tile (2nd)
4. Continue if more Kongs available (3rd, 4th)
5. Win with pure hand using shown tile
6. Verify payout calculation uses formula: `10 × 2^(N-1)`
   - 1st shown tile: 10× (10 × 2^0)
   - 2nd shown tile: 20× (10 × 2^1)
   - 3rd shown tile: 40× (10 × 2^2)
   - 4th shown tile: 80× (10 × 2^3)

**Expected Results:**
- ✅ Consecutive counter increments correctly
- ✅ Counter resets when turn ends
- ✅ Multiplier calculated correctly
- ✅ Payout reflects consecutive multiplier

---

### Test 5: Pure Hand Bonus
**Objective:** Verify pure hand detection and bonus

**Steps:**
1. Start a game
2. Arrange hand to have all dot tiles (pure dot)
3. Win with self-draw
4. Verify isPure flag is true
5. Verify payout multiplier is 10× (not 1×)
6. Repeat with all bamboo tiles (pure bamboo)
7. Test mixed hand (dot + bamboo) → verify isPure is false

**Expected Results:**
- ✅ All dot tiles detected as pure
- ✅ All bamboo tiles detected as pure
- ✅ Mixed tiles detected as not pure
- ✅ Pure hand multiplier applied correctly

---

### Test 6: Mixed Hand Win
**Objective:** Verify mixed hand (dot + bamboo) is valid

**Steps:**
1. Start a game
2. Arrange hand with mix of dot and bamboo tiles
3. Form 4 sets + 1 pair (valid structure)
4. Win with self-draw or left-discard
5. Verify win is accepted
6. Verify isPure flag is false
7. Verify payout uses base multiplier (no pure bonus)

**Expected Results:**
- ✅ Mixed hand accepted as valid win
- ✅ isPure flag correctly set to false
- ✅ Base payout multiplier applied

---

### Test 7: Draw Condition
**Objective:** Verify draw when wall is exhausted

**Steps:**
1. Start a game
2. Play through turns until wall is empty
3. Verify "mahjong:draw_round" event is emitted
4. Verify no payout is calculated
5. Verify round ends properly
6. Verify state is cleaned up

**Expected Results:**
- ✅ Draw detected when wall empty
- ✅ Draw event emitted
- ✅ No winner, no payout
- ✅ Round ends cleanly

---

### Test 8: Pong/Kong Interrupt from Any Player
**Objective:** Verify Pong/Kong can be claimed from any player's discard

**Steps:**
1. Start a 3-player game
2. Player 1 discards a tile
3. Player 2 (not left player) has 2 matching tiles → can Pong
4. Verify Pong prompt appears for Player 2
5. Accept Pong
6. Verify Player 2 becomes current player
7. Repeat for Kong (3 matching tiles)

**Expected Results:**
- ✅ Any player can claim Pong from any discard
- ✅ Any player can claim Kong from any discard
- ✅ Claiming player becomes current player

---

### Test 9: Left Player Win Restriction
**Objective:** Verify only left player can win from discard

**Steps:**
1. Start a 3-player game (Player 1, 2, 3)
2. Player 1 discards a tile
3. Player 2 (left player) can win with this tile
4. Player 3 (not left player) can also win with this tile
5. Verify only Player 2 gets win prompt
6. Verify Player 3 does NOT get win prompt
7. Test in anti-clockwise order

**Expected Results:**
- ✅ Only left player (previous in turn) can win from discard
- ✅ Other players cannot win from discard
- ✅ Turn order is anti-clockwise

---

### Test 10: No Chow from Discard
**Objective:** Verify chow cannot be claimed from discard

**Steps:**
1. Start a game
2. Player 1 discards a tile
3. Player 2 has tiles that would form a chow with the discard
4. Verify NO chow prompt appears
5. Verify chow is only used for win validation (tiles in hand)

**Expected Results:**
- ✅ No chow prompt after discard
- ✅ Chow only detected for win validation
- ✅ No ACCEPT_NORMAL_CHOW event handler

---

### Test 11: Priority System - Win > Kong > Pong
**Objective:** Verify interrupt priority order

**Steps:**
1. Start a 3-player game
2. Player 1 discards a tile
3. Arrange scenario where:
   - Player 2 (left) can win with this tile
   - Player 3 can Kong with this tile
4. Verify Player 2 gets win prompt first
5. If Player 2 declines, verify Player 3 gets Kong prompt
6. Test Kong > Pong priority similarly

**Expected Results:**
- ✅ Win (left player only) has highest priority
- ✅ Kong has second priority
- ✅ Pong has third priority
- ✅ Decision timeout works (3-4 seconds)

---

### Test 12: Kong Chaining
**Objective:** Verify multiple Kongs in one turn

**Steps:**
1. Start a game
2. Player declares Kong
3. Draw extra tile
4. If extra tile completes another Kong, verify Kong prompt appears
5. Declare second Kong
6. Verify process repeats
7. Verify shown tile offer after each Kong

**Expected Results:**
- ✅ Kong can be chained in same turn
- ✅ Extra draw after each Kong
- ✅ Shown tile offer after each Kong
- ✅ Win check after each extra draw

---

### Test 13: Turn Countdown and Auto-Discard
**Objective:** Verify 30-second turn timer

**Steps:**
1. Start a game
2. Wait for turn countdown to start
3. Do not take any action
4. Verify countdown reaches 0
5. Verify auto-discard happens
6. Verify turn passes to next player

**Expected Results:**
- ✅ 30-second countdown starts
- ✅ Auto-discard on timeout
- ✅ Turn passes correctly

---

### Test 14: Player Reconnection
**Objective:** Verify state recovery after disconnect

**Steps:**
1. Start a game with 2-3 players
2. Player disconnects mid-game
3. Player reconnects
4. Verify player sees current game state
5. Verify shown tiles are visible
6. Verify hand state is correct

**Expected Results:**
- ✅ State recovered correctly
- ✅ Shown tiles visible
- ✅ Hand state accurate
- ✅ Game continues normally

---

### Test 15: Frontend Events
**Objective:** Verify all new events are emitted correctly

**Events to verify:**
- ✅ `mahjong:shown_tiles_updated` - on init, take, replace
- ✅ `mahjong:can_take_shown_tile` - after Kong
- ✅ `mahjong:shown_tile_taken` - when player takes
- ✅ `mahjong:winner_reveal` - includes winType, isPure, payouts
- ✅ `mahjong:payout_calculated` - detailed breakdown
- ✅ `mahjong:draw_round` - when wall exhausted

**Steps:**
1. Monitor browser console for events
2. Play through various scenarios
3. Verify each event is emitted with correct data

---

## Test Results Template

```
Test #: [Test Name]
Date: [Date]
Tester: [Name]
Result: [PASS/FAIL]
Notes: [Any observations or issues]
```

---

## Known Limitations
- Character tiles not supported (Loukkai variant uses only dot and bamboo)
- No wind/dragon honor tiles (not in Loukkai variant)
- Maximum 3 players per round (Loukkai rule)
- Chow cannot be claimed from discard (Loukkai rule)

---

## Troubleshooting

### Issue: Win not detected
- Check if hand has exactly 4 sets + 1 pair
- Verify tiles are correctly counted
- Check console for win detection logs

### Issue: Payout incorrect
- Verify winType is correct (self-draw, left-discard, shown-tile)
- Check isPure flag
- For shown-tile pure, verify consecutive count

### Issue: Shown tiles not updating
- Check Redis SHOWN_TILES_KEY
- Verify wall has tiles remaining
- Check browser console for events

### Issue: Turn not advancing
- Check if wall is empty (draw condition)
- Verify no pending win/Kong/Pong decisions
- Check turn countdown timer

---

## Success Criteria
All 15 tests must pass for the implementation to be considered complete and ready for production.

---

## Post-Testing
After all tests pass:
1. Document any edge cases discovered
2. Update requirements if needed
3. Consider performance optimization
4. Plan for code refactoring (if needed)
5. Deploy to staging environment
