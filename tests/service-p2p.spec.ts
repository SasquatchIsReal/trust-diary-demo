import { test, expect, Page, Browser, BrowserContext } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const sleep = promisify(setTimeout);

test.describe('Trust Diary Service - Persistent P2P Tests', () => {
  let serviceProcess: ChildProcess;
  let adminPage: Page;
  let readerPage: Page;
  let context: BrowserContext;

  // Service identity (will be captured from admin UI)
  let servicePublicKey: string;
  let serviceBoxPublicKey: string;

  // Reader identity (will be captured from reader page)
  let readerPublicKey: string;
  let readerBoxPublicKey: string;

  test.beforeAll(async ({ browser }) => {
    console.log('🚀 Starting Trust Diary Service...');

    // Clean up any existing diary data
    const dataDir = path.join(process.cwd(), 'diary-data');
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
    } catch (err) {
      // Directory might not exist
    }

    // Start the service
    serviceProcess = spawn('node', ['service/trust-diary-service.js'], {
      env: { ...process.env, PORT: '3333', DATA_DIR: './diary-data' },
      cwd: process.cwd()
    });

    // Wait for service to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Service failed to start')), 10000);

      serviceProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log('Service:', output);
        if (output.includes('Admin UI: http://localhost:3333')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      serviceProcess.stderr?.on('data', (data) => {
        console.error('Service Error:', data.toString());
      });

      serviceProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    console.log('✅ Service started successfully');

    // Create browser context
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read', 'clipboard-write']
    });
  });

  test.afterAll(async () => {
    // Clean up
    if (serviceProcess) {
      console.log('🛑 Stopping service...');
      serviceProcess.kill('SIGTERM');
      await sleep(1000);
    }

    if (context) {
      await context.close();
    }
  });

  test('Service admin UI loads and shows status', async () => {
    adminPage = await context.newPage();

    // Load admin UI from service
    await adminPage.goto('http://localhost:3333');

    // Check that admin UI loaded
    await expect(adminPage.locator('h1')).toContainText('Trust Diary Service');

    // Wait for service status to load
    await adminPage.waitForSelector('#status:has-text("Running")', { timeout: 5000 });

    // Capture service identity
    const publicKeyElement = await adminPage.locator('#publicKey');
    const boxPublicKeyElement = await adminPage.locator('#boxPublicKey');

    await expect(publicKeyElement).toBeVisible();
    await expect(boxPublicKeyElement).toBeVisible();

    const publicKeyText = await publicKeyElement.textContent();
    const boxPublicKeyText = await boxPublicKeyElement.textContent();

    // Extract the full keys (they're truncated in display)
    // We'll get them from the API instead
    const statusResponse = await adminPage.evaluate(() => fetch('/api/status').then(r => r.json()));

    servicePublicKey = statusResponse.publicKey;
    serviceBoxPublicKey = statusResponse.boxPublicKey;

    console.log('📍 Service Public Key:', servicePublicKey.substring(0, 32) + '...');
    console.log('📍 Service Room ID:', statusResponse.roomId);

    expect(servicePublicKey).toBeTruthy();
    expect(serviceBoxPublicKey).toBeTruthy();
    expect(statusResponse.roomId).toBeTruthy();
  });

  test('Reader client loads from file:// URL and generates identity', async () => {
    readerPage = await context.newPage();

    // Load reader HTML directly as file:// URL
    const readerPath = path.join(process.cwd(), 'client', 'service-reader.html');
    await readerPage.goto(`file://${readerPath}`);

    // Check that page loaded
    await expect(readerPage.locator('h1')).toContainText('Trust Diary Service Reader');

    // Wait for identity generation
    await readerPage.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    // Capture reader identity
    readerPublicKey = await readerPage.locator('#publicKey').textContent() || '';
    readerBoxPublicKey = await readerPage.locator('#boxPublicKey').textContent() || '';

    console.log('🔑 Reader Public Key:', readerPublicKey.substring(0, 32) + '...');

    expect(readerPublicKey).toBeTruthy();
    expect(readerBoxPublicKey).toBeTruthy();
    expect(readerPublicKey.length).toBeGreaterThan(40);
  });

  test('Admin can add reader as trusted user', async () => {
    // Add reader to trusted users via admin UI
    await adminPage.fill('#trustName', 'Test Reader');
    await adminPage.fill('#trustPublicKey', readerPublicKey);
    await adminPage.fill('#trustBoxPublicKey', readerBoxPublicKey);

    await adminPage.click('button:has-text("Add Trusted User")');

    // Wait for trusted user to appear
    await adminPage.waitForSelector('.trusted-user:has-text("Test Reader")', { timeout: 5000 });

    // Verify count updated
    const trustedCount = await adminPage.locator('#trustedCount').textContent();
    expect(trustedCount).toBe('1');
  });

  test('Admin can create diary entries', async () => {
    // Add a test entry
    await adminPage.fill('#newEntry', 'Test entry from admin UI');
    await adminPage.click('button:has-text("Add Entry")');

    // Wait for entry to appear
    await adminPage.waitForSelector('.entry:has-text("Test entry from admin")', { timeout: 5000 });

    // Verify entry count
    const entriesCount = await adminPage.locator('#entriesCount').textContent();
    expect(parseInt(entriesCount || '0')).toBeGreaterThanOrEqual(2); // Initial + new
  });

  test('Reader can connect to service and authenticate', async () => {
    // Enter service keys in reader
    await readerPage.fill('#servicePublicKey', servicePublicKey);
    await readerPage.fill('#serviceBoxPublicKey', serviceBoxPublicKey);

    // Connect to service
    await readerPage.click('button:has-text("Connect to Service")');

    // Wait for connection
    await readerPage.waitForSelector('#status:has-text("Connected")', { timeout: 10000 });

    // Wait for authentication
    await readerPage.waitForSelector('#authStatus:has-text("Authenticated")', { timeout: 10000 });

    console.log('✅ Reader authenticated successfully');

    // Check room ID is displayed
    const roomId = await readerPage.locator('#roomId').textContent();
    expect(roomId).toBeTruthy();
    expect(roomId).not.toBe('-');
  });

  test('Reader receives encrypted diary entries', async () => {
    // Wait for entries to sync
    await readerPage.waitForSelector('.entry', { timeout: 10000 });

    // Get all entries
    const entries = await readerPage.locator('.entry').all();
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // Check that our test entry is there
    const testEntry = await readerPage.locator('.entry:has-text("Test entry from admin")').isVisible();
    expect(testEntry).toBeTruthy();

    console.log('✅ Reader received encrypted entries');
  });

  test('Service shows active connection in admin UI', async () => {
    // Check admin UI shows the connection
    await adminPage.waitForSelector('.connection:has-text("authenticated")', { timeout: 5000 });

    const connections = await adminPage.locator('#connections').textContent();
    expect(connections).toContain('authenticated');

    console.log('✅ Admin UI shows authenticated connection');
  });

  test('New entries sync to connected reader in real-time', async () => {
    // Add another entry from admin
    const uniqueMessage = `Real-time test ${Date.now()}`;
    await adminPage.fill('#newEntry', uniqueMessage);
    await adminPage.click('button:has-text("Add Entry")');

    // Wait for it to appear in admin
    await adminPage.waitForSelector(`.entry:has-text("${uniqueMessage}")`, { timeout: 5000 });

    // Check it syncs to reader
    await readerPage.waitForSelector(`.entry:has-text("${uniqueMessage}")`, { timeout: 10000 });

    console.log('✅ Real-time sync working');
  });

  test('Reader can disconnect and reconnect', async () => {
    // Disconnect
    await readerPage.click('button:has-text("Disconnect")');
    await readerPage.waitForSelector('#status:has-text("Disconnected")', { timeout: 5000 });

    // Reconnect
    await readerPage.click('button:has-text("Connect to Service")');
    await readerPage.waitForSelector('#status:has-text("Connected")', { timeout: 10000 });
    await readerPage.waitForSelector('#authStatus:has-text("Authenticated")', { timeout: 10000 });

    // Verify entries are still there
    const entries = await readerPage.locator('.entry').all();
    expect(entries.length).toBeGreaterThanOrEqual(3);

    console.log('✅ Disconnect/reconnect working');
  });

  test('Untrusted reader cannot authenticate', async () => {
    // Create a new reader page
    const untrustedReader = await context.newPage();
    const readerPath = path.join(process.cwd(), 'client', 'service-reader.html');
    await untrustedReader.goto(`file://${readerPath}`);

    // Wait for identity generation
    await untrustedReader.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    // Try to connect with service keys (but reader is not trusted)
    await untrustedReader.fill('#servicePublicKey', servicePublicKey);
    await untrustedReader.fill('#serviceBoxPublicKey', serviceBoxPublicKey);
    await untrustedReader.click('button:has-text("Connect to Service")');

    // Should connect but not authenticate
    await untrustedReader.waitForSelector('#status:has-text("Connected")', { timeout: 10000 });

    // Should NOT authenticate
    await sleep(3000);
    const authStatus = await untrustedReader.locator('#authStatus').textContent();
    expect(authStatus).not.toContain('Authenticated');

    // Should not receive entries
    const entries = await untrustedReader.locator('.entry').count();
    expect(entries).toBe(0);

    console.log('✅ Untrusted reader blocked successfully');

    await untrustedReader.close();
  });

  test('Multiple readers can connect simultaneously', async () => {
    // Create second trusted reader
    const reader2Page = await context.newPage();
    const readerPath = path.join(process.cwd(), 'client', 'service-reader.html');
    await reader2Page.goto(`file://${readerPath}`);

    // Wait for identity
    await reader2Page.waitForFunction(() => {
      const key = document.querySelector('#publicKey')?.textContent;
      return key && key !== 'Generating...' && key.length > 40;
    }, { timeout: 5000 });

    const reader2PublicKey = await reader2Page.locator('#publicKey').textContent() || '';
    const reader2BoxPublicKey = await reader2Page.locator('#boxPublicKey').textContent() || '';

    // Add reader2 as trusted in admin
    await adminPage.fill('#trustName', 'Reader 2');
    await adminPage.fill('#trustPublicKey', reader2PublicKey);
    await adminPage.fill('#trustBoxPublicKey', reader2BoxPublicKey);
    await adminPage.click('button:has-text("Add Trusted User")');

    await adminPage.waitForSelector('.trusted-user:has-text("Reader 2")', { timeout: 5000 });

    // Connect reader2
    await reader2Page.fill('#servicePublicKey', servicePublicKey);
    await reader2Page.fill('#serviceBoxPublicKey', serviceBoxPublicKey);
    await reader2Page.click('button:has-text("Connect to Service")');

    // Wait for authentication
    await reader2Page.waitForSelector('#authStatus:has-text("Authenticated")', { timeout: 10000 });

    // Both readers should have entries
    const reader1Entries = await readerPage.locator('.entry').count();
    const reader2Entries = await reader2Page.locator('.entry').count();

    expect(reader1Entries).toBeGreaterThan(0);
    expect(reader2Entries).toBeGreaterThan(0);
    expect(reader1Entries).toBe(reader2Entries);

    console.log('✅ Multiple readers working simultaneously');

    await reader2Page.close();
  });
});