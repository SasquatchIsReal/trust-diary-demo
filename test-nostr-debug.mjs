import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => console.log('Browser:', msg.text()));

  // Navigate to test page
  await page.goto('http://localhost:8889/test-nostr-query.html');

  // Wait for query to complete (10 seconds + buffer)
  await page.waitForTimeout(15000);

  // Get the output
  const output = await page.locator('#output').textContent();
  console.log('\n=== Query Results ===\n');
  console.log(output);

  await browser.close();
})();