# Loukkai Mahjong - Technical Design

## Architecture Overview

### Current Structure (Keeping)
```
MahJongRoomManager.js (6800+ lines)
├── Room lifecycle (join, leave, ensure)
├── Round lifecycle (start, end, clear)
├── Turn management (draw, discard, countdown)
├── Meld detection (Kong, Pong, Chow)
├── Win detection (checkWinningHand, checkWinUsingDiscard)
└── State management (Redis keys, player views)
```

**Approach:** Modify in place, keep monolithic structure until working.

---

## Redis Key Schema

### New Keys
```javascript
// Shown tiles (always 2 visible)
SHOWN_TILES_KEY(roomId) → JSON array of 2 tile objects

// Consecutive shown-tile counter (per player, per turn)
SHOWN_TILES_TAKEN_THIS_TURN_KEY(roomId, userId) → integer count

// Payout data
PAYOUT_DATA_KEY(roomId) → JSON object with win type, payouts
```

### Modified Keys
```javascript
// Remove CHOW_KEY (no chow from discard)
// Keep: HAND_KEY, PONG_KEY, KONG_KEY, WALL_KEY, DISCARD_KEY, etc.
```

---

## Game Flow Changes

### Setup Phase (New)
```
1. Roll dice → determine first player
2. Reveal 2 shown tiles from wall
3. Deal 13 tiles each (first player gets 14th)
4. First player discards to start
```

### Turn Flow (Modified)
```
BEFORE:
Draw → Discard → Check interrupts

AFTER:
Draw → Check self-draw win → Kong decision → Discard
  └─ If Kong: Draw extra → Take shown tile? → Check win → Repeat if another Kong
```

### After Discard (Modified)
```
BEFORE:
Check: Kong > Pong > Chow (next player)

AFTER:
Check: Win (left player only) > Kong (any) > Pong (any)
  └─ No chow from discard
```

---

## Win Detection Algorithm

### Structure Validation
```javascript
// Input: tiles array (14 tiles including winning tile)
// Output: { canWin: boolean, structure: { sets: [], pair: [] }, isPure: boolean }

function checkWinningHand(tiles, revealedMelds) {
  // 1. Count revealed melds (Pong/Kong from previous actions)
  const revealedCount = revealedMelds.length;
  const concealedMeldsNeeded = 4 - revealedCount;
  
  // 2. Build tile counts from concealed tiles
  const counts = buildCounts(tiles);
  
  // 3. Try each possible pair
  for (const pairKey in counts) {
    if (counts[pairKey] >= 2) {
      counts[pairKey] -= 2;
      
      // 4. Backtrack to form remaining melds
      if (canFormMelds(counts, concealedMeldsNeeded)) {
        // 5. Check if pure hand
        const isPure = checkPureHand(tiles, revealedMelds);
        
        return { canWin: true, pairKey, isPure };
      }
      
      counts[pairKey] += 2;
    }
  }
  
  return { canWin: false };
}

function canFormMelds(counts, meldsNeeded) {
  if (meldsNeeded === 0) {
    return Object.values(counts).every(c => c === 0);
  }
  
  // Find first tile with count > 0
  const firstKey = findFirstTile(counts);
  if (!firstKey) return false;
  
  // Try Pong (3 identical)
  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormMelds(counts, meldsNeeded - 1)) return true;
    counts[firstKey] += 3;
  }
  
  // Try Chow (3 consecutive same type)
  const [type, num] = parseKey(firstKey);
  const k2 = `${type}_${num + 1}`;
  const k3 = `${type}_${num + 2}`;
  
  if (counts[k2] > 0 && counts[k3] > 0) {
    counts[firstKey]--;
    counts[k2]--;
    counts[k3]--;
    
    if (canFormMelds(counts, meldsNeeded - 1)) return true;
    
    counts[firstKey]++;
    counts[k2]++;
    counts[k3]++;
  }
  
  return false;
}
```

### Pure Hand Check
```javascript
function checkPureHand(concealedTiles, revealedMelds) {
  // Collect all tiles (concealed + revealed)
  const allTiles = [...concealedTiles];
  
  for (const meld of revealedMelds) {
    allTiles.push(...meld.tiles);
  }
  
  // Check if all tiles are same type
  const types = new Set(allTiles.map(t => t.type));
  return types.size === 1; // true if all dot OR all bamboo
}
```

---

## Shown Tiles System

### Initialization
```javascript
async function revealShownTiles(roomId) {
  // Take 2 tiles from wall
  const tile1 = await redis.lpop(WALL_KEY(roomId));
  const tile2 = await redis.lpop(WALL_KEY(roomId));
  
  await redis.set(SHOWN_TILES_KEY(roomId), JSON.stringify([
    JSON.parse(tile1),
    JSON.parse(tile2)
  ]));
  
  io.to(SOCKET_ROOM(roomId)).emit('mahjong:shown_tiles_updated', {
    shownTiles: [JSON.parse(tile1), JSON.parse(tile2)]
  });
}
```

### Taking Shown Tile
```javascript
async function takeShownTile(roomId, userId, tileIndex) {
  // 1. Validate player has Kong
  const kongData = await redis.lrange(KONG_KEY(roomId, userId), 0, -1);
  if (kongData.length === 0) {
    throw new Error('Must have Kong to take shown tile');
  }
  
  // 2. Get shown tiles
  const shownTilesRaw = await redis.get(SHOWN_TILES_KEY(roomId));
  const shownTiles = JSON.parse(shownTilesRaw);
  
  // 3. Take selected tile
  const takenTile = shownTiles[tileIndex];
  
  // 4. Replace with new tile from wall
  const newTile = await redis.lpop(WALL_KEY(roomId));
  shownTiles[tileIndex] = JSON.parse(newTile);
  
  await redis.set(SHOWN_TILES_KEY(roomId), JSON.stringify(shownTiles));
  
  // 5. Add to player's hand
  await redis.rpush(HAND_KEY(roomId, userId), JSON.stringify(takenTile));
  
  // 6. Increment consecutive counter
  await redis.incr(SHOWN_TILES_TAKEN_THIS_TURN_KEY(roomId, userId));
  
  // 7. Broadcast
  io.to(SOCKET_ROOM(roomId)).emit('mahjong:shown_tile_taken', {
    userId,
    tile: takenTile
  });
  
  io.to(SOCKET_ROOM(roomId)).emit('mahjong:shown_tiles_updated', {
    shownTiles
  });
  
  return takenTile;
}
```

---

## Payout Calculation

### Win Type Detection
```javascript
function determineWinType(winContext) {
  if (winContext.source === 'self-draw') {
    return 'self-draw';
  }
  
  if (winContext.source === 'discard' && winContext.isLeftPlayer) {
    return 'left-discard';
  }
  
  if (winContext.source === 'shown-tile') {
    return 'shown-tile';
  }
  
  throw new Error('Invalid win source');
}
```

### Payout Formula
```javascript
async function calculatePayout(roomId, winnerId, winType, isPure) {
  const roundPlayers = await getRoundPlayers(roomId);
  const betAmount = 1; // Base bet (configurable)
  
  const payouts = [];
  
  if (winType === 'self-draw') {
    const multiplier = isPure ? 10 : 1;
    
    for (const player of roundPlayers) {
      if (player.userId !== winnerId) {
        payouts.push({
          payerId: player.userId,
          amount: betAmount * multiplier
        });
      }
    }
  }
  
  else if (winType === 'left-discard') {
    const leftPlayerId = getLeftPlayer(roomId, winnerId);
    const leftMultiplier = isPure ? 10 : 2;
    const othersMultiplier = isPure ? 5 : 1;
    
    for (const player of roundPlayers) {
      if (player.userId !== winnerId) {
        const multiplier = player.userId === leftPlayerId 
          ? leftMultiplier 
          : othersMultiplier;
        
        payouts.push({
          payerId: player.userId,
          amount: betAmount * multiplier
        });
      }
    }
  }
  
  else if (winType === 'shown-tile') {
    if (!isPure) {
      // Normal shown tile: all pay 3×
      for (const player of roundPlayers) {
        if (player.userId !== winnerId) {
          payouts.push({
            payerId: player.userId,
            amount: betAmount * 3
          });
        }
      }
    } else {
      // Pure shown tile: consecutive multiplier
      const shownTilesTaken = await redis.get(
        SHOWN_TILES_TAKEN_THIS_TURN_KEY(roomId, winnerId)
      );
      const N = parseInt(shownTilesTaken) || 1;
      const multiplier = 10 * Math.pow(2, N - 1);
      
      for (const player of roundPlayers) {
        if (player.userId !== winnerId) {
          payouts.push({
            payerId: player.userId,
            amount: betAmount * multiplier
          });
        }
      }
    }
  }
  
  return {
    winnerId,
    winType,
    isPure,
    payouts,
    consecutiveCount: winType === 'shown-tile' && isPure 
      ? parseInt(await redis.get(SHOWN_TILES_TAKEN_THIS_TURN_KEY(roomId, winnerId))) 
      : null
  };
}
```

---

## Turn Management Changes

### Start Turn (Modified)
```javascript
async function startPlayerTurn(roomId, userId, io) {
  // Reset consecutive counter at turn start
  await redis.del(SHOWN_TILES_TAKEN_THIS_TURN_KEY(roomId, userId));
  
  await redis.set(CURRENT_TURN_PLAYER_KEY(roomId), userId);
  await redis.set(ROOM_PLAYING_PHASE_KEY(roomId), 'waiting_discard');
  
  // Start 30s countdown
  const countdownEndTime = Date.now() + 30000;
  await redis.set(TURN_COUNTDOWN_END_KEY(roomId), countdownEndTime);
  
  io.to(SOCKET_ROOM(roomId)).emit('mahjong:turn_countdown_started', {
    userId,
    duration: 30
  });
  
  // Check self-draw win
  const winResult = await checkWinningHand(roomId, userId);
  if (winResult.canWin) {
    await handleWin(roomId, userId, 'self-draw', winResult.isPure, io);
    return;
  }
  
  // Check Kong
  const kongData = await checkKongExist(roomId, userId);
  if (kongData.canKong) {
    io.to(`user:${userId}`).emit('mahjong:can_kong', {
      canKong: true,
      groups: kongData.groups
    });
  }
  
  // Auto-discard on timeout
  runTurnCountdown(roomId, userId, io);
}
```

### After Kong (New)
```javascript
async function afterKong(roomId, userId, io) {
  // 1. Draw extra tile
  const extraTile = await redis.lpop(WALL_KEY(roomId));
  await redis.rpush(HAND_KEY(roomId, userId), extraTile);
  
  // 2. Check win
  const winResult = await checkWinningHand(roomId, userId);
  if (winResult.canWin) {
    await handleWin(roomId, userId, 'self-draw', winResult.isPure, io);
    return;
  }
  
  // 3. Offer shown tile
  const kongCount = await redis.llen(KONG_KEY(roomId, userId));
  if (kongCount > 0) {
    const shownTiles = await redis.get(SHOWN_TILES_KEY(roomId));
    
    io.to(`user:${userId}`).emit('mahjong:can_take_shown_tile', {
      shownTiles: JSON.parse(shownTiles)
    });
    
    // Wait for decision (3-4 seconds)
    await wait(3000);
  }
  
  // 4. Check if another Kong possible
  const kongData = await checkKongExist(roomId, userId);
  if (kongData.canKong) {
    io.to(`user:${userId}`).emit('mahjong:can_kong', {
      canKong: true,
      groups: kongData.groups
    });
  }
}
```

---

## Event Flow Diagrams

### Normal Turn
```
Player draws tile
  ↓
Check self-draw win? → YES → Handle win
  ↓ NO
Check Kong? → YES → Declare Kong → Draw extra → Take shown tile? → Check win → Repeat
  ↓ NO
Discard tile
  ↓
Check interrupts (Win/Kong/Pong from others)
  ↓
Next player turn
```

### After Discard
```
Player discards tile
  ↓
Check left player can win? → YES → Ask decision → Accept → Handle win
  ↓ NO / PASS
Check any player can Kong? → YES → Ask decision → Accept → Interrupt Kong
  ↓ NO / PASS
Check any player can Pong? → YES → Ask decision → Accept → Interrupt Pong
  ↓ NO / PASS
Next player draws
```

---

## Migration Strategy

### Phase 1: Core Structure (Tasks 1-5)
- Update tile set validation (72 tiles, 2-3 players)
- Implement shown tiles system
- Modify turn flow (draw → win check → Kong → discard)
- Update win detection (4 sets + 1 pair, mixed/pure)
- Restrict win sources (self-draw, left-discard, shown-tile)

### Phase 2: Meld Rules (Tasks 6-7)
- Remove chow-from-discard logic
- Keep Pong/Kong from any player's discard

### Phase 3: Payout System (Tasks 8-11)
- Implement pure hand detection
- Calculate payouts for all win types
- Implement consecutive shown-tile multiplier

### Phase 4: State & Events (Tasks 12-14)
- Update Redis keys
- Emit new frontend events
- Update player view hand state

### Phase 5: Polish (Tasks 15-17)
- Enforce player count validation
- Handle draw condition
- Code cleanup

---

## Testing Approach

### Unit-Level (Manual)
- Win detection with various tile combinations
- Pure hand detection (all dot, all bamboo, mixed)
- Payout calculation for each win type
- Consecutive multiplier formula

### Integration-Level (Manual)
- Full round with 2 players
- Full round with 3 players
- Kong → shown tile → win flow
- Multiple Kongs in one turn
- Interrupt Pong/Kong from discard

### Edge Cases
- Wall exhausted (draw)
- Multiple players can Pong same tile
- Left player wins vs other player wins
- Shown tile taken but doesn't win (counter resets)

---

## Performance Considerations

- Redis operations: batch where possible (MULTI/EXEC)
- Backtracking win detection: optimize with memoization if needed
- Turn countdown: use single interval per room (existing pattern)
- Broadcast events: use Socket.IO rooms efficiently (existing pattern)

---

## Rollback Plan

If critical issues arise:
1. Git revert to previous commit
2. Restore old MahJongRoomManager.js from backup
3. Clear Redis state for affected rooms
4. Restart websocket server

**Backup before starting:** Copy current MahJongRoomManager.js to `MahJongRoomManager.backup.js`
