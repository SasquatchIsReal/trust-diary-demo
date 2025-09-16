#!/bin/bash

echo "🔐 Testing Encrypted P2P Trust Diary"
echo "===================================="

# Step 1: Start the encrypted service
echo "1️⃣ Starting encrypted service..."
cd go-nostr-service
./trust-diary-encrypted &
SERVICE_PID=$!
echo "Service PID: $SERVICE_PID"

# Wait for service to start and get its keys
sleep 3

# Step 2: Get service keys from the output or identity file
echo -e "\n2️⃣ Service Identity:"
if [ -f "./diary-data/identity.json" ]; then
    echo "Service Box Public Key:"
    cat ./diary-data/identity.json | grep box_public_key | cut -d'"' -f4
    echo ""
fi

# The service Nostr pubkey is hardcoded for now
SERVICE_NOSTR_PUBKEY="57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da"

echo "Service Nostr Public Key: $SERVICE_NOSTR_PUBKEY"
echo ""

echo "3️⃣ To test manually:"
echo "   1. Open: https://sasquatchisreal.github.io/trust-diary-demo/nostr-encrypted-client.html"
echo "   2. Enter Service Nostr Key: $SERVICE_NOSTR_PUBKEY"
echo "   3. Enter Service Box Key from above"
echo "   4. Click 'Find Encrypted Offers'"
echo ""

echo "4️⃣ To test with Playwright:"
echo "   npx playwright test tests/encrypted-p2p.spec.ts"
echo ""

echo "Service is running. Press Ctrl+C to stop."

# Wait for Ctrl+C
trap "echo 'Stopping service...'; kill $SERVICE_PID 2>/dev/null; exit" INT
wait $SERVICE_PID