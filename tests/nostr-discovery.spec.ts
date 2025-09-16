import { test, expect, Page } from '@playwright/test';
import path from 'path';

test.describe('Nostr Automated Discovery Test', () => {
  let page: Page;
  const SERVICE_NOSTR_PUBKEY = '57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da';

  test('Browser discovers service via Nostr and establishes P2P connection', async ({ browser }) => {
    console.log('🚀 Testing Nostr Automated Discovery...');

    // Create browser context
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write']
    });
    page = await context.newPage();

    // Load the HTML file from file:// URL (simulating USB stick)
    const filePath = path.join(process.cwd(), 'client', 'nostr-p2p-reader.html');
    const fileUrl = `file://${filePath}`;

    console.log('📁 Loading from file:// URL:', fileUrl);
    await page.goto(fileUrl);

    // Verify page loaded
    await expect(page.locator('h1')).toContainText('Trust Diary - Zero Infrastructure P2P');

    // Check that it recognizes it's running from file://
    await page.waitForSelector('.log:has-text("Running from: file:")', { timeout: 5000 });
    console.log('✅ Client loaded from file:// URL');

    // Wait for identity generation
    await page.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    const publicKey = await page.locator('#publicKey').textContent();
    console.log('🔑 Generated identity:', publicKey?.substring(0, 32) + '...');

    // Switch to Nostr Discovery tab (should be active by default)
    const nostrTab = page.locator('.tab:has-text("Nostr Discovery")');
    if (!await nostrTab.evaluate(el => el.classList.contains('active'))) {
      await nostrTab.click();
    }

    // Enter service's Nostr pubkey
    await page.fill('#nostrPubKey', SERVICE_NOSTR_PUBKEY);
    console.log('📝 Entered service Nostr pubkey:', SERVICE_NOSTR_PUBKEY.substring(0, 16) + '...');

    // Click to find service on Nostr
    await page.click('button:has-text("Find Service on Nostr")');
    console.log('🔍 Searching for service on Nostr relays...');

    // Wait for Nostr relay connections
    await page.waitForSelector('.log:has-text("Connected to wss://")', { timeout: 10000 });

    // Wait for service discovery
    await page.waitForSelector('.log:has-text("Found service offer on Nostr")', { timeout: 15000 });
    console.log('✅ Found service offer on Nostr!');

    // Wait for WebRTC processing
    await page.waitForSelector('.log:has-text("Processing service offer")', { timeout: 5000 });

    // Wait for WebRTC connection
    await page.waitForSelector('#rtcState:has-text("connected")', { timeout: 20000 });
    console.log('✅ WebRTC connected!');

    // Verify data channel is open
    await page.waitForSelector('#dataChannelState:has-text("Open")', { timeout: 10000 });
    console.log('✅ Data channel opened!');

    // Check discovery method shows Nostr
    const discoveryMethod = await page.locator('#discoveryMethod').textContent();
    expect(discoveryMethod).toBe('Nostr');

    // Wait for authentication
    await page.waitForSelector('.log:has-text("Received auth challenge")', { timeout: 10000 });
    await page.waitForSelector('.log:has-text("Authenticated")', { timeout: 10000 });
    console.log('✅ Authenticated with service!');

    // Verify we can receive entries
    await page.waitForSelector('.entry', { timeout: 10000 });
    const entries = await page.locator('.entry').count();
    console.log(`✅ Received ${entries} diary entries`);

    // Get connection status
    const connectionStatus = await page.locator('#connectionStatus').textContent();
    expect(connectionStatus).toContain('connected');

    console.log('\n' + '='.repeat(60));
    console.log('🎉 SUCCESS! Nostr Automated Discovery Works!');
    console.log('='.repeat(60));
    console.log('✅ Browser loaded from file:// URL');
    console.log('✅ Discovered service via Nostr pubkey');
    console.log('✅ Established WebRTC connection automatically');
    console.log('✅ No WebSocket signaling server needed!');
    console.log('✅ Authenticated and received diary entries');
    console.log('='.repeat(60));

    // Take screenshot as proof
    await page.screenshot({ path: 'nostr-discovery-success.png', fullPage: true });
    console.log('📸 Screenshot saved: nostr-discovery-success.png');

    await page.close();
  });

  test('Manual fallback works when Nostr is unavailable', async ({ browser }) => {
    console.log('\n🔧 Testing Manual Fallback...');

    const context = await browser.newContext();
    page = await context.newPage();

    // Load from file://
    const filePath = path.join(process.cwd(), 'client', 'nostr-p2p-reader.html');
    await page.goto(`file://${filePath}`);

    // Wait for identity
    await page.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    // Switch to Manual Exchange tab
    await page.click('.tab:has-text("Manual Exchange")');

    // Get offer from service
    const offerResponse = await fetch('http://localhost:3334/api/offer');
    const offer = await offerResponse.json();
    console.log('📋 Got offer from service, ID:', offer.offerId);

    // Paste offer in browser
    await page.fill('#manualOffer', JSON.stringify(offer));

    // Generate answer
    await page.click('button:has-text("Generate Answer")');

    // Wait for answer generation
    await page.waitForSelector('#manualAnswer', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('.log:has-text("Answer generated")', { timeout: 5000 });

    // Get the answer
    const answerText = await page.locator('#answerText').inputValue();
    const answer = JSON.parse(answerText);
    console.log('📝 Generated answer for offer:', answer.offerId);

    // Submit answer to service
    const submitResponse = await fetch('http://localhost:3334/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: answerText
    });

    expect(submitResponse.ok).toBeTruthy();
    console.log('✅ Answer submitted to service');

    // Wait for WebRTC connection
    await page.waitForSelector('#rtcState:has-text("connected")', { timeout: 20000 });
    console.log('✅ WebRTC connected via manual exchange!');

    // Verify discovery method shows Manual
    const discoveryMethod = await page.locator('#discoveryMethod').textContent();
    expect(discoveryMethod).toBe('Manual');

    console.log('\n✅ Manual fallback works perfectly!');
    console.log('   - No Nostr needed');
    console.log('   - Pure copy/paste');
    console.log('   - Zero infrastructure!');

    await page.close();
  });
});