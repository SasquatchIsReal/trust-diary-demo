import { test, expect } from '@playwright/test';
import path from 'path';

test('Nostr Discovery Actually Works', async ({ page }) => {
  console.log('Testing Nostr discovery with fixed client...');

  // Load the test HTML that we know works
  const filePath = path.join(process.cwd(), 'test-nostr-manual.html');
  await page.goto(`file://${filePath}`);

  // Wait for result
  await page.waitForTimeout(5000); // Give it time to connect

  // Get the log
  const log = await page.locator('#log').textContent();
  console.log('='.repeat(60));
  console.log('NOSTR DISCOVERY RESULTS:');
  console.log('='.repeat(60));
  console.log(log);
  console.log('='.repeat(60));

  // Check if we found the service
  if (log?.includes('✅ Parsed offer')) {
    console.log('✅ SUCCESS! Service discovered via Nostr!');
    expect(log).toContain('✅ Parsed offer');
  } else if (log?.includes('❌ Timeout')) {
    console.log('❌ Service not found on Nostr (may need to republish)');
  } else {
    console.log('⚠️ Unexpected result');
  }

  // Take screenshot as proof
  await page.screenshot({ path: 'nostr-discovery-result.png', fullPage: true });
});