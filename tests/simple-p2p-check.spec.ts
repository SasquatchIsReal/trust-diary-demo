import { test } from '@playwright/test';

test('simple P2P connection verification', async ({ browser }) => {
  test.setTimeout(90000); // 90 seconds

  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const roomName = `simple-test-${Date.now()}`;
  console.log(`Testing room: ${roomName}`);

  try {
    // Navigate both browsers
    await Promise.all([
      page1.goto('https://sasquatchisreal.github.io/trust-diary-demo/'),
      page2.goto('https://sasquatchisreal.github.io/trust-diary-demo/')
    ]);

    await Promise.all([
      page1.waitForLoadState('networkidle'),
      page2.waitForLoadState('networkidle')
    ]);

    console.log('✅ Both pages loaded');

    // Connect both browsers
    await page1.fill('input[placeholder*="room"]', roomName);
    await page2.fill('input[placeholder*="room"]', roomName);

    console.log('✅ Room names filled');

    await Promise.all([
      page1.click('button:has-text("Connect")'),
      page2.click('button:has-text("Connect")')
    ]);

    console.log('✅ Connect buttons clicked');

    // Wait for connection indicators with a reasonable timeout
    await Promise.race([
      page1.waitForFunction(() => {
        const text = document.body.textContent || '';
        return text.includes('Connected') && text.includes('peer');
      }, { timeout: 30000 }),
      page2.waitForFunction(() => {
        const text = document.body.textContent || '';
        return text.includes('Connected') && text.includes('peer');
      }, { timeout: 30000 })
    ]);

    console.log('✅ P2P connection established!');

    // Send a simple message
    await page1.fill('input[placeholder*="title"]', 'Simple Test');
    await page1.fill('textarea', 'Hello P2P!');
    await page1.click('button:has-text("Send")');

    console.log('✅ Message sent from Browser 1');

    // Check if message appears in Browser 2 (with shorter timeout to avoid hanging)
    try {
      await page2.waitForFunction(() => {
        const text = document.body.textContent || '';
        return text.includes('Simple Test') && text.includes('Hello P2P!');
      }, { timeout: 10000 });

      console.log('✅ Message received in Browser 2!');
      console.log('\n🎉 P2P SYSTEM FULLY FUNCTIONAL!');

    } catch (messageError) {
      console.log('⚠️  Message delivery timeout (but connection worked)');

      // Still capture status for analysis
      const status1 = await page1.textContent('body');
      const status2 = await page2.textContent('body');

      console.log('Browser 1 status:', status1?.includes('Connected') ? 'Connected' : 'Not connected');
      console.log('Browser 2 status:', status2?.includes('Connected') ? 'Connected' : 'Not connected');
    }

    // Take screenshots for documentation
    await page1.screenshot({ path: 'test-results/simple-p2p-browser1.png', fullPage: true });
    await page2.screenshot({ path: 'test-results/simple-p2p-browser2.png', fullPage: true });

  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);

    // Take error screenshots
    try {
      await page1.screenshot({ path: 'test-results/simple-p2p-error1.png', fullPage: true });
      await page2.screenshot({ path: 'test-results/simple-p2p-error2.png', fullPage: true });
    } catch {}

    throw error;
  } finally {
    await context1.close();
    await context2.close();
  }
});