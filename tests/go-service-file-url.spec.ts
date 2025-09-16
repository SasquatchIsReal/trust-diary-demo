import { test, expect, Page } from '@playwright/test';
import path from 'path';

test.describe('Go Service with file:// URL Client', () => {
  let page: Page;

  test('Browser client loads from file:// URL and generates identity', async ({ browser }) => {
    // Create a new page
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write']
    });
    page = await context.newPage();

    // Load the HTML file directly as file:// URL
    const filePath = path.join(process.cwd(), 'client', 'go-service-reader.html');
    const fileUrl = `file://${filePath}`;

    console.log('Loading from file:// URL:', fileUrl);
    await page.goto(fileUrl);

    // Verify the page loaded
    await expect(page.locator('h1')).toContainText('Trust Diary - Go Service Reader');

    // Check that it recognizes it's running from file://
    await page.waitForSelector('.log:has-text("This file is running from: file:")', { timeout: 5000 });

    // Verify identity generation
    await page.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    const publicKey = await page.locator('#publicKey').textContent();
    const boxPublicKey = await page.locator('#boxPublicKey').textContent();

    expect(publicKey).toBeTruthy();
    expect(boxPublicKey).toBeTruthy();
    expect(publicKey!.length).toBeGreaterThan(40);

    console.log('✅ Client loaded from file:// URL successfully');
    console.log('✅ Generated identity:', publicKey!.substring(0, 32) + '...');
  });

  test('Can connect to Go service via WebRTC', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write']
    });
    page = await context.newPage();

    // Load from file://
    const filePath = path.join(process.cwd(), 'client', 'go-service-reader.html');
    await page.goto(`file://${filePath}`);

    // Wait for identity
    await page.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    // Get the reader's keys for trusting
    const readerPublicKey = await page.locator('#publicKey').textContent();
    const readerBoxPublicKey = await page.locator('#boxPublicKey').textContent();

    console.log('Reader public key:', readerPublicKey!.substring(0, 32) + '...');

    // First, add this reader as trusted via the API
    const trustResponse = await fetch('http://localhost:3333/api/trusted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: readerPublicKey,
        boxPublicKey: readerBoxPublicKey,
        name: 'Test Reader',
        permissions: ['read']
      })
    });

    expect(trustResponse.ok).toBeTruthy();
    console.log('✅ Reader added as trusted user');

    // Try to connect
    await page.fill('#serviceURL', 'http://localhost:3333');
    await page.click('button:has-text("Connect via WebRTC")');

    // Wait for WebSocket connection
    await page.waitForSelector('.log:has-text("WebSocket connected")', { timeout: 10000 });

    // Wait for WebRTC connection
    await page.waitForSelector('#rtcState:has-text("connected")', { timeout: 15000 });

    // Check if authenticated
    await page.waitForSelector('#authStatus:has-text("Authenticated")', { timeout: 10000 });

    console.log('✅ Successfully connected and authenticated via WebRTC');

    // Verify we received entries
    await page.waitForSelector('.entry', { timeout: 5000 });

    const entries = await page.locator('.entry').count();
    expect(entries).toBeGreaterThan(0);

    console.log(`✅ Received ${entries} entries from service`);
  });

  test('Multiple file:// clients can connect simultaneously', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write']
    });

    // Load two clients from file://
    const filePath = path.join(process.cwd(), 'client', 'go-service-reader.html');
    const fileUrl = `file://${filePath}`;

    const page1 = await context.newPage();
    await page1.goto(fileUrl);

    const page2 = await context.newPage();
    await page2.goto(fileUrl);

    // Wait for both to generate identities
    await page1.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    });

    await page2.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    });

    // Get keys from both
    const reader1PublicKey = await page1.locator('#publicKey').textContent();
    const reader1BoxPublicKey = await page1.locator('#boxPublicKey').textContent();

    const reader2PublicKey = await page2.locator('#publicKey').textContent();
    const reader2BoxPublicKey = await page2.locator('#boxPublicKey').textContent();

    // Trust both readers
    await fetch('http://localhost:3333/api/trusted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: reader1PublicKey,
        boxPublicKey: reader1BoxPublicKey,
        name: 'Reader 1',
        permissions: ['read']
      })
    });

    await fetch('http://localhost:3333/api/trusted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: reader2PublicKey,
        boxPublicKey: reader2BoxPublicKey,
        name: 'Reader 2',
        permissions: ['read']
      })
    });

    // Connect both
    await page1.fill('#serviceURL', 'http://localhost:3333');
    await page1.click('button:has-text("Connect via WebRTC")');

    await page2.fill('#serviceURL', 'http://localhost:3333');
    await page2.click('button:has-text("Connect via WebRTC")');

    // Wait for both to authenticate
    await page1.waitForSelector('#authStatus:has-text("Authenticated")', { timeout: 15000 });
    await page2.waitForSelector('#authStatus:has-text("Authenticated")', { timeout: 15000 });

    console.log('✅ Both file:// clients connected and authenticated');

    // Add a new entry via API
    const entryResponse = await fetch('http://localhost:3333/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `Test entry at ${new Date().toISOString()}`
      })
    });

    expect(entryResponse.ok).toBeTruthy();

    // Both should receive the new entry
    await page1.waitForSelector('.entry:has-text("Test entry at")', { timeout: 5000 });
    await page2.waitForSelector('.entry:has-text("Test entry at")', { timeout: 5000 });

    console.log('✅ Real-time sync working for multiple file:// clients');

    await page1.close();
    await page2.close();
  });

  test('file:// client works from different directory', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Copy the HTML file to a temp location to simulate USB stick / different location
    const fs = await import('fs');
    const os = await import('os');
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, 'trust-diary-reader.html');

    const originalFile = path.join(process.cwd(), 'client', 'go-service-reader.html');
    fs.copyFileSync(originalFile, tempFile);

    console.log('Copied file to temp location:', tempFile);

    // Load from temp location
    await page.goto(`file://${tempFile}`);

    // Verify it loads and generates identity
    await expect(page.locator('h1')).toContainText('Trust Diary - Go Service Reader');

    await page.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    console.log('✅ HTML file works from any location (simulating USB stick)');

    // Clean up
    fs.unlinkSync(tempFile);
    await page.close();
  });
});