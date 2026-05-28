/**
 * Simple Test Runner for Loukkai Mahjong
 * Run with: node tests/run-tests.js
 */

// Test results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

// Simple assertion library
function expect(actual) {
  return {
    toBe(expected) {
      totalTests++;
      if (actual === expected) {
        passedTests++;
        return true;
      } else {
        failedTests++;
        failures.push({
          expected,
          actual,
          message: `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        });
        return false;
      }
    },
    toBeDefined() {
      totalTests++;
      if (actual !== undefined && actual !== null) {
        passedTests++;
        return true;
      } else {
        failedTests++;
        failures.push({
          expected: 'defined value',
          actual,
          message: `Expected value to be defined, got ${actual}`
        });
        return false;
      }
    },
    toBeNull() {
      totalTests++;
      if (actual === null) {
        passedTests++;
        return true;
      } else {
        failedTests++;
        failures.push({
          expected: null,
          actual,
          message: `Expected null, got ${JSON.stringify(actual)}`
        });
        return false;
      }
    }
  };
}

// Test suite runner
function describe(suiteName, fn) {
  console.log(`\n📦 ${suiteName}`);
  fn();
}

function it(testName, fn) {
  try {
    fn();
    console.log(`  ✅ ${testName}`);
  } catch (error) {
    failedTests++;
    console.log(`  ❌ ${testName}`);
    console.log(`     Error: ${error.message}`);
    failures.push({
      test: testName,
      error: error.message
    });
  }
}

// Helper functions
const createTiles = (type, numbers) => {
  return numbers.map((num, idx) => ({
    id: idx + 1,
    type,
    number: num,
    copy_no: 1
  }));
};

// ==================== WIN DETECTION TESTS ====================

function checkWinStructure(tiles) {
  const counts = {};
  tiles.forEach(tile => {
    const key = `${tile.type}_${tile.number}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  
  for (const pairKey in counts) {
    if (counts[pairKey] >= 2) {
      const testCounts = { ...counts };
      testCounts[pairKey] -= 2;
      
      if (canFormMelds(testCounts, 4)) {
        const isPure = checkPureHand(tiles, []);
        return {
          canWin: true,
          isPure,
          sets: [],
          pair: pairKey
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
  
  const firstKey = Object.keys(counts).find(k => counts[k] > 0);
  if (!firstKey) return false;
  
  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts[firstKey] += 3;
      return true;
    }
    counts[firstKey] += 3;
  }
  
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

// ==================== PAYOUT CALCULATION TESTS ====================

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
  const sorted = players.sort((a, b) => a.seat - b.seat);
  const currentIndex = sorted.findIndex(p => p.userId === currentUserId);
  if (currentIndex === -1) return null;
  
  const leftIndex = currentIndex === 0 ? sorted.length - 1 : currentIndex - 1;
  return sorted[leftIndex];
}

// ==================== RUN TESTS ====================

console.log('🎮 Loukkai Mahjong Unit Tests\n');
console.log('='.repeat(50));

// Test 1: Win Detection - Valid Structures
describe('Win Detection - Valid Structures', () => {
  
  it('should detect valid win: 4 Pongs + 1 Pair (Pure Dot)', () => {
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
  });
  
  it('should detect valid win: Mixed Pongs and Chows', () => {
    const tiles = [
      ...createTiles('dot', [1, 1, 1]),
      ...createTiles('dot', [2, 3, 4]),
      ...createTiles('bamboo', [5, 5, 5]),
      ...createTiles('bamboo', [6, 7, 8]),
      ...createTiles('dot', [9, 9])
    ];
    
    const result = checkWinStructure(tiles);
    
    expect(result.canWin).toBe(true);
    expect(result.isPure).toBe(false);
  });
  
  it('should reject invalid structure: only 3 sets', () => {
    const tiles = [
      ...createTiles('dot', [1, 1, 1]),
      ...createTiles('dot', [2, 2, 2]),
      ...createTiles('dot', [3, 3, 3]),
      ...createTiles('dot', [4, 4])
    ];
    
    const result = checkWinStructure(tiles);
    
    expect(result.canWin).toBe(false);
  });
});

// Test 2: Pure Hand Detection
describe('Pure Hand Detection', () => {
  
  it('should detect pure hand: all Dot tiles', () => {
    const tiles = createTiles('dot', [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5]);
    const isPure = checkPureHand(tiles, []);
    
    expect(isPure).toBe(true);
  });
  
  it('should detect mixed hand: Dot + Bamboo', () => {
    const tiles = [
      ...createTiles('dot', [1, 1, 1, 2, 2, 2]),
      ...createTiles('bamboo', [3, 3, 3, 4, 4, 4, 5, 5])
    ];
    const isPure = checkPureHand(tiles, []);
    
    expect(isPure).toBe(false);
  });
});

// Test 3: Payout Calculation - Self-Draw
describe('Payout Calculation - Self-Draw', () => {
  const players = [
    { userId: '1', name: 'Player 1', seat: 1 },
    { userId: '2', name: 'Player 2', seat: 2 },
    { userId: '3', name: 'Player 3', seat: 3 }
  ];
  
  it('should calculate self-draw payout: mixed hand', () => {
    const result = calculatePayout('1', 'self-draw', false, 0, players);
    
    expect(result.winnerId).toBe('1');
    expect(result.winType).toBe('self-draw');
    expect(result.isPure).toBe(false);
    expect(result.payouts[0].amount).toBe(1);
    expect(result.payouts[1].amount).toBe(1);
  });
  
  it('should calculate self-draw payout: pure hand', () => {
    const result = calculatePayout('2', 'self-draw', true, 0, players);
    
    expect(result.isPure).toBe(true);
    expect(result.payouts[0].amount).toBe(10);
    expect(result.payouts[1].amount).toBe(10);
  });
});

// Test 4: Payout Calculation - Left-Discard
describe('Payout Calculation - Left-Discard', () => {
  const players = [
    { userId: '1', name: 'Player 1', seat: 1 },
    { userId: '2', name: 'Player 2', seat: 2 },
    { userId: '3', name: 'Player 3', seat: 3 }
  ];
  
  it('should calculate left-discard payout: mixed hand', () => {
    const result = calculatePayout('2', 'left-discard', false, 0, players);
    
    expect(result.winType).toBe('left-discard');
    expect(result.leftPlayerId).toBeDefined();
    
    const leftPayout = result.payouts.find(p => p.payerId === result.leftPlayerId);
    expect(leftPayout.amount).toBe(2); // Left pays 2×
    
    const otherPayout = result.payouts.find(p => p.payerId !== result.leftPlayerId);
    expect(otherPayout.amount).toBe(1); // Others pay 1×
  });
  
  it('should calculate left-discard payout: pure hand', () => {
    const result = calculatePayout('3', 'left-discard', true, 0, players);
    
    const leftPayout = result.payouts.find(p => p.payerId === result.leftPlayerId);
    expect(leftPayout.amount).toBe(10); // Left pays 10×
    
    const otherPayout = result.payouts.find(p => p.payerId !== result.leftPlayerId);
    expect(otherPayout.amount).toBe(5); // Others pay 5×
  });
});

// Test 5: Payout Calculation - Shown-Tile
describe('Payout Calculation - Shown-Tile', () => {
  const players = [
    { userId: '1', name: 'Player 1', seat: 1 },
    { userId: '2', name: 'Player 2', seat: 2 },
    { userId: '3', name: 'Player 3', seat: 3 }
  ];
  
  it('should calculate shown-tile payout: mixed hand', () => {
    const result = calculatePayout('1', 'shown-tile', false, 0, players);
    
    expect(result.payouts[0].amount).toBe(3); // All pay 3×
    expect(result.payouts[1].amount).toBe(3);
  });
  
  it('should calculate shown-tile payout: pure, 1st consecutive (10×)', () => {
    const result = calculatePayout('2', 'shown-tile', true, 1, players);
    
    expect(result.consecutiveCount).toBe(1);
    expect(result.payouts[0].amount).toBe(10); // 10 × 2^0 = 10
    expect(result.payouts[1].amount).toBe(10);
  });
  
  it('should calculate shown-tile payout: pure, 2nd consecutive (20×)', () => {
    const result = calculatePayout('3', 'shown-tile', true, 2, players);
    
    expect(result.consecutiveCount).toBe(2);
    expect(result.payouts[0].amount).toBe(20); // 10 × 2^1 = 20
    expect(result.payouts[1].amount).toBe(20);
  });
  
  it('should calculate shown-tile payout: pure, 3rd consecutive (40×)', () => {
    const result = calculatePayout('1', 'shown-tile', true, 3, players);
    
    expect(result.consecutiveCount).toBe(3);
    expect(result.payouts[0].amount).toBe(40); // 10 × 2^2 = 40
    expect(result.payouts[1].amount).toBe(40);
  });
  
  it('should calculate shown-tile payout: pure, 4th consecutive (80×)', () => {
    const result = calculatePayout('2', 'shown-tile', true, 4, players);
    
    expect(result.consecutiveCount).toBe(4);
    expect(result.payouts[0].amount).toBe(80); // 10 × 2^3 = 80
    expect(result.payouts[1].amount).toBe(80);
  });
});

// Test 6: Left Player Identification
describe('Left Player Identification (Anti-Clockwise)', () => {
  const players = [
    { userId: '1', name: 'Player 1', seat: 1 },
    { userId: '2', name: 'Player 2', seat: 2 },
    { userId: '3', name: 'Player 3', seat: 3 }
  ];
  
  it('should identify left player: Player 2 -> Player 1', () => {
    const leftPlayer = getLeftPlayer('2', players);
    expect(leftPlayer.userId).toBe('1');
  });
  
  it('should identify left player: Player 3 -> Player 2', () => {
    const leftPlayer = getLeftPlayer('3', players);
    expect(leftPlayer.userId).toBe('2');
  });
  
  it('should identify left player: Player 1 -> Player 3 (wrap around)', () => {
    const leftPlayer = getLeftPlayer('1', players);
    expect(leftPlayer.userId).toBe('3');
  });
});

// ==================== SUMMARY ====================

console.log('\n' + '='.repeat(50));
console.log('\n📊 Test Summary:');
console.log(`   Total Tests: ${totalTests}`);
console.log(`   ✅ Passed: ${passedTests}`);
console.log(`   ❌ Failed: ${failedTests}`);

if (failedTests > 0) {
  console.log('\n❌ Failed Tests:');
  failures.forEach((failure, idx) => {
    console.log(`\n${idx + 1}. ${failure.test || 'Assertion'}`);
    console.log(`   ${failure.message || failure.error}`);
  });
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}
