/**
 * Loukkai Mahjong Rules Test Suite
 * 
 * Run with: node test-loukkai-rules.js
 * 
 * Tests all core game logic:
 * - Win detection (4 sets + 1 pair)
 * - Pure hand detection
 * - Payout calculations
 * - Left player identification
 * - Consecutive multiplier
 */

console.log('🎮 Loukkai Mahjong Rules Test Suite');
console.log('='.repeat(60));

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

// Simple test framework
function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failedTests++;
    failures.push({ name, error: error.message });
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// Helper: Create tiles
function createTiles(type, numbers) {
  return numbers.map((num, idx) => ({
    id: idx + 1,
    type,
    number: num,
    copy_no: 1
  }));
}

// ==================== WIN DETECTION LOGIC ====================

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
          pairKey
        };
      }
    }
  }
  
  return { canWin: false };
}

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

function checkPureHand(concealedTiles, revealedMelds) {
  const allTiles = [...concealedTiles];
  
  for (const meld of revealedMelds) {
    allTiles.push(...meld.tiles);
  }
  
  const types = new Set(allTiles.map(t => t.type));
  return types.size === 1;
}

// ==================== PAYOUT CALCULATION ====================

function calculatePayout(winnerId, winType, isPure, consecutiveCount, players) {
  const betAmount = 1;
  const payouts = [];
  let leftPlayerId = null;
  
  if (winType === 'self-draw') {
    const multiplier = isPure ? 10 : 1;
    for (const player of players) {
      if (player.userId !== winnerId) {
        payouts.push({
          payerId: player.userId,
          amount: betAmount * multiplier
        });
      }
    }
  }
  else if (winType === 'left-discard') {
    const leftPlayer = getLeftPlayer(winnerId, players);
    leftPlayerId = leftPlayer ? leftPlayer.userId : null;
    
    const leftMultiplier = isPure ? 10 : 2;
    const othersMultiplier = isPure ? 5 : 1;
    
    for (const player of players) {
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
      for (const player of players) {
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
      
      for (const player of players) {
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
  
  return payoutData;
}

function getLeftPlayer(currentUserId, players) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const currentIndex = sorted.findIndex(p => p.userId === currentUserId);
  if (currentIndex === -1) return null;
  
  // Anti-clockwise: previous player
  const leftIndex = currentIndex === 0 ? sorted.length - 1 : currentIndex - 1;
  return sorted[leftIndex];
}

// ==================== TEST SUITE ====================

console.log('\n📋 Test Category: Win Detection - Valid Structures\n');

test('Valid win: 4 Pongs + 1 Pair (Pure Dot)', () => {
  const tiles = [
    ...createTiles('dot', [1, 1, 1]),
    ...createTiles('dot', [2, 2, 2]),
    ...createTiles('dot', [3, 3, 3]),
    ...createTiles('dot', [4, 4, 4]),
    ...createTiles('dot', [5, 5])
  ];
  
  const result = checkWinStructure(tiles);
  
  assert(result.canWin === true, 'Should be a valid win');
  assert(result.isPure === true, 'Should be pure hand');
});

test('Valid win: 4 Chows + 1 Pair (Pure Bamboo)', () => {
  const tiles = [
    ...createTiles('bamboo', [1, 2, 3]),
    ...createTiles('bamboo', [1, 2, 3]),
    ...createTiles('bamboo', [4, 5, 6]),
    ...createTiles('bamboo', [4, 5, 6]),
    ...createTiles('bamboo', [7, 7])
  ];
  
  const result = checkWinStructure(tiles);
  
  assert(result.canWin === true, 'Should be a valid win');
  assert(result.isPure === true, 'Should be pure hand');
});

test('Valid win: Mixed Pongs and Chows (Mixed Hand)', () => {
  const tiles = [
    ...createTiles('dot', [1, 1, 1]),
    ...createTiles('dot', [2, 3, 4]),
    ...createTiles('bamboo', [5, 5, 5]),
    ...createTiles('bamboo', [6, 7, 8]),
    ...createTiles('dot', [9, 9])
  ];
  
  const result = checkWinStructure(tiles);
  
  assert(result.canWin === true, 'Should be a valid win');
  assert(result.isPure === false, 'Should be mixed hand');
});

test('Valid win: 3 Pongs + 1 Kong + 1 Pair', () => {
  // Note: Kong (4 identical) is treated as Pong (3) + 1 extra for win detection
  // So this hand has 15 tiles total, which is valid after Kong
  const tiles = [
    ...createTiles('dot', [1, 1, 1]), // Pong
    ...createTiles('dot', [2, 2, 2]), // Pong
    ...createTiles('dot', [3, 3, 3]), // Pong
    ...createTiles('dot', [4, 4, 4]), // Pong (Kong would be revealed separately)
    ...createTiles('dot', [5, 5])     // Pair
  ];
  
  const result = checkWinStructure(tiles);
  
  assert(result.canWin === true, 'Should be a valid win');
  assert(result.isPure === true, 'Should be pure hand');
});

console.log('\n📋 Test Category: Win Detection - Invalid Structures\n');

test('Invalid: Only 3 sets + 1 pair (need 4 sets)', () => {
  const tiles = [
    ...createTiles('dot', [1, 1, 1]),
    ...createTiles('dot', [2, 2, 2]),
    ...createTiles('dot', [3, 3, 3]),
    ...createTiles('dot', [4, 4])
  ];
  
  const result = checkWinStructure(tiles);
  
  assert(result.canWin === false, 'Should NOT be a valid win');
});

test('Invalid: No pair (4 sets + 1 single tile)', () => {
  const tiles = [
    ...createTiles('dot', [1, 1, 1]),
    ...createTiles('dot', [2, 2, 2]),
    ...createTiles('dot', [3, 3, 3]),
    ...createTiles('dot', [4, 4, 4]),
    ...createTiles('dot', [5])
  ];
  
  const result = checkWinStructure(tiles);
  
  assert(result.canWin === false, 'Should NOT be a valid win');
});

test('Invalid: Incomplete chow', () => {
  const tiles = [
    ...createTiles('dot', [1, 2]),
    ...createTiles('dot', [3, 3, 3]),
    ...createTiles('dot', [4, 4, 4]),
    ...createTiles('dot', [5, 5, 5]),
    ...createTiles('dot', [6, 6, 6]),
    ...createTiles('dot', [7, 7])
  ];
  
  const result = checkWinStructure(tiles);
  
  assert(result.canWin === false, 'Should NOT be a valid win');
});

console.log('\n📋 Test Category: Pure Hand Detection\n');

test('Pure hand: All Dot tiles', () => {
  const tiles = createTiles('dot', [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5]);
  const isPure = checkPureHand(tiles, []);
  
  assert(isPure === true, 'Should be pure hand');
});

test('Pure hand: All Bamboo tiles', () => {
  const tiles = createTiles('bamboo', [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 4]);
  const isPure = checkPureHand(tiles, []);
  
  assert(isPure === true, 'Should be pure hand');
});

test('Mixed hand: Dot + Bamboo', () => {
  const tiles = [
    ...createTiles('dot', [1, 1, 1, 2, 2, 2]),
    ...createTiles('bamboo', [3, 3, 3, 4, 4, 4, 5, 5])
  ];
  const isPure = checkPureHand(tiles, []);
  
  assert(isPure === false, 'Should be mixed hand');
});

test('Pure hand with revealed melds (all Dot)', () => {
  const concealedTiles = createTiles('dot', [1, 1, 1, 2, 2]);
  const revealedMelds = [
    { type: 'pong', tiles: createTiles('dot', [3, 3, 3]) },
    { type: 'kong', tiles: createTiles('dot', [4, 4, 4, 4]) }
  ];
  
  const isPure = checkPureHand(concealedTiles, revealedMelds);
  
  assert(isPure === true, 'Should be pure hand');
});

test('Mixed hand with revealed melds (Dot + Bamboo)', () => {
  const concealedTiles = createTiles('dot', [1, 1, 1, 2, 2]);
  const revealedMelds = [
    { type: 'pong', tiles: createTiles('bamboo', [3, 3, 3]) },
    { type: 'kong', tiles: createTiles('dot', [4, 4, 4, 4]) }
  ];
  
  const isPure = checkPureHand(concealedTiles, revealedMelds);
  
  assert(isPure === false, 'Should be mixed hand');
});

console.log('\n📋 Test Category: Payout - Self-Draw\n');

const players = [
  { userId: '1', name: 'Player 1', seat: 1 },
  { userId: '2', name: 'Player 2', seat: 2 },
  { userId: '3', name: 'Player 3', seat: 3 }
];

test('Self-draw: Mixed hand (all pay 1×)', () => {
  const result = calculatePayout('1', 'self-draw', false, 0, players);
  
  assertEqual(result.winnerId, '1', 'Winner should be Player 1');
  assertEqual(result.winType, 'self-draw', 'Win type should be self-draw');
  assertEqual(result.isPure, false, 'Should be mixed hand');
  assertEqual(result.payouts.length, 2, 'Should have 2 payouts');
  assertEqual(result.payouts[0].amount, 1, 'Player 2 should pay 1×');
  assertEqual(result.payouts[1].amount, 1, 'Player 3 should pay 1×');
});

test('Self-draw: Pure hand (all pay 10×)', () => {
  const result = calculatePayout('2', 'self-draw', true, 0, players);
  
  assertEqual(result.winnerId, '2', 'Winner should be Player 2');
  assertEqual(result.isPure, true, 'Should be pure hand');
  assertEqual(result.payouts[0].amount, 10, 'Player 1 should pay 10×');
  assertEqual(result.payouts[1].amount, 10, 'Player 3 should pay 10×');
});

console.log('\n📋 Test Category: Payout - Left-Discard\n');

test('Left-discard: Mixed hand (left pays 2×, others pay 1×)', () => {
  const result = calculatePayout('2', 'left-discard', false, 0, players);
  
  assertEqual(result.winType, 'left-discard', 'Win type should be left-discard');
  assert(result.leftPlayerId !== undefined, 'Should have leftPlayerId');
  
  const leftPayout = result.payouts.find(p => p.payerId === result.leftPlayerId);
  const otherPayout = result.payouts.find(p => p.payerId !== result.leftPlayerId);
  
  assertEqual(leftPayout.amount, 2, 'Left player should pay 2×');
  assertEqual(otherPayout.amount, 1, 'Other player should pay 1×');
});

test('Left-discard: Pure hand (left pays 10×, others pay 5×)', () => {
  const result = calculatePayout('3', 'left-discard', true, 0, players);
  
  assertEqual(result.isPure, true, 'Should be pure hand');
  
  const leftPayout = result.payouts.find(p => p.payerId === result.leftPlayerId);
  const otherPayout = result.payouts.find(p => p.payerId !== result.leftPlayerId);
  
  assertEqual(leftPayout.amount, 10, 'Left player should pay 10×');
  assertEqual(otherPayout.amount, 5, 'Other player should pay 5×');
});

console.log('\n📋 Test Category: Payout - Shown-Tile\n');

test('Shown-tile: Mixed hand (all pay 3×)', () => {
  const result = calculatePayout('1', 'shown-tile', false, 0, players);
  
  assertEqual(result.winType, 'shown-tile', 'Win type should be shown-tile');
  assertEqual(result.isPure, false, 'Should be mixed hand');
  assertEqual(result.payouts[0].amount, 3, 'All should pay 3×');
  assertEqual(result.payouts[1].amount, 3, 'All should pay 3×');
});

test('Shown-tile: Pure, 1st consecutive (10×)', () => {
  const result = calculatePayout('2', 'shown-tile', true, 1, players);
  
  assertEqual(result.isPure, true, 'Should be pure hand');
  assertEqual(result.consecutiveCount, 1, 'Should be 1st consecutive');
  assertEqual(result.payouts[0].amount, 10, 'Formula: 10 × 2^0 = 10');
  assertEqual(result.payouts[1].amount, 10, 'Formula: 10 × 2^0 = 10');
});

test('Shown-tile: Pure, 2nd consecutive (20×)', () => {
  const result = calculatePayout('3', 'shown-tile', true, 2, players);
  
  assertEqual(result.consecutiveCount, 2, 'Should be 2nd consecutive');
  assertEqual(result.payouts[0].amount, 20, 'Formula: 10 × 2^1 = 20');
  assertEqual(result.payouts[1].amount, 20, 'Formula: 10 × 2^1 = 20');
});

test('Shown-tile: Pure, 3rd consecutive (40×)', () => {
  const result = calculatePayout('1', 'shown-tile', true, 3, players);
  
  assertEqual(result.consecutiveCount, 3, 'Should be 3rd consecutive');
  assertEqual(result.payouts[0].amount, 40, 'Formula: 10 × 2^2 = 40');
  assertEqual(result.payouts[1].amount, 40, 'Formula: 10 × 2^2 = 40');
});

test('Shown-tile: Pure, 4th consecutive (80×)', () => {
  const result = calculatePayout('2', 'shown-tile', true, 4, players);
  
  assertEqual(result.consecutiveCount, 4, 'Should be 4th consecutive');
  assertEqual(result.payouts[0].amount, 80, 'Formula: 10 × 2^3 = 80');
  assertEqual(result.payouts[1].amount, 80, 'Formula: 10 × 2^3 = 80');
});

console.log('\n📋 Test Category: Left Player Identification (Anti-Clockwise)\n');

test('Left player: Player 2 -> Player 1', () => {
  const leftPlayer = getLeftPlayer('2', players);
  assertEqual(leftPlayer.userId, '1', 'Left of Player 2 should be Player 1');
});

test('Left player: Player 3 -> Player 2', () => {
  const leftPlayer = getLeftPlayer('3', players);
  assertEqual(leftPlayer.userId, '2', 'Left of Player 3 should be Player 2');
});

test('Left player: Player 1 -> Player 3 (wrap around)', () => {
  const leftPlayer = getLeftPlayer('1', players);
  assertEqual(leftPlayer.userId, '3', 'Left of Player 1 should be Player 3 (wrap)');
});

// ==================== SUMMARY ====================

console.log('\n' + '='.repeat(60));
console.log('\n📊 Test Summary:');
console.log(`   Total Tests: ${totalTests}`);
console.log(`   ✅ Passed: ${passedTests}`);
console.log(`   ❌ Failed: ${failedTests}`);
console.log(`   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (failedTests > 0) {
  console.log('\n❌ Failed Tests Details:');
  failures.forEach((failure, idx) => {
    console.log(`\n${idx + 1}. ${failure.name}`);
    console.log(`   ${failure.error}`);
  });
  console.log('\n');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed! Loukkai Mahjong rules are working correctly.\n');
  process.exit(0);
}
