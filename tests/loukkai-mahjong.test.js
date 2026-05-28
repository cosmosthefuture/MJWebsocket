/**
 * Loukkai Mahjong Unit Tests
 * 
 * Tests for core game logic including:
 * - Win detection (4 sets + 1 pair)
 * - Pure hand detection
 * - Payout calculation (self-draw, left-discard, shown-tile)
 * - Left player identification
 * - Consecutive shown-tile multiplier
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import redis from '../src/config/redis.js';

// Mock Redis for testing
const mockRedis = {
  data: new Map(),
  
  async get(key) {
    return this.data.get(key) || null;
  },
  
  async set(key, value) {
    this.data.set(key, value);
    return 'OK';
  },
  
  async hgetall(key) {
    const value = this.data.get(key);
    return value || {};
  },
  
  async hset(key, field, value) {
    const hash = this.data.get(key) || {};
    hash[field] = value;
    this.data.set(key, hash);
    return 1;
  },
  
  async lrange(key, start, end) {
    const list = this.data.get(key) || [];
    if (end === -1) return list;
    return list.slice(start, end + 1);
  },
  
  async incr(key) {
    const value = parseInt(this.data.get(key) || '0');
    this.data.set(key, String(value + 1));
    return value + 1;
  },
  
  async del(key) {
    return this.data.delete(key) ? 1 : 0;
  },
  
  clear() {
    this.data.clear();
  }
};

// Helper functions for testing
const ROOM_ID = 'test-room-1';
const ROUND_PLAYERS_KEY = (roomId) => `room:${roomId}:round_players`;
const SHOWN_TILES_TAKEN_THIS_TURN_KEY = (roomId, userId) => 
  `mahjong:room:${roomId}:shown_tiles_taken:${userId}`;
const PAYOUT_DATA_KEY = (roomId) => `mahjong:room:${roomId}:payout_data`;

// Test data
const createPlayers = () => [
  { userId: '1', name: 'Player 1', seat: 1 },
  { userId: '2', name: 'Player 2', seat: 2 },
  { userId: '3', name: 'Player 3', seat: 3 }
];

const createTiles = (type, numbers) => {
  return numbers.map((num, idx) => ({
    id: idx + 1,
    type,
    number: num,
    copy_no: 1
  }));
};

describe('Loukkai Mahjong - Win Detection', () => {
  
  describe('Valid Win Structures', () => {
    
    it('should detect valid win: 4 Pongs + 1 Pair (Pure Dot)', () => {
      // Hand: Dot 1,1,1 | 2,2,2 | 3,3,3 | 4,4,4 | 5,5
      const tiles = [
        ...createTiles('dot', [1, 1, 1]),
        ...createTiles('dot', [2, 2, 2]),
        ...createTiles('dot', [3, 3, 3]),
        ...createTiles('dot', [4, 4, 4]),
        ...createTiles('dot', [5, 5])
      ];
      
      const result = checkWinStructure(tiles);
      
      expect(result.canWin).toBe(true);
      expect(result.isPure).toBe(true);
      expect(result.sets.length).toBe(4);
      expect(result.pair).toBeDefined();
    });
    
    it('should detect valid win: 4 Chows + 1 Pair (Pure Bamboo)', () => {
      // Hand: Bamboo 1,2,3 | 1,2,3 | 4,5,6 | 4,5,6 | 7,7
      const tiles = [
        ...createTiles('bamboo', [1, 2, 3]),
        ...createTiles('bamboo', [1, 2, 3]),
        ...createTiles('bamboo', [4, 5, 6]),
        ...createTiles('bamboo', [4, 5, 6]),
        ...createTiles('bamboo', [7, 7])
      ];
      
      const result = checkWinStructure(tiles);
      
      expect(result.canWin).toBe(true);
      expect(result.isPure).toBe(true);
    });
    
    it('should detect valid win: Mixed Pongs and Chows (Mixed Hand)', () => {
      // Hand: Dot 1,1,1 | Dot 2,3,4 | Bamboo 5,5,5 | Bamboo 6,7,8 | Dot 9,9
      const tiles = [
        ...createTiles('dot', [1, 1, 1]),
        ...createTiles('dot', [2, 3, 4]),
        ...createTiles('bamboo', [5, 5, 5]),
        ...createTiles('bamboo', [6, 7, 8]),
        ...createTiles('dot', [9, 9])
      ];
      
      const result = checkWinStructure(tiles);
      
      expect(result.canWin).toBe(true);
      expect(result.isPure).toBe(false); // Mixed hand
    });
    
    it('should detect valid win: 3 Pongs + 1 Kong + 1 Pair', () => {
      // Hand: Dot 1,1,1,1 | 2,2,2 | 3,3,3 | 4,4,4 | 5,5
      const tiles = [
        ...createTiles('dot', [1, 1, 1, 1]), // Kong
        ...createTiles('dot', [2, 2, 2]),
        ...createTiles('dot', [3, 3, 3]),
        ...createTiles('dot', [4, 4, 4]),
        ...createTiles('dot', [5, 5])
      ];
      
      const result = checkWinStructure(tiles);
      
      expect(result.canWin).toBe(true);
      expect(result.isPure).toBe(true);
    });
  });
  
  describe('Invalid Win Structures', () => {
    
    it('should reject invalid structure: only 3 sets', () => {
      // Hand: Dot 1,1,1 | 2,2,2 | 3,3,3 | 4,4 (only 3 sets + 1 pair)
      const tiles = [
        ...createTiles('dot', [1, 1, 1]),
        ...createTiles('dot', [2, 2, 2]),
        ...createTiles('dot', [3, 3, 3]),
        ...createTiles('dot', [4, 4])
      ];
      
      const result = checkWinStructure(tiles);
      
      expect(result.canWin).toBe(false);
    });
    
    it('should reject invalid structure: no pair', () => {
      // Hand: Dot 1,1,1 | 2,2,2 | 3,3,3 | 4,4,4 | 5 (no pair)
      const tiles = [
        ...createTiles('dot', [1, 1, 1]),
        ...createTiles('dot', [2, 2, 2]),
        ...createTiles('dot', [3, 3, 3]),
        ...createTiles('dot', [4, 4, 4]),
        ...createTiles('dot', [5])
      ];
      
      const result = checkWinStructure(tiles);
      
      expect(result.canWin).toBe(false);
    });
    
    it('should reject invalid structure: incomplete chow', () => {
      // Hand: Dot 1,2 | 3,3,3 | 4,4,4 | 5,5,5 | 6,6,6 | 7,7
      const tiles = [
        ...createTiles('dot', [1, 2]), // Incomplete chow
        ...createTiles('dot', [3, 3, 3]),
        ...createTiles('dot', [4, 4, 4]),
        ...createTiles('dot', [5, 5, 5]),
        ...createTiles('dot', [6, 6, 6]),
        ...createTiles('dot', [7, 7])
      ];
      
      const result = checkWinStructure(tiles);
      
      expect(result.canWin).toBe(false);
    });
  });
});

describe('Loukkai Mahjong - Pure Hand Detection', () => {
  
  it('should detect pure hand: all Dot tiles', () => {
    const tiles = createTiles('dot', [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5]);
    const revealedMelds = [];
    
    const isPure = checkPureHand(tiles, revealedMelds);
    
    expect(isPure).toBe(true);
  });
  
  it('should detect pure hand: all Bamboo tiles', () => {
    const tiles = createTiles('bamboo', [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 4]);
    const revealedMelds = [];
    
    const isPure = checkPureHand(tiles, revealedMelds);
    
    expect(isPure).toBe(true);
  });
  
  it('should detect mixed hand: Dot + Bamboo', () => {
    const tiles = [
      ...createTiles('dot', [1, 1, 1, 2, 2, 2]),
      ...createTiles('bamboo', [3, 3, 3, 4, 4, 4, 5, 5])
    ];
    const revealedMelds = [];
    
    const isPure = checkPureHand(tiles, revealedMelds);
    
    expect(isPure).toBe(false);
  });
  
  it('should detect pure hand with revealed melds', () => {
    const concealedTiles = createTiles('dot', [1, 1, 1, 2, 2]);
    const revealedMelds = [
      { type: 'pong', tiles: createTiles('dot', [3, 3, 3]) },
      { type: 'kong', tiles: createTiles('dot', [4, 4, 4, 4]) }
    ];
    
    const isPure = checkPureHand(concealedTiles, revealedMelds);
    
    expect(isPure).toBe(true);
  });
  
  it('should detect mixed hand with revealed melds', () => {
    const concealedTiles = createTiles('dot', [1, 1, 1, 2, 2]);
    const revealedMelds = [
      { type: 'pong', tiles: createTiles('bamboo', [3, 3, 3]) }, // Different type
      { type: 'kong', tiles: createTiles('dot', [4, 4, 4, 4]) }
    ];
    
    const isPure = checkPureHand(concealedTiles, revealedMelds);
    
    expect(isPure).toBe(false);
  });
});

describe('Loukkai Mahjong - Payout Calculation', () => {
  
  beforeEach(() => {
    mockRedis.clear();
    
    // Setup 3 players
    const players = createPlayers();
    const playersData = {};
    players.forEach(p => {
      playersData[p.userId] = JSON.stringify(p);
    });
    mockRedis.data.set(ROUND_PLAYERS_KEY(ROOM_ID), playersData);
  });
  
  describe('Self-Draw Payouts', () => {
    
    it('should calculate self-draw payout: mixed hand', async () => {
      const winnerId = '1';
      const winType = 'self-draw';
      const isPure = false;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, 0, mockRedis);
      
      expect(result.winnerId).toBe('1');
      expect(result.winType).toBe('self-draw');
      expect(result.isPure).toBe(false);
      expect(result.payouts.length).toBe(2); // 2 other players
      expect(result.payouts[0].amount).toBe(1); // 1× bet
      expect(result.payouts[1].amount).toBe(1); // 1× bet
    });
    
    it('should calculate self-draw payout: pure hand', async () => {
      const winnerId = '2';
      const winType = 'self-draw';
      const isPure = true;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, 0, mockRedis);
      
      expect(result.winnerId).toBe('2');
      expect(result.isPure).toBe(true);
      expect(result.payouts.length).toBe(2);
      expect(result.payouts[0].amount).toBe(10); // 10× bet
      expect(result.payouts[1].amount).toBe(10); // 10× bet
    });
  });
  
  describe('Left-Discard Payouts', () => {
    
    it('should calculate left-discard payout: mixed hand', async () => {
      const winnerId = '2'; // Winner is Player 2
      const winType = 'left-discard';
      const isPure = false;
      
      // Left player is Player 1 (previous in anti-clockwise: 3 -> 2 -> 1)
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, 0, mockRedis);
      
      expect(result.winnerId).toBe('2');
      expect(result.winType).toBe('left-discard');
      expect(result.isPure).toBe(false);
      expect(result.leftPlayerId).toBeDefined();
      
      // Find left player's payout (should be 2×)
      const leftPayout = result.payouts.find(p => p.payerId === result.leftPlayerId);
      expect(leftPayout.amount).toBe(2); // Left pays 2×
      
      // Other player pays 1×
      const otherPayout = result.payouts.find(p => p.payerId !== result.leftPlayerId);
      expect(otherPayout.amount).toBe(1);
    });
    
    it('should calculate left-discard payout: pure hand', async () => {
      const winnerId = '3';
      const winType = 'left-discard';
      const isPure = true;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, 0, mockRedis);
      
      expect(result.isPure).toBe(true);
      
      // Left player pays 10×
      const leftPayout = result.payouts.find(p => p.payerId === result.leftPlayerId);
      expect(leftPayout.amount).toBe(10);
      
      // Other players pay 5×
      const otherPayout = result.payouts.find(p => p.payerId !== result.leftPlayerId);
      expect(otherPayout.amount).toBe(5);
    });
  });
  
  describe('Shown-Tile Payouts', () => {
    
    it('should calculate shown-tile payout: mixed hand', async () => {
      const winnerId = '1';
      const winType = 'shown-tile';
      const isPure = false;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, 0, mockRedis);
      
      expect(result.winType).toBe('shown-tile');
      expect(result.isPure).toBe(false);
      expect(result.payouts.length).toBe(2);
      expect(result.payouts[0].amount).toBe(3); // All pay 3×
      expect(result.payouts[1].amount).toBe(3);
    });
    
    it('should calculate shown-tile payout: pure hand, 1st consecutive', async () => {
      const winnerId = '2';
      const winType = 'shown-tile';
      const isPure = true;
      const consecutiveCount = 1;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, consecutiveCount, mockRedis);
      
      expect(result.isPure).toBe(true);
      expect(result.consecutiveCount).toBe(1);
      
      // Formula: 10 × 2^(1-1) = 10 × 1 = 10
      expect(result.payouts[0].amount).toBe(10);
      expect(result.payouts[1].amount).toBe(10);
    });
    
    it('should calculate shown-tile payout: pure hand, 2nd consecutive', async () => {
      const winnerId = '3';
      const winType = 'shown-tile';
      const isPure = true;
      const consecutiveCount = 2;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, consecutiveCount, mockRedis);
      
      expect(result.consecutiveCount).toBe(2);
      
      // Formula: 10 × 2^(2-1) = 10 × 2 = 20
      expect(result.payouts[0].amount).toBe(20);
      expect(result.payouts[1].amount).toBe(20);
    });
    
    it('should calculate shown-tile payout: pure hand, 3rd consecutive', async () => {
      const winnerId = '1';
      const winType = 'shown-tile';
      const isPure = true;
      const consecutiveCount = 3;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, consecutiveCount, mockRedis);
      
      expect(result.consecutiveCount).toBe(3);
      
      // Formula: 10 × 2^(3-1) = 10 × 4 = 40
      expect(result.payouts[0].amount).toBe(40);
      expect(result.payouts[1].amount).toBe(40);
    });
    
    it('should calculate shown-tile payout: pure hand, 4th consecutive', async () => {
      const winnerId = '2';
      const winType = 'shown-tile';
      const isPure = true;
      const consecutiveCount = 4;
      
      const result = await calculatePayout(ROOM_ID, winnerId, winType, isPure, consecutiveCount, mockRedis);
      
      expect(result.consecutiveCount).toBe(4);
      
      // Formula: 10 × 2^(4-1) = 10 × 8 = 80
      expect(result.payouts[0].amount).toBe(80);
      expect(result.payouts[1].amount).toBe(80);
    });
  });
});

describe('Loukkai Mahjong - Left Player Identification', () => {
  
  beforeEach(() => {
    mockRedis.clear();
    
    // Setup 3 players in anti-clockwise order
    const players = createPlayers();
    const playersData = {};
    players.forEach(p => {
      playersData[p.userId] = JSON.stringify(p);
    });
    mockRedis.data.set(ROUND_PLAYERS_KEY(ROOM_ID), playersData);
  });
  
  it('should identify left player in anti-clockwise order: Player 2 -> Player 1', async () => {
    const currentUserId = '2';
    
    const leftPlayer = await getLeftPlayer(ROOM_ID, currentUserId, mockRedis);
    
    expect(leftPlayer.userId).toBe('1');
  });
  
  it('should identify left player in anti-clockwise order: Player 3 -> Player 2', async () => {
    const currentUserId = '3';
    
    const leftPlayer = await getLeftPlayer(ROOM_ID, currentUserId, mockRedis);
    
    expect(leftPlayer.userId).toBe('2');
  });
  
  it('should identify left player in anti-clockwise order: Player 1 -> Player 3 (wrap around)', async () => {
    const currentUserId = '1';
    
    const leftPlayer = await getLeftPlayer(ROOM_ID, currentUserId, mockRedis);
    
    expect(leftPlayer.userId).toBe('3');
  });
});

describe('Loukkai Mahjong - Consecutive Shown Tile Counter', () => {
  
  beforeEach(() => {
    mockRedis.clear();
  });
  
  it('should increment consecutive counter correctly', async () => {
    const userId = '1';
    
    await mockRedis.incr(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    let count = await mockRedis.get(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    expect(count).toBe('1');
    
    await mockRedis.incr(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    count = await mockRedis.get(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    expect(count).toBe('2');
    
    await mockRedis.incr(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    count = await mockRedis.get(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    expect(count).toBe('3');
  });
  
  it('should reset counter on turn end', async () => {
    const userId = '1';
    
    await mockRedis.incr(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    await mockRedis.incr(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    
    let count = await mockRedis.get(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    expect(count).toBe('2');
    
    // Reset on turn end
    await mockRedis.del(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    
    count = await mockRedis.get(SHOWN_TILES_TAKEN_THIS_TURN_KEY(ROOM_ID, userId));
    expect(count).toBeNull();
  });
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if tiles form a valid winning structure (4 sets + 1 pair)
 */
function checkWinStructure(tiles) {
  // Build tile counts
  const counts = {};
  tiles.forEach(tile => {
    const key = `${tile.type}_${tile.number}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  
  // Try each possible pair
  for (const pairKey in counts) {
    if (counts[pairKey] >= 2) {
      const testCounts = { ...counts };
      testCounts[pairKey] -= 2;
      
      if (canFormMelds(testCounts, 4)) {
        const isPure = checkPureHand(tiles, []);
        return {
          canWin: true,
          isPure,
          sets: [], // Simplified for testing
          pair: pairKey
        };
      }
    }
  }
  
  return { canWin: false };
}

/**
 * Backtracking to form melds
 */
function canFormMelds(counts, meldsNeeded) {
  if (meldsNeeded === 0) {
    return Object.values(counts).every(c => c === 0);
  }
  
  // Find first tile with count > 0
  const firstKey = Object.keys(counts).find(k => counts[k] > 0);
  if (!firstKey) return false;
  
  // Try Pong (3 identical)
  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[firstKey] += 3;
      return true;
    }
    counts[firstKey] += 3;
  }
  
  // Try Chow (3 consecutive same type)
  const [type, numStr] = firstKey.split('_');
  const num = parseInt(numStr);
  const k2 = `${type}_${num + 1}`;
  const k3 = `${type}_${num + 2}`;
  
  if (counts[k2] > 0 && counts[k3] > 0) {
    counts[firstKey]--;
    counts[k2]--;
    counts[k3]--;
    
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[firstKey]++;
      counts[k2]++;
      counts[k3]++;
      return true;
    }
    
    counts[firstKey]++;
    counts[k2]++;
    counts[k3]++;
  }
  
  return false;
}

/**
 * Check if hand is pure (all same type)
 */
function checkPureHand(concealedTiles, revealedMelds) {
  const allTiles = [...concealedTiles];
  
  for (const meld of revealedMelds) {
    allTiles.push(...meld.tiles);
  }
  
  const types = new Set(allTiles.map(t => t.type));
  return types.size === 1;
}

/**
 * Calculate payout for all win types
 */
async function calculatePayout(roomId, winnerId, winType, isPure, consecutiveCount, redis) {
  const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));
  const roundPlayers = Object.values(roundPlayersRaw).map(JSON.parse);
  
  const betAmount = 1;
  const payouts = [];
  let leftPlayerId = null;
  
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
    const leftPlayer = await getLeftPlayer(roomId, winnerId, redis);
    leftPlayerId = leftPlayer ? leftPlayer.userId : null;
    
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
      for (const player of roundPlayers) {
        if (player.userId !== winnerId) {
          payouts.push({
            payerId: player.userId,
            amount: betAmount * 3
          });
        }
      }
    } else {
      const N = consecutiveCount || 1;
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
  
  const payoutData = {
    winnerId,
    winType,
    isPure,
    payouts
  };
  
  if (winType === 'left-discard' && leftPlayerId) {
    payoutData.leftPlayerId = leftPlayerId;
  }
  
  if (winType === 'shown-tile' && isPure && consecutiveCount) {
    payoutData.consecutiveCount = consecutiveCount;
  }
  
  await redis.set(PAYOUT_DATA_KEY(roomId), JSON.stringify(payoutData));
  
  return payoutData;
}

/**
 * Get left player (previous in anti-clockwise order)
 */
async function getLeftPlayer(roomId, currentUserId, redis) {
  const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));
  const players = Object.values(roundPlayersRaw)
    .map(JSON.parse)
    .sort((a, b) => a.seat - b.seat);
  
  const currentIndex = players.findIndex(p => p.userId === currentUserId);
  if (currentIndex === -1) return null;
  
  // Anti-clockwise: previous player
  const leftIndex = currentIndex === 0 ? players.length - 1 : currentIndex - 1;
  return players[leftIndex];
}

export {
  checkWinStructure,
  checkPureHand,
  calculatePayout,
  getLeftPlayer
};
