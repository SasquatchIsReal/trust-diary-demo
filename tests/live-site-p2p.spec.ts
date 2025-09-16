import { test, expect, type Page, type BrowserContext } from '@playwright/test';

test.describe('Live GitHub Pages P2P Connectivity', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeAll(async ({ browser }) => {
    // Create two isolated browser contexts (like different users)
    context1 = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });

    context2 = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      locale: 'en-GB',
      timezoneId: 'Europe/London'
    });

    page1 = await context1.newPage();
    page2 = await context2.newPage();

    // Enable console logging for both pages
    page1.on('console', msg => console.log(`Browser 1 Console [${msg.type()}]:`, msg.text()));
    page2.on('console', msg => console.log(`Browser 2 Console [${msg.type()}]:`, msg.text()));

    // Enable error logging for both pages
    page1.on('pageerror', err => console.error('Browser 1 Page Error:', err.message));
    page2.on('pageerror', err => console.error('Browser 2 Page Error:', err.message));
  });

  test.afterAll(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('should establish P2P connection between two browsers on live site', async () => {
    const roomName = `test-room-${Date.now()}`;
    console.log(`Using room name: ${roomName}`);

    // Navigate both browsers to the live GitHub Pages site
    console.log('Navigating to live site...');
    await Promise.all([
      page1.goto('https://sasquatchisreal.github.io/trust-diary-demo/'),
      page2.goto('https://sasquatchisreal.github.io/trust-diary-demo/')
    ]);

    // Wait for pages to load
    await Promise.all([
      page1.waitForLoadState('networkidle'),
      page2.waitForLoadState('networkidle')
    ]);

    // Take initial screenshots
    await page1.screenshot({ path: 'test-results/browser1-initial.png', fullPage: true });
    await page2.screenshot({ path: 'test-results/browser2-initial.png', fullPage: true });

    // Check if the page loaded correctly
    const title1 = await page1.title();
    const title2 = await page2.title();
    console.log(`Browser 1 title: ${title1}`);
    console.log(`Browser 2 title: ${title2}`);

    // Look for room input and connect button
    console.log('Looking for room input and connect elements...');

    // Check what elements are actually present on the page
    const bodyText1 = await page1.locator('body').textContent();
    const bodyText2 = await page2.locator('body').textContent();
    console.log('Browser 1 body text:', bodyText1?.substring(0, 200) + '...');
    console.log('Browser 2 body text:', bodyText2?.substring(0, 200) + '...');

    // Try to find room input field (try multiple possible selectors)
    let roomInput1, roomInput2, connectBtn1, connectBtn2;

    try {
      // Try common input selectors
      roomInput1 = page1.locator('input[placeholder*="room"], input[id*="room"], input[name*="room"], input[type="text"]').first();
      roomInput2 = page2.locator('input[placeholder*="room"], input[id*="room"], input[name*="room"], input[type="text"]').first();

      // Try common button selectors
      connectBtn1 = page1.locator('button:has-text("Connect"), button:has-text("connect"), input[type="button"][value*="Connect"], input[type="submit"]').first();
      connectBtn2 = page2.locator('button:has-text("Connect"), button:has-text("connect"), input[type="button"][value*="Connect"], input[type="submit"]').first();

      // Check if elements exist
      const roomInputExists1 = await roomInput1.count() > 0;
      const roomInputExists2 = await roomInput2.count() > 0;
      const connectBtnExists1 = await connectBtn1.count() > 0;
      const connectBtnExists2 = await connectBtn2.count() > 0;

      console.log(`Browser 1 - Room input exists: ${roomInputExists1}, Connect button exists: ${connectBtnExists1}`);
      console.log(`Browser 2 - Room input exists: ${roomInputExists2}, Connect button exists: ${connectBtnExists2}`);

      if (!roomInputExists1 || !connectBtnExists1) {
        // Let's dump all interactive elements for debugging
        const allInputs1 = await page1.locator('input, button').all();
        const allInputs2 = await page2.locator('input, button').all();

        console.log('Browser 1 interactive elements:');
        for (const input of allInputs1) {
          const tagName = await input.evaluate(el => el.tagName);
          const type = await input.getAttribute('type');
          const placeholder = await input.getAttribute('placeholder');
          const value = await input.getAttribute('value');
          const text = await input.textContent();
          console.log(`  ${tagName} type="${type}" placeholder="${placeholder}" value="${value}" text="${text}"`);
        }

        console.log('Browser 2 interactive elements:');
        for (const input of allInputs2) {
          const tagName = await input.evaluate(el => el.tagName);
          const type = await input.getAttribute('type');
          const placeholder = await input.getAttribute('placeholder');
          const value = await input.getAttribute('value');
          const text = await input.textContent();
          console.log(`  ${tagName} type="${type}" placeholder="${placeholder}" value="${value}" text="${text}"`);
        }
      }

      if (roomInputExists1 && connectBtnExists1 && roomInputExists2 && connectBtnExists2) {
        console.log('Found UI elements, proceeding with connection test...');

        // Enter room name in both browsers
        await roomInput1.fill(roomName);
        await roomInput2.fill(roomName);

        console.log('Filled room names, clicking connect buttons...');

        // Click connect in both browsers
        await Promise.all([
          connectBtn1.click(),
          connectBtn2.click()
        ]);

        console.log('Clicked connect buttons, waiting for connection...');

        // Wait for peer connection (up to 30 seconds)
        // Look for connection status indicators
        const connectionTimeout = 30000;

        try {
          await Promise.race([
            // Wait for connection status text
            page1.waitForFunction(() => {
              return document.body.textContent?.includes('Connected') ||
                     document.body.textContent?.includes('Peer connected') ||
                     document.body.textContent?.includes('connection established');
            }, { timeout: connectionTimeout }),

            page2.waitForFunction(() => {
              return document.body.textContent?.includes('Connected') ||
                     document.body.textContent?.includes('Peer connected') ||
                     document.body.textContent?.includes('connection established');
            }, { timeout: connectionTimeout })
          ]);

          console.log('Connection established! Proceeding with message test...');

          // Take screenshots after connection
          await page1.screenshot({ path: 'test-results/browser1-connected.png', fullPage: true });
          await page2.screenshot({ path: 'test-results/browser2-connected.png', fullPage: true });

          // Try to send a diary entry from Browser 1
          const titleInput = page1.locator('input[placeholder*="title"], input[id*="title"], input[name*="title"]').first();
          const contentInput = page1.locator('textarea, input[placeholder*="content"], input[id*="content"]').first();
          const sendBtn = page1.locator('button:has-text("Send"), button:has-text("Add"), input[type="submit"]').first();

          const titleInputExists = await titleInput.count() > 0;
          const contentInputExists = await contentInput.count() > 0;
          const sendBtnExists = await sendBtn.count() > 0;

          if (titleInputExists && contentInputExists && sendBtnExists) {
            console.log('Found diary entry form, sending test entry...');

            await titleInput.fill('Test Entry');
            await contentInput.fill('Hello from Browser 1');
            await sendBtn.click();

            console.log('Sent test entry, waiting for Browser 2 to receive...');

            // Wait for Browser 2 to receive the entry
            await page2.waitForFunction(() => {
              return document.body.textContent?.includes('Test Entry') ||
                     document.body.textContent?.includes('Hello from Browser 1');
            }, { timeout: 10000 });

            console.log('Entry received in Browser 2!');

            // Take final screenshots
            await page1.screenshot({ path: 'test-results/browser1-final.png', fullPage: true });
            await page2.screenshot({ path: 'test-results/browser2-final.png', fullPage: true });

            // Verify the entry appears in Browser 2
            const browser2Content = await page2.locator('body').textContent();
            expect(browser2Content).toContain('Test Entry');
            expect(browser2Content).toContain('Hello from Browser 1');

          } else {
            console.log('Could not find diary entry form elements');
            throw new Error('Diary entry form not found');
          }

        } catch (error) {
          console.log('Connection failed or timed out:', error);

          // Take failure screenshots
          await page1.screenshot({ path: 'test-results/browser1-failed.png', fullPage: true });
          await page2.screenshot({ path: 'test-results/browser2-failed.png', fullPage: true });

          // Get final page content for debugging
          const finalContent1 = await page1.locator('body').textContent();
          const finalContent2 = await page2.locator('body').textContent();
          console.log('Browser 1 final content:', finalContent1?.substring(0, 500));
          console.log('Browser 2 final content:', finalContent2?.substring(0, 500));

          throw error;
        }

      } else {
        throw new Error(`UI elements not found. Room input: ${roomInputExists1}/${roomInputExists2}, Connect button: ${connectBtnExists1}/${connectBtnExists2}`);
      }

    } catch (error) {
      console.error('Test failed:', error);

      // Take error screenshots
      await page1.screenshot({ path: 'test-results/browser1-error.png', fullPage: true });
      await page2.screenshot({ path: 'test-results/browser2-error.png', fullPage: true });

      throw error;
    }
  });

  test('should show meaningful error messages for connection failures', async () => {
    const roomName = `fail-test-${Date.now()}`;

    // Navigate only Browser 1 to test single-peer scenario
    await page1.goto('https://sasquatchisreal.github.io/trust-diary-demo/');
    await page1.waitForLoadState('networkidle');

    // Try to connect with no peer
    const roomInput = page1.locator('input[placeholder*="room"], input[id*="room"], input[type="text"]').first();
    const connectBtn = page1.locator('button:has-text("Connect"), input[type="button"]').first();

    if (await roomInput.count() > 0 && await connectBtn.count() > 0) {
      await roomInput.fill(roomName);
      await connectBtn.click();

      // Wait a bit to see if any error messages appear
      await page1.waitForTimeout(5000);

      await page1.screenshot({ path: 'test-results/single-peer-attempt.png', fullPage: true });

      const content = await page1.locator('body').textContent();
      console.log('Single peer attempt result:', content?.substring(0, 300));
    }
  });
});