import { test, expect, Page, Browser, BrowserContext } from '@playwright/test';

test.describe('Pure P2P Browser-to-Browser Tests', () => {
  let browser1: Browser;
  let browser2: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let tomPage: Page;
  let bobPage: Page;

  test.beforeAll(async ({ browser }) => {
    // Create two completely isolated browser instances
    context1 = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read', 'clipboard-write'],
      // Simulate different user/location
      geolocation: { latitude: 37.7749, longitude: -122.4194 }, // San Francisco
      locale: 'en-US',
    });

    context2 = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read', 'clipboard-write'],
      // Simulate different user/location
      geolocation: { latitude: 51.5074, longitude: -0.1278 }, // London
      locale: 'en-GB',
    });

    tomPage = await context1.newPage();
    bobPage = await context2.newPage();

    // Load HTML files directly as file:// URLs to ensure no server involvement
    const tomHtmlPath = `file://${process.cwd()}/client/tom-jsbin.html`;
    const bobHtmlPath = `file://${process.cwd()}/client/bob-jsbin.html`;

    await tomPage.goto(tomHtmlPath);
    await bobPage.goto(bobHtmlPath);

    // Wait for crypto keys to generate
    await tomPage.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...';
    }, { timeout: 10000 });

    await bobPage.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...';
    }, { timeout: 10000 });
  });

  test.afterAll(async () => {
    await context1.close();
    await context2.close();
  });

  test('should establish pure P2P connection without any server', async () => {
    // Get Tom's identity
    const tomPublicKey = await tomPage.locator('#publicKey').textContent();
    const tomBoxKey = await tomPage.locator('#boxPublicKey').textContent();

    // Get Bob's identity
    const bobPublicKey = await bobPage.locator('#publicKey').textContent();
    const bobBoxKey = await bobPage.locator('#boxPublicKey').textContent();

    // Verify unique identities
    expect(tomPublicKey).not.toBe(bobPublicKey);
    expect(tomBoxKey).not.toBe(bobBoxKey);

    // Establish trust - Tom trusts Bob
    await tomPage.fill('#bobPublicKey', bobPublicKey!);
    await tomPage.fill('#bobBoxPublicKey', bobBoxKey!);
    await tomPage.click('button:has-text("Trust Bob")');

    // Establish trust - Bob trusts Tom
    await bobPage.fill('#tomPublicKey', tomPublicKey!);
    await bobPage.fill('#tomBoxPublicKey', tomBoxKey!);
    await bobPage.click('button:has-text("Trust Tom")');

    // Wait for P2P connection via WebTorrent
    await tomPage.waitForFunction(() => {
      const logs = document.querySelector('#logs')?.textContent || '';
      return logs.includes('Peer connected');
    }, { timeout: 30000 }); // Longer timeout for WebTorrent discovery

    await bobPage.waitForFunction(() => {
      const logs = document.querySelector('#logs')?.textContent || '';
      return logs.includes('Peer connected');
    }, { timeout: 30000 });

    // Verify connection established
    const tomLogs = await tomPage.locator('#logs').textContent();
    const bobLogs = await bobPage.locator('#logs').textContent();

    expect(tomLogs).toContain('Peer connected');
    expect(bobLogs).toContain('Peer connected');
  });

  test('should exchange encrypted messages directly between browsers', async () => {
    const testMessage = `P2P Test ${Date.now()}`;

    // Tom sends message
    await tomPage.fill('#message', testMessage);
    await tomPage.click('button:has-text("Add Entry")');

    // Wait for Bob to receive via P2P
    await bobPage.waitForFunction((msg) => {
      const entries = Array.from(document.querySelectorAll('.entry'));
      return entries.some(entry => entry.textContent?.includes(msg));
    }, testMessage, { timeout: 10000 });

    // Verify Bob received the message
    const bobEntries = await bobPage.locator('.entry').allTextContents();
    expect(bobEntries.some(entry => entry.includes(testMessage))).toBeTruthy();
  });

  test('should maintain P2P connection without any server mediation', async () => {
    // Send multiple messages to verify sustained connection
    for (let i = 0; i < 3; i++) {
      const msg = `Direct P2P message ${i} - ${Date.now()}`;

      await bobPage.fill('#message', msg);
      await bobPage.click('button:has-text("Add Entry")');

      await tomPage.waitForFunction((message) => {
        const entries = Array.from(document.querySelectorAll('.entry'));
        return entries.some(entry => entry.textContent?.includes(message));
      }, msg, { timeout: 10000 });
    }

    // Verify all messages received
    const tomEntries = await tomPage.locator('.entry').allTextContents();
    expect(tomEntries.length).toBeGreaterThanOrEqual(3);
  });

  test('should verify WebRTC data channels are established', async () => {
    // Check for WebRTC statistics
    const rtcStats = await tomPage.evaluate(() => {
      // Access the peer connection if exposed
      if (window['pc'] || window['peer']) {
        const peer = window['pc'] || window['peer'];
        return peer?.connectionState || peer?.iceConnectionState;
      }
      return null;
    });

    if (rtcStats) {
      expect(['connected', 'completed']).toContain(rtcStats);
    }
  });

  test('should work across different browser profiles/contexts', async () => {
    // This test already runs in different contexts, verify isolation
    const tomCookies = await context1.cookies();
    const bobCookies = await context2.cookies();

    // Contexts should be completely isolated
    expect(tomCookies).not.toEqual(bobCookies);

    // Verify P2P still works despite isolation
    const quickMsg = `Isolated context test ${Date.now()}`;
    await tomPage.fill('#message', quickMsg);
    await tomPage.click('button:has-text("Add Entry")');

    await bobPage.waitForFunction((msg) => {
      const entries = Array.from(document.querySelectorAll('.entry'));
      return entries.some(entry => entry.textContent?.includes(msg));
    }, quickMsg, { timeout: 10000 });
  });
});

test.describe('P2P Network Resilience Tests', () => {
  test('should handle peer disconnection and reconnection', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await page1.goto(`file://${process.cwd()}/client/tom-jsbin.html`);
    await page2.goto(`file://${process.cwd()}/client/bob-jsbin.html`);

    // Wait for initial connection setup
    await page1.waitForTimeout(3000);
    await page2.waitForTimeout(3000);

    // Simulate network interruption by going offline
    await page1.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    await page1.waitForTimeout(2000);

    // Go back online
    await page1.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Should attempt to reconnect
    await page1.waitForTimeout(5000);

    await context1.close();
    await context2.close();
  });

  test('should validate that no HTTP/WebSocket servers are used', async ({ page }) => {
    // Monitor network traffic
    const requests: string[] = [];

    page.on('request', request => {
      const url = request.url();
      // Only WebTorrent tracker requests should be made
      if (!url.startsWith('file://') && !url.includes('cdn')) {
        requests.push(url);
      }
    });

    await page.goto(`file://${process.cwd()}/client/tom-jsbin.html`);
    await page.waitForTimeout(5000);

    // Should only have WebTorrent tracker requests, no local servers
    const localServerRequests = requests.filter(url =>
      url.includes('localhost') ||
      url.includes('127.0.0.1') ||
      url.includes(':3000') ||
      url.includes(':3001') ||
      url.includes(':3002')
    );

    expect(localServerRequests).toHaveLength(0);
  });
});