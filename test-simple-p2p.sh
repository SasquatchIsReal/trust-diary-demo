#!/bin/bash

echo "🔍 Testing Simple P2P Trust Diary (No Box Encryption)"
echo "===================================================="

# Step 1: Build and start the simple service
echo "1️⃣ Building and starting simple service..."
cd go-nostr-service

# Build the simple version
go build -o trust-diary-simple main-simple.go
if [ $? -ne 0 ]; then
    echo "❌ Failed to build service"
    exit 1
fi

./trust-diary-simple &
SERVICE_PID=$!
echo "Service PID: $SERVICE_PID"

# Wait for service to start
sleep 3

# Step 2: Get service key
SERVICE_NOSTR_PUBKEY="57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da"

echo -e "\n2️⃣ Service Nostr Public Key: $SERVICE_NOSTR_PUBKEY"
echo ""

echo "3️⃣ To test manually:"
echo "   1. Open: https://sasquatchisreal.github.io/trust-diary-demo/nostr-simple-client.html"
echo "   2. Enter Service Nostr Key: $SERVICE_NOSTR_PUBKEY"
echo "   3. Click 'Find Service Offers'"
echo "   4. Click 'Accept & Connect' when offer appears"
echo ""

echo "Service is running. Press Ctrl+C to stop."

# Wait for Ctrl+C
trap "echo 'Stopping service...'; kill $SERVICE_PID 2>/dev/null; exit" INT
wait $SERVICE_PID