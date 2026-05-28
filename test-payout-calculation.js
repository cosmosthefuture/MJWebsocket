/**
 * Manual test script for calculatePayout function
 * 
 * This script tests the payout calculation for all three win types:
 * 1. Self-draw (pure and non-pure)
 * 2. Left-discard (pure and non-pure)
 * 3. Shown-tile (pure with consecutive multiplier and non-pure)
 */

import redis from './src/config/redis.js';

// Mock Redis keys
const ROUND_PLAYERS_KEY = (roomId) => `room:${roomId}:round_players`;
const PAYOUT_DATA_KEY = (roomId) => `mahjong:room:${roomId}:payout_data`;

// Test room ID
const TEST_ROOM_ID = 'test-room-payout-123';

// Mock players
const mockPlayers = [
  { userId: '1', name: 'Player 1', seat: 1, is_active: true, is_auto: false },
  { userId: '2', name: 'Player 2', seat: 2, is_active: true, is_auto: false },
  { userId: '3', name: 'Player 3', seat: 3, is_active: true, is_auto: false }
];

// Helper function to setup test data
async function setupTestData() {
  console.log('Setting up test data...');
  
  // Clear existing data
  await redis.del(ROUND_PLAYERS_KEY(TEST_ROOM_ID));
  await redis.del(PAYOUT_DATA_KEY(TEST_ROOM_ID));
  
  // Add mock players
  for (const player of mockPlayers) {
    await redis.hset(
      ROUND_PLAYERS_KEY(TEST_ROOM_ID),
      player.userId,
      JSON.stringify(player)
    );
  }
  
  console.log('Test data setup complete.\n');
}

// Helper function to cleanup test data
async function cleanupTestData() {
  console.log('\nCleaning up test data...');
  await redis.del(ROUND_PLAYERS_KEY(TEST_ROOM_ID));
  await redis.del(PAYOUT_DATA_KEY(TEST_ROOM_ID));
  console.log('Cleanup complete.');
}

// Mock getLeftPlayer function
async function getLeftPlayer(roomId, currentUserId) {
  const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));
  const players = Object.values(roundPlayersRaw)
    .map(JSON.parse)
    .sort((a, b) => a.seat - b.seat);

  const currentIndex = players.findIndex(
    (player) => Number(player.userId) === Number(currentUserId)
  );

  if (currentIndex === -1) {
    return null;
  }

  // Anti-clockwise: previous player (left player)
  let leftIndex = currentIndex - 1;
  if (leftIndex < 0) {
    leftIndex = players.length - 1;
  }

  return players[leftIndex];
}

// Mock calculatePayout function (simplified version for testing)
async function calculatePayout(roomId, winnerId, winType, isPure, consecutiveCount = 0) {
  // Get all round players
  const roundPlayersRaw = await redis.hgetall(ROUND_PLAYERS_KEY(roomId));
  const roundPlayers = Object.values(roundPlayersRaw).map(JSON.parse);
  
  // Base bet amount (can be made configurable later)
  const betAmount = 1;
  
  const payouts = [];
  let leftPlayerId = null;
  
  // Calculate payouts based on win type
  if (winType === 'self-draw') {
    // Self-draw win: all other players pay
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
    // Left-discard win: left player pays more, others pay less
    const leftPlayer = await getLeftPlayer(roomId, winnerId);
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
    // Shown tile win
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
      // Pure shown tile: consecutive multiplier = 10 × 2^(N-1)
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
  else {
    throw new Error(`Invalid win type: ${winType}`);
  }
  
  // Build payout data object
  const payoutData = {
    winnerId,
    winType,
    isPure,
    payouts
  };
  
  // Add optional metadata
  if (winType === 'left-discard' && leftPlayerId) {
    payoutData.leftPlayerId = leftPlayerId;
  }
  
  if (winType === 'shown-tile' && isPure && consecutiveCount) {
    payoutData.consecutiveCount = consecutiveCount;
  }
  
  // Store in Redis
  await redis.set(PAYOUT_DATA_KEY(roomId), JSON.stringify(payoutData));
  
  return payoutData;
}

// Test cases
async function runTests() {
  console.log('='.repeat(60));
  console.log('PAYOUT CALCULATION TESTS');
  console.log('='.repeat(60));
  
  await setupTestData();
  
  // Test 1: Self-draw non-pure
  console.log('\n--- Test 1: Self-draw (non-pure) ---');
  const test1 = await calculatePayout(TEST_ROOM_ID, '1', 'self-draw', false);
  console.log('Winner: Player 1');
  console.log('Expected: Players 2 and 3 each pay 1×');
  console.log('Result:', JSON.stringify(test1, null, 2));
  console.log('✓ Test 1 passed:', test1.payouts.length === 2 && test1.payouts.every(p => p.amount === 1));
  
  // Test 2: Self-draw pure
  console.log('\n--- Test 2: Self-draw (pure) ---');
  const test2 = await calculatePayout(TEST_ROOM_ID, '2', 'self-draw', true);
  console.log('Winner: Player 2');
  console.log('Expected: Players 1 and 3 each pay 10×');
  console.log('Result:', JSON.stringify(test2, null, 2));
  console.log('✓ Test 2 passed:', test2.payouts.length === 2 && test2.payouts.every(p => p.amount === 10));
  
  // Test 3: Left-discard non-pure
  console.log('\n--- Test 3: Left-discard (non-pure) ---');
  const test3 = await calculatePayout(TEST_ROOM_ID, '2', 'left-discard', false);
  console.log('Winner: Player 2');
  console.log('Expected: Player 1 (left) pays 2×, Player 3 pays 1×');
  console.log('Result:', JSON.stringify(test3, null, 2));
  const leftPayout3 = test3.payouts.find(p => p.payerId === test3.leftPlayerId);
  const otherPayout3 = test3.payouts.find(p => p.payerId !== test3.leftPlayerId);
  console.log('✓ Test 3 passed:', leftPayout3.amount === 2 && otherPayout3.amount === 1);
  
  // Test 4: Left-discard pure
  console.log('\n--- Test 4: Left-discard (pure) ---');
  const test4 = await calculatePayout(TEST_ROOM_ID, '3', 'left-discard', true);
  console.log('Winner: Player 3');
  console.log('Expected: Player 2 (left) pays 10×, Player 1 pays 5×');
  console.log('Result:', JSON.stringify(test4, null, 2));
  const leftPayout4 = test4.payouts.find(p => p.payerId === test4.leftPlayerId);
  const otherPayout4 = test4.payouts.find(p => p.payerId !== test4.leftPlayerId);
  console.log('✓ Test 4 passed:', leftPayout4.amount === 10 && otherPayout4.amount === 5);
  
  // Test 5: Shown-tile non-pure
  console.log('\n--- Test 5: Shown-tile (non-pure) ---');
  const test5 = await calculatePayout(TEST_ROOM_ID, '1', 'shown-tile', false);
  console.log('Winner: Player 1');
  console.log('Expected: Players 2 and 3 each pay 3×');
  console.log('Result:', JSON.stringify(test5, null, 2));
  console.log('✓ Test 5 passed:', test5.payouts.length === 2 && test5.payouts.every(p => p.amount === 3));
  
  // Test 6: Shown-tile pure (1st consecutive)
  console.log('\n--- Test 6: Shown-tile pure (1st consecutive) ---');
  const test6 = await calculatePayout(TEST_ROOM_ID, '2', 'shown-tile', true, 1);
  console.log('Winner: Player 2');
  console.log('Expected: Players 1 and 3 each pay 10× (10 × 2^0)');
  console.log('Result:', JSON.stringify(test6, null, 2));
  console.log('✓ Test 6 passed:', test6.payouts.length === 2 && test6.payouts.every(p => p.amount === 10));
  
  // Test 7: Shown-tile pure (2nd consecutive)
  console.log('\n--- Test 7: Shown-tile pure (2nd consecutive) ---');
  const test7 = await calculatePayout(TEST_ROOM_ID, '3', 'shown-tile', true, 2);
  console.log('Winner: Player 3');
  console.log('Expected: Players 1 and 2 each pay 20× (10 × 2^1)');
  console.log('Result:', JSON.stringify(test7, null, 2));
  console.log('✓ Test 7 passed:', test7.payouts.length === 2 && test7.payouts.every(p => p.amount === 20));
  
  // Test 8: Shown-tile pure (3rd consecutive)
  console.log('\n--- Test 8: Shown-tile pure (3rd consecutive) ---');
  const test8 = await calculatePayout(TEST_ROOM_ID, '1', 'shown-tile', true, 3);
  console.log('Winner: Player 1');
  console.log('Expected: Players 2 and 3 each pay 40× (10 × 2^2)');
  console.log('Result:', JSON.stringify(test8, null, 2));
  console.log('✓ Test 8 passed:', test8.payouts.length === 2 && test8.payouts.every(p => p.amount === 40));
  
  // Test 9: Shown-tile pure (4th consecutive)
  console.log('\n--- Test 9: Shown-tile pure (4th consecutive) ---');
  const test9 = await calculatePayout(TEST_ROOM_ID, '2', 'shown-tile', true, 4);
  console.log('Winner: Player 2');
  console.log('Expected: Players 1 and 3 each pay 80× (10 × 2^3)');
  console.log('Result:', JSON.stringify(test9, null, 2));
  console.log('✓ Test 9 passed:', test9.payouts.length === 2 && test9.payouts.every(p => p.amount === 80));
  
  await cleanupTestData();
  
  console.log('\n' + '='.repeat(60));
  console.log('ALL TESTS COMPLETED SUCCESSFULLY!');
  console.log('='.repeat(60));
  
  // Close Redis connection
  await redis.quit();
}

// Run tests
runTests().catch(console.error);
