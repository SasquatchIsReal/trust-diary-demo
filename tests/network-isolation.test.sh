#!/bin/bash

# Network Isolation Test Script
# Tests that peers can only communicate via WebTorrent, not directly

set -e

echo "🔧 Setting up network isolation test..."

# Function to check if containers can ping each other
check_direct_connectivity() {
    echo "Testing direct connectivity between containers..."

    # Try to ping Bob from Tom's isolated network
    docker exec tom-peer ping -c 1 -W 1 172.21.0.2 2>/dev/null && {
        echo "❌ FAIL: Tom can directly reach Bob's network!"
        return 1
    } || echo "✅ PASS: Tom cannot directly reach Bob's network"

    # Try to ping Tom from Bob's isolated network
    docker exec bob-peer ping -c 1 -W 1 172.20.0.2 2>/dev/null && {
        echo "❌ FAIL: Bob can directly reach Tom's network!"
        return 1
    } || echo "✅ PASS: Bob cannot directly reach Tom's network"

    return 0
}

# Function to test WebTorrent connectivity
test_webtorrent_connectivity() {
    echo "Testing WebTorrent connectivity..."

    # Check if both can reach internet (WebTorrent trackers)
    docker exec tom-peer curl -s -o /dev/null -w "%{http_code}" https://webtorrent.io > /dev/null 2>&1 && {
        echo "✅ PASS: Tom can reach internet"
    } || echo "⚠️  WARN: Tom cannot reach internet"

    docker exec bob-peer curl -s -o /dev/null -w "%{http_code}" https://webtorrent.io > /dev/null 2>&1 && {
        echo "✅ PASS: Bob can reach internet"
    } || echo "⚠️  WARN: Bob cannot reach internet"
}

# Start containers
echo "Starting test containers..."
docker-compose -f docker-compose.test.yml up -d tom-peer bob-peer

# Wait for containers to be ready
sleep 5

# Run tests
echo "Running network isolation tests..."
check_direct_connectivity
test_webtorrent_connectivity

# Run Playwright tests
echo "Running P2P functionality tests..."
docker-compose -f docker-compose.test.yml run test-runner

# Cleanup
echo "Cleaning up..."
docker-compose -f docker-compose.test.yml down

echo "✅ All tests completed!"