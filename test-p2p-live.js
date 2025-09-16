const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });

  // Create two browser contexts (like two different users)
  const context1 = await browser.newContext({
    viewport: { width: 800, height: 600 },
    locale: 'en-US'
  });
  const context2 = await browser.newContext({
    viewport: { width: 800, height: 600 },
    locale: 'fr-FR'
  });

  // Open two pages
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  console.log('Opening pages...');

  // Navigate to the live site
  await page1.goto('https://sasquatchisreal.github.io/trust-diary-demo/');
  await page2.goto('https://sasquatchisreal.github.io/trust-diary-demo/');

  // Wait for pages to load
  await page1.waitForTimeout(2000);
  await page2.waitForTimeout(2000);

  const roomName = `test-room-${Date.now()}`;
  console.log(`Using room: ${roomName}`);

  // Browser 1: Connect to room
  await page1.fill('#roomName', roomName);
  await page1.click('button:has-text("Connect to Room")');
  console.log('Browser 1 connected');

  await page1.waitForTimeout(2000);

  // Browser 2: Connect to same room
  await page2.fill('#roomName', roomName);
  await page2.click('button:has-text("Connect to Room")');
  console.log('Browser 2 connected');

  // Wait for peer connection
  console.log('Waiting for peer connection...');
  await page1.waitForTimeout(5000);
  await page2.waitForTimeout(5000);

  // Check connection status
  const status1 = await page1.textContent('#status');
  const status2 = await page2.textContent('#status');
  console.log(`Browser 1 status: ${status1}`);
  console.log(`Browser 2 status: ${status2}`);

  // Send entry from Browser 1
  await page1.fill('#entryTitle', 'Test Entry');
  await page1.fill('#entryContent', 'Hello from Browser 1!');
  await page1.click('button:has-text("Send Entry")');
  console.log('Entry sent from Browser 1');

  await page1.waitForTimeout(3000);

  // Take screenshots
  await page1.screenshot({ path: 'browser1.png', fullPage: true });
  await page2.screenshot({ path: 'browser2.png', fullPage: true });
  console.log('Screenshots saved');

  // Keep browsers open for manual inspection
  console.log('Test complete! Browsers will stay open for inspection.');
  console.log('Press Ctrl+C to close.');

  // Keep running
  await new Promise(() => {});
})();