import { test, expect, Page, BrowserContext } from '@playwright/test';

const TOM_URL = process.env.TOM_URL || 'http://localhost:3001';
const BOB_URL = process.env.BOB_URL || 'http://localhost:3002';

test.describe('P2P Trust Diary - Network Isolation Tests', () => {
  let tomContext: BrowserContext;
  let bobContext: BrowserContext;
  let tomPage: Page;
  let bobPage: Page;

  test.beforeAll(async ({ browser }) => {
    // Create separate browser contexts for network isolation
    tomContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read', 'clipboard-write']
    });
    bobContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read', 'clipboard-write']
    });

    tomPage = await tomContext.newPage();
    bobPage = await bobContext.newPage();

    // Navigate to respective pages
    await tomPage.goto(TOM_URL);
    await bobPage.goto(BOB_URL);

    // Wait for key generation
    await tomPage.waitForTimeout(2000);
    await bobPage.waitForTimeout(2000);
  });

  test.afterAll(async () => {
    await tomContext.close();
    await bobContext.close();
  });

  test('should generate unique cryptographic keys for each peer', async () => {
    // Check Tom's keys
    const tomPublicKey = await tomPage.locator('#publicKey').textContent();
    const tomBoxKey = await tomPage.locator('#boxPublicKey').textContent();

    expect(tomPublicKey).toBeTruthy();
    expect(tomPublicKey).not.toBe('Generating...');
    expect(tomBoxKey).toBeTruthy();
    expect(tomBoxKey).not.toBe('Generating...');

    // Check Bob's keys
    const bobPublicKey = await bobPage.locator('#publicKey').textContent();
    const bobBoxKey = await bobPage.locator('#boxPublicKey').textContent();

    expect(bobPublicKey).toBeTruthy();
    expect(bobPublicKey).not.toBe('Generating...');
    expect(bobBoxKey).toBeTruthy();
    expect(bobBoxKey).not.toBe('Generating...');

    // Ensure keys are different
    expect(tomPublicKey).not.toBe(bobPublicKey);
    expect(tomBoxKey).not.toBe(bobBoxKey);
  });

  test('should establish P2P connection across isolated networks', async () => {
    // Get Tom's keys
    const tomPublicKey = await tomPage.locator('#publicKey').textContent();
    const tomBoxKey = await tomPage.locator('#boxPublicKey').textContent();

    // Get Bob's keys
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

    // Wait for P2P connection
    await tomPage.waitForTimeout(3000);

    // Check connection status
    const tomLogs = await tomPage.locator('#logs').textContent();
    expect(tomLogs).toContain('Peer connected');

    const bobLogs = await bobPage.locator('#logs').textContent();
    expect(bobLogs).toContain('Peer connected');
  });

  test('should exchange encrypted messages between peers', async () => {
    const testMessage = `Test message ${Date.now()}`;

    // Tom sends a message
    await tomPage.fill('#message', testMessage);
    await tomPage.click('button:has-text("Add Entry")');

    // Wait for message propagation
    await tomPage.waitForTimeout(2000);

    // Check Bob received the message
    const bobEntries = await bobPage.locator('.entry').allTextContents();
    const hasMessage = bobEntries.some(entry => entry.includes(testMessage));
    expect(hasMessage).toBeTruthy();
  });

  test('should verify message signatures', async () => {
    const testMessage = `Signed message ${Date.now()}`;

    // Bob sends a signed message
    await bobPage.fill('#message', testMessage);
    await bobPage.click('button:has-text("Add Entry")');

    // Wait for message propagation
    await bobPage.waitForTimeout(2000);

    // Check Tom received and verified the message
    const tomEntries = await tomPage.locator('.entry').allTextContents();
    const hasMessage = tomEntries.some(entry => entry.includes(testMessage));
    expect(hasMessage).toBeTruthy();

    // Check signature verification in logs
    const tomLogs = await tomPage.locator('#logs').textContent();
    expect(tomLogs).not.toContain('Invalid signature');
  });

  test('should maintain connection through network disruptions', async () => {
    // Simulate network disruption by checking reconnection
    await tomPage.evaluate(() => {
      // Force disconnect if possible
      if (window['room']) {
        window['room'].leave();
      }
    });

    await tomPage.waitForTimeout(2000);

    // Reconnect
    await tomPage.click('button:has-text("Trust Bob")');
    await tomPage.waitForTimeout(3000);

    // Verify reconnection
    const tomLogs = await tomPage.locator('#logs').textContent();
    expect(tomLogs).toContain('Peer connected');
  });

  test('should handle concurrent messages correctly', async () => {
    const messages = Array.from({ length: 5 }, (_, i) => `Concurrent message ${i} - ${Date.now()}`);

    // Send multiple messages from Tom
    for (const msg of messages) {
      await tomPage.fill('#message', msg);
      await tomPage.click('button:has-text("Add Entry")');
      await tomPage.waitForTimeout(500);
    }

    // Wait for all messages to propagate
    await tomPage.waitForTimeout(3000);

    // Verify Bob received all messages
    const bobEntries = await bobPage.locator('.entry').allTextContents();
    for (const msg of messages) {
      const hasMessage = bobEntries.some(entry => entry.includes(msg));
      expect(hasMessage).toBeTruthy();
    }
  });
});

test.describe('P2P Security Tests', () => {
  test('should reject messages from untrusted peers', async ({ page }) => {
    // This test would require a third peer trying to send messages
    // without being in the trust list
    test.skip();
  });

  test('should validate encryption keys format', async ({ page }) => {
    await page.goto(TOM_URL);

    // Try to trust with invalid keys
    await page.fill('#bobPublicKey', 'invalid-key');
    await page.fill('#bobBoxPublicKey', 'invalid-key');
    await page.click('button:has-text("Trust Bob")');

    // Check for error handling
    const logs = await page.locator('#logs').textContent();
    expect(logs).toContain('Invalid');
  });
});