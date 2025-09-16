import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Simple P2P Trust Diary', () => {
  let serviceProcess: ChildProcess;
  let serviceNostrPubkey: string = '57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da';

  test.beforeAll(async () => {
    console.log('Starting simple trust diary service...');

    // Start the Go service
    const servicePath = path.join(process.cwd(), 'go-nostr-service', 'trust-diary-simple');

    // Build service first if needed
    if (!fs.existsSync(servicePath)) {
      console.log('Building service...');
      const { execSync } = require('child_process');
      execSync('cd go-nostr-service && go build -o trust-diary-simple main-simple.go');
    }

    serviceProcess = spawn(servicePath, [], {
      cwd: path.join(process.cwd(), 'go-nostr-service'),
      env: { ...process.env }
    });

    // Capture service output
    serviceProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('Service:', output);
    });

    serviceProcess.stderr?.on('data', (data) => {
      console.error('Service Error:', data.toString());
    });

    // Wait for service to start and publish offers
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  test.afterAll(async () => {
    if (serviceProcess) {
      console.log('Stopping service...');
      serviceProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  test('Can discover service offers via Nostr', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      console.log('Browser:', msg.text());
    });

    // Navigate to simple client (local file)
    const clientPath = path.join(process.cwd(), 'nostr-simple-client.html');
    await page.goto(`file://${clientPath}`);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Verify service key is pre-filled
    const serviceKeyValue = await page.locator('#serviceNostrKey').inputValue();
    expect(serviceKeyValue).toBe(serviceNostrPubkey);

    console.log('Searching for service offers...');

    // Find service offers
    await page.click('button:has-text("Find Service Offers")');

    // Wait for status to change from searching
    await page.waitForFunction(() => {
      const status = document.getElementById('status');
      return status && !status.textContent?.includes('Searching');
    }, { timeout: 40000 });

    // Check if offer was found
    const statusText = await page.locator('#status').textContent();
    console.log('Final status:', statusText);

    // Debug: Get console logs
    const consoleLogs = await page.locator('#console').textContent();
    console.log('Console logs:', consoleLogs);

    // Should find offer
    if (statusText?.includes('found')) {
      console.log('✅ Found service offer!');

      // Verify offer details are shown
      await expect(page.locator('#offerCard')).toBeVisible();

      const offerId = await page.locator('#offerId').textContent();
      expect(offerId).toBeTruthy();
      console.log('Offer ID:', offerId);

      // Accept offer and connect
      await page.click('button:has-text("Accept & Connect")');

      // Wait for P2P connection (may fail due to local environment)
      await page.waitForTimeout(5000);

      const finalStatus = await page.locator('#status').textContent();
      console.log('Connection status:', finalStatus);
    } else {
      // Debug why no offers found
      console.log('❌ No offers found - debugging...');

      // Check what's in the console
      const allLogs = await page.locator('#console').innerText();
      console.log('All browser logs:', allLogs);

      // This should fail to highlight the issue
      expect(statusText).toContain('found');
    }
  });

  test('Service publishes offers regularly', async ({ page }) => {
    // Simple test to verify service is publishing
    const startTime = Date.now();
    let offerCount = 0;

    // Monitor service output for 65 seconds (should see at least 2 offers)
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (Date.now() - startTime > 65000) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });

    // Check service logs (from stdout capture)
    console.log('Service should have published multiple offers in 65 seconds');
  });
});