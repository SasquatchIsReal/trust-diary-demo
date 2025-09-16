import { test, expect, Page, BrowserContext } from '@playwright/test';

test.describe('Live P2P Connection Test', () => {
  test('two browsers can connect via P2P on GitHub Pages', async ({ browser }) => {
    // Create two separate browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const roomName = `test-room-${Date.now()}`;
    console.log(`Testing with room: ${roomName}`);

    // Navigate both to GitHub Pages
    await page1.goto('https://sasquatchisreal.github.io/trust-diary-demo/');
    await page2.goto('https://sasquatchisreal.github.io/trust-diary-demo/');

    // Connect Browser 1
    await page1.fill('#roomName', roomName);
    await page1.click('button:has-text("Connect to Room")');
    console.log('Browser 1 connected to room');

    // Connect Browser 2
    await page2.fill('#roomName', roomName);
    await page2.click('button:has-text("Connect to Room")');
    console.log('Browser 2 connected to room');

    // Wait for peer connection (WebTorrent discovery can take a few seconds)
    console.log('Waiting for peer discovery...');

    // Check for connection in Browser 1
    await expect(page1.locator('#status')).toContainText('Connected', { timeout: 30000 });
    const status1 = await page1.textContent('#status');
    console.log(`Browser 1 status: ${status1}`);

    // Check for connection in Browser 2
    await expect(page2.locator('#status')).toContainText('Connected', { timeout: 30000 });
    const status2 = await page2.textContent('#status');
    console.log(`Browser 2 status: ${status2}`);

    // Send diary entry from Browser 1
    await page1.fill('#entryTitle', 'Test Entry');
    await page1.fill('#entryContent', 'Hello from Browser 1!');
    await page1.click('button:has-text("Send Entry")');
    console.log('Sent entry from Browser 1');

    // Check if Browser 2 received the entry
    await expect(page2.locator('.message')).toContainText('Test Entry', { timeout: 10000 });
    console.log('Browser 2 received the entry!');

    // Take screenshots
    await page1.screenshot({ path: 'test-results/browser1-connected.png', fullPage: true });
    await page2.screenshot({ path: 'test-results/browser2-received.png', fullPage: true });

    console.log('✅ P2P connection successful!');

    await context1.close();
    await context2.close();
  });
});