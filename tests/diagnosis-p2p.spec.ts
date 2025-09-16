import { test, expect, type Page, type BrowserContext } from '@playwright/test';

test.describe('P2P Diagnosis', () => {
  test('analyze P2P connection behavior', async ({ browser }) => {
    // Set longer timeout for this test
    test.setTimeout(120000); // 2 minutes

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    let page1Messages: string[] = [];
    let page2Messages: string[] = [];

    // Capture all console messages
    page1.on('console', msg => {
      const message = `Browser 1: [${msg.type()}] ${msg.text()}`;
      console.log(message);
      page1Messages.push(message);
    });

    page2.on('console', msg => {
      const message = `Browser 2: [${msg.type()}] ${msg.text()}`;
      console.log(message);
      page2Messages.push(message);
    });

    const roomName = `diagnosis-${Date.now()}`;
    console.log(`\n=== DIAGNOSIS TEST FOR ROOM: ${roomName} ===\n`);

    try {
      // Navigate both browsers
      console.log('1. Navigating to live site...');
      await Promise.all([
        page1.goto('https://sasquatchisreal.github.io/trust-diary-demo/'),
        page2.goto('https://sasquatchisreal.github.io/trust-diary-demo/')
      ]);

      await Promise.all([
        page1.waitForLoadState('networkidle'),
        page2.waitForLoadState('networkidle')
      ]);

      console.log('2. Pages loaded successfully');

      // Fill room names and connect
      console.log('3. Filling room names and connecting...');
      await page1.fill('input[placeholder*="room"]', roomName);
      await page2.fill('input[placeholder*="room"]', roomName);

      await Promise.all([
        page1.click('button:has-text("Connect")'),
        page2.click('button:has-text("Connect")')
      ]);

      console.log('4. Connect buttons clicked, waiting for peer connection...');

      // Wait for connection status change with timeout
      const connectionWaitStart = Date.now();
      const maxWaitTime = 45000; // 45 seconds

      let connected = false;
      while (!connected && (Date.now() - connectionWaitStart) < maxWaitTime) {
        // Check if both pages show "Connected"
        const status1 = await page1.locator('body').textContent();
        const status2 = await page2.locator('body').textContent();

        const page1Connected = status1?.includes('Connected') && status1?.includes('peer');
        const page2Connected = status2?.includes('Connected') && status2?.includes('peer');

        if (page1Connected && page2Connected) {
          connected = true;
          console.log('5. ✅ P2P CONNECTION ESTABLISHED!');
          console.log(`   - Time taken: ${Date.now() - connectionWaitStart}ms`);
          break;
        }

        await page1.waitForTimeout(1000); // Check every second
      }

      if (!connected) {
        console.log('5. ❌ P2P connection failed to establish within timeout');

        // Get final status
        const status1 = await page1.locator('body').textContent();
        const status2 = await page2.locator('body').textContent();

        console.log('\nFinal status check:');
        console.log(`Browser 1 status: ${status1?.substring(0, 200)}...`);
        console.log(`Browser 2 status: ${status2?.substring(0, 200)}...`);

        // Take screenshots
        await page1.screenshot({ path: 'test-results/diagnosis-browser1-failed.png', fullPage: true });
        await page2.screenshot({ path: 'test-results/diagnosis-browser2-failed.png', fullPage: true });

        throw new Error('P2P connection timed out');
      }

      // Test message sending
      console.log('6. Testing message sending...');

      await page1.fill('input[placeholder*="title"]', 'Diagnosis Test');
      await page1.fill('textarea, input[placeholder*="entry"]', 'Test message from Browser 1');
      await page1.click('button:has-text("Send")');

      console.log('7. Message sent, waiting for Browser 2 to receive...');

      // Wait for message to appear in Browser 2
      const messageWaitStart = Date.now();
      const messageMaxWait = 15000; // 15 seconds

      let messageReceived = false;
      while (!messageReceived && (Date.now() - messageWaitStart) < messageMaxWait) {
        const content2 = await page2.locator('body').textContent();

        if (content2?.includes('Diagnosis Test') && content2?.includes('Test message from Browser 1')) {
          messageReceived = true;
          console.log('8. ✅ MESSAGE RECEIVED SUCCESSFULLY!');
          console.log(`   - Message delivery time: ${Date.now() - messageWaitStart}ms`);
          break;
        }

        await page1.waitForTimeout(500); // Check every 500ms
      }

      if (!messageReceived) {
        console.log('8. ❌ Message not received within timeout');

        const content2 = await page2.locator('body').textContent();
        console.log(`Browser 2 final content: ${content2?.substring(0, 300)}...`);

        await page1.screenshot({ path: 'test-results/diagnosis-browser1-no-message.png', fullPage: true });
        await page2.screenshot({ path: 'test-results/diagnosis-browser2-no-message.png', fullPage: true });

        throw new Error('Message delivery failed');
      }

      // Success! Take final screenshots
      await page1.screenshot({ path: 'test-results/diagnosis-browser1-success.png', fullPage: true });
      await page2.screenshot({ path: 'test-results/diagnosis-browser2-success.png', fullPage: true });

      console.log('\n=== ✅ DIAGNOSIS COMPLETE: P2P SYSTEM WORKING ===');
      console.log('- Connection establishment: SUCCESS');
      console.log('- Message delivery: SUCCESS');
      console.log('- Both browsers can communicate directly\n');

    } catch (error) {
      console.log(`\n=== ❌ DIAGNOSIS FAILED: ${error.message} ===`);

      console.log('\nConsole Messages Summary:');
      console.log('Browser 1 messages:');
      page1Messages.forEach(msg => console.log(`  ${msg}`));
      console.log('Browser 2 messages:');
      page2Messages.forEach(msg => console.log(`  ${msg}`));

      // Take error screenshots if not already taken
      try {
        await page1.screenshot({ path: 'test-results/diagnosis-browser1-error.png', fullPage: true });
        await page2.screenshot({ path: 'test-results/diagnosis-browser2-error.png', fullPage: true });
      } catch (screenshotError) {
        console.log('Could not take error screenshots:', screenshotError.message);
      }

      throw error;
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});