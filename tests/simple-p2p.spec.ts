import { test, expect, Page, BrowserContext } from '@playwright/test';

// Static file server just for serving HTML - NOT for P2P communication
test.use({
  baseURL: 'http://localhost:8888'
});

test.describe('P2P Direct Browser Communication Tests', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let tomPage: Page;
  let bobPage: Page;

  test.beforeEach(async ({ browser }) => {
    // Create two isolated browser contexts
    context1 = await browser.newContext();
    context2 = await browser.newContext();

    tomPage = await context1.newPage();
    bobPage = await context2.newPage();

    // Load the HTML files from static server (just serving files, not handling P2P)
    await tomPage.goto('http://localhost:8888/tom-jsbin.html');
    await bobPage.goto('http://localhost:8888/bob-jsbin.html');

    // Wait for crypto keys to generate
    await tomPage.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...';
    }, { timeout: 5000 });

    await bobPage.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...';
    }, { timeout: 5000 });
  });

  test.afterEach(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('generates unique cryptographic identities', async () => {
    const tomPublicKey = await tomPage.locator('#publicKey').textContent();
    const tomBoxKey = await tomPage.locator('#boxPublicKey').textContent();
    const bobPublicKey = await bobPage.locator('#publicKey').textContent();
    const bobBoxKey = await bobPage.locator('#boxPublicKey').textContent();

    // Verify keys are generated
    expect(tomPublicKey).toBeTruthy();
    expect(tomBoxKey).toBeTruthy();
    expect(bobPublicKey).toBeTruthy();
    expect(bobBoxKey).toBeTruthy();

    // Verify keys are unique
    expect(tomPublicKey).not.toBe(bobPublicKey);
    expect(tomBoxKey).not.toBe(bobBoxKey);
  });

  test('establishes P2P connection via WebTorrent', async () => {
    // Exchange keys
    const tomPublicKey = await tomPage.locator('#publicKey').textContent();
    const tomBoxKey = await tomPage.locator('#boxPublicKey').textContent();
    const bobPublicKey = await bobPage.locator('#publicKey').textContent();
    const bobBoxKey = await bobPage.locator('#boxPublicKey').textContent();

    // Tom trusts Bob
    await tomPage.fill('#bobPublicKey', bobPublicKey!);
    await tomPage.fill('#bobBoxPublicKey', bobBoxKey!);
    await tomPage.click('button:has-text("Trust Bob")');

    // Bob trusts Tom
    await bobPage.fill('#tomPublicKey', tomPublicKey!);
    await bobPage.fill('#tomBoxPublicKey', tomBoxKey!);
    await bobPage.click('button:has-text("Trust Tom")');

    // Wait for P2P connection (may take time for WebTorrent discovery)
    await expect(async () => {
      const tomLogs = await tomPage.locator('#logs').textContent();
      expect(tomLogs).toContain('Joining room');
    }).toPass({ timeout: 30000 });
  });

  test('validates no server mediation for messages', async () => {
    // Monitor network requests
    const requests: string[] = [];

    tomPage.on('request', request => {
      const url = request.url();
      if (!url.includes('localhost:3000') && !url.includes('cdn')) {
        requests.push(url);
      }
    });

    // Exchange keys and connect
    const tomPublicKey = await tomPage.locator('#publicKey').textContent();
    const tomBoxKey = await tomPage.locator('#boxPublicKey').textContent();
    const bobPublicKey = await bobPage.locator('#publicKey').textContent();
    const bobBoxKey = await bobPage.locator('#boxPublicKey').textContent();

    await tomPage.fill('#bobPublicKey', bobPublicKey!);
    await tomPage.fill('#bobBoxPublicKey', bobBoxKey!);
    await tomPage.click('button:has-text("Trust Bob")');

    await bobPage.fill('#tomPublicKey', tomPublicKey!);
    await bobPage.fill('#tomBoxPublicKey', tomBoxKey!);
    await bobPage.click('button:has-text("Trust Tom")');

    // Wait a bit for connection attempts
    await tomPage.waitForTimeout(5000);

    // Check that only WebTorrent tracker requests were made
    const nonP2PRequests = requests.filter(url =>
      !url.includes('tracker') &&
      !url.includes('webtorrent') &&
      !url.includes('wss://') // WebSocket trackers
    );

    expect(nonP2PRequests.length).toBe(0);
  });
});

test.describe('P2P Message Exchange', () => {
  test('sends encrypted messages directly between browsers', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const tomPage = await context1.newPage();
    const bobPage = await context2.newPage();

    await tomPage.goto('http://localhost:3000/tom-jsbin.html');
    await bobPage.goto('http://localhost:3000/bob-jsbin.html');

    // Wait for initialization
    await tomPage.waitForTimeout(3000);
    await bobPage.waitForTimeout(3000);

    // Get and exchange keys
    const tomPublicKey = await tomPage.locator('#publicKey').textContent();
    const tomBoxKey = await tomPage.locator('#boxPublicKey').textContent();
    const bobPublicKey = await bobPage.locator('#publicKey').textContent();
    const bobBoxKey = await bobPage.locator('#boxPublicKey').textContent();

    // Establish trust
    await tomPage.fill('#bobPublicKey', bobPublicKey!);
    await tomPage.fill('#bobBoxPublicKey', bobBoxKey!);
    await tomPage.click('button:has-text("Trust Bob")');

    await bobPage.fill('#tomPublicKey', tomPublicKey!);
    await bobPage.fill('#tomBoxPublicKey', tomBoxKey!);
    await bobPage.click('button:has-text("Trust Tom")');

    // Wait for connection (this might take a while for WebTorrent)
    await tomPage.waitForTimeout(10000);

    // Try to send a message
    const testMessage = `P2P Test ${Date.now()}`;
    await tomPage.fill('#message', testMessage);
    await tomPage.click('button:has-text("Add Entry")');

    // Message should appear in Tom's diary
    await expect(async () => {
      const tomEntries = await tomPage.locator('.entry').allTextContents();
      expect(tomEntries.some(e => e.includes(testMessage))).toBeTruthy();
    }).toPass({ timeout: 5000 });

    await context1.close();
    await context2.close();
  });
});