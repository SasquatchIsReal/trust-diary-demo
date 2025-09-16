import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Encrypted P2P Trust Diary', () => {
  let serviceProcess: ChildProcess;
  let serviceNostrPubkey: string;
  let serviceBoxPubkey: string;

  test.beforeAll(async () => {
    console.log('Starting encrypted trust diary service...');

    // Start the Go service
    const servicePath = path.join(process.cwd(), 'go-nostr-service', 'trust-diary-encrypted');

    // Build service first if needed
    if (!fs.existsSync(servicePath)) {
      console.log('Building service...');
      const { execSync } = require('child_process');
      execSync('cd go-nostr-service && go build -o trust-diary-encrypted main-encrypted.go');
    }

    serviceProcess = spawn(servicePath, [], {
      cwd: path.join(process.cwd(), 'go-nostr-service'),
      env: { ...process.env }
    });

    // Capture service output to get keys
    serviceProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('Service:', output);

      // Extract Nostr pubkey
      const nostrMatch = output.match(/Service Nostr pubkey: ([a-f0-9]{64})/);
      if (nostrMatch) {
        serviceNostrPubkey = nostrMatch[1];
        console.log('Found service Nostr pubkey:', serviceNostrPubkey);
      }

      // Extract Box pubkey
      const boxMatch = output.match(/Service Box pubkey: ([A-Za-z0-9+/=]+)/);
      if (boxMatch) {
        serviceBoxPubkey = boxMatch[1];
        console.log('Found service Box pubkey:', serviceBoxPubkey);
      }
    });

    serviceProcess.stderr?.on('data', (data) => {
      console.error('Service Error:', data.toString());
    });

    // Wait for service to start and publish offers
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Read identity file to get box key if not captured from output
    const identityPath = path.join(process.cwd(), 'go-nostr-service', 'diary-data', 'identity.json');
    if (fs.existsSync(identityPath)) {
      const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      serviceBoxPubkey = identity.box_public_key;
      console.log('Service Box pubkey from file:', serviceBoxPubkey);
    }

    // Default known service key for testing
    serviceNostrPubkey = serviceNostrPubkey || '57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da';
  });

  test.afterAll(async () => {
    if (serviceProcess) {
      console.log('Stopping service...');
      serviceProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  test('Can establish encrypted P2P connection via Nostr', async ({ page }) => {
    // Navigate to encrypted client
    await page.goto('https://sasquatchisreal.github.io/trust-diary-demo/nostr-encrypted-client.html');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Generate new identity
    await page.click('button:has-text("Generate New Identity")');
    console.log('Generated new client identity');

    // Get client's Nostr pubkey for logging
    const clientNostrKey = await page.locator('#nostrPubKey').textContent();
    console.log('Client Nostr pubkey:', clientNostrKey);

    // Enter service keys
    await page.fill('#serviceNostrKey', serviceNostrPubkey);
    if (serviceBoxPubkey) {
      await page.fill('#serviceBoxKey', serviceBoxPubkey);
    }

    console.log('Searching for encrypted offers...');

    // Find encrypted offers
    await page.click('button:has-text("Find Encrypted Offers")');

    // Wait for offer to be found (may take up to 30s for service to publish)
    await expect(page.locator('#status')).toContainText('found', { timeout: 40000 });

    console.log('Found encrypted offer!');

    // Check that offer was decrypted
    const offerId = await page.locator('#offerId').textContent();
    expect(offerId).toBeTruthy();
    console.log('Decrypted offer ID:', offerId);

    // Accept offer and connect
    await page.click('button:has-text("Accept & Connect")');

    // Wait for P2P connection
    await expect(page.locator('#status')).toContainText('Connected', { timeout: 30000 });

    console.log('✅ Established encrypted P2P connection!');

    // Verify encryption indicators
    await expect(page.locator('.encryption-indicator')).toContainText('end-to-end encrypted');

    // Check console logs for encryption messages
    const consoleLogs = await page.locator('#console').textContent();
    expect(consoleLogs).toContain('Decrypt');
    expect(consoleLogs).toContain('Encrypt');
    expect(consoleLogs).toContain('NaCl Box');

    // Take screenshot of successful connection
    await page.screenshot({
      path: 'test-results/encrypted-p2p-connected.png',
      fullPage: true
    });

    console.log('✅ All encryption verified!');
  });

  test('Rejects offers not encrypted for client', async ({ page }) => {
    // Generate a different identity
    await page.goto('https://sasquatchisreal.github.io/trust-diary-demo/nostr-encrypted-client.html');
    await page.waitForLoadState('networkidle');

    // Use wrong service box key (should fail to decrypt)
    await page.fill('#serviceNostrKey', serviceNostrPubkey);
    await page.fill('#serviceBoxKey', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');

    await page.click('button:has-text("Find Encrypted Offers")');

    // Should timeout or show decryption error
    await page.waitForTimeout(5000);

    const consoleLogs = await page.locator('#console').textContent();
    const hasError = consoleLogs?.includes('Decrypt') &&
                     (consoleLogs.includes('failed') || consoleLogs.includes('error'));

    expect(hasError || consoleLogs?.includes('Timeout')).toBeTruthy();

    console.log('✅ Correctly rejected offer with wrong keys');
  });
});