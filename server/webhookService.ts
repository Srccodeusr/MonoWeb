import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { saveDbSync } from './db';
import { WebhookSubscription } from '../src/types';
import { assertPublicHttpUrl, pinnedLookup } from './utils/safeUrl';

/**
 * Deliver a webhook with HMAC SHA-256 signature
 */
export async function deliverWebhook(
  webhook: WebhookSubscription,
  payloadString: string,
  event: string
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const fail = (message: string, status = 0) => {
    webhook.lastTriggeredAt = new Date().toISOString();
    webhook.lastStatus = status;
    webhook.lastError = message;
    saveDbSync();
    return { success: false, error: message };
  };

  // SSRF guard: the target must resolve to public addresses only, and that address is pinned for the request.
  let target;
  try {
    target = await assertPublicHttpUrl(webhook.url);
  } catch (err: any) {
    return fail(err?.message || 'The webhook URL is not allowed.');
  }

  return new Promise((resolve) => {
    try {
      const url = target.url;
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      // Compute HMAC-SHA256 signature using the webhook secret
      const signature = crypto
        .createHmac('sha256', webhook.secret || 'aether_default_secret')
        .update(payloadString)
        .digest('hex');

      const options = {
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        lookup: pinnedLookup(target.address, target.family) as any,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadString),
          'User-Agent': 'MonoNode-Webhook-Delivery/1.0',
          'X-MonoNode-Event': event,
          'X-MonoNode-Signature-256': `sha256=${signature}`,
          'X-MonoNode-Delivery': `del_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
        },
        timeout: 10000 // 10s timeout
      };

      let settled = false;
      const done = (value: { success: boolean; statusCode?: number; error?: string }) => { if (!settled) { settled = true; resolve(value); } };

      const req = client.request(options, (res) => {
        let resData = '';
        res.on('data', chunk => { if (resData.length < 500) resData += chunk; }); // only the first bytes are ever shown
        res.on('end', () => {
          const isSuccess = (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300;
          webhook.lastTriggeredAt = new Date().toISOString();
          webhook.lastStatus = res.statusCode;
          webhook.lastError = isSuccess ? undefined : `HTTP Status ${res.statusCode}: ${resData.slice(0, 200)}`;
          saveDbSync();
          done({ success: isSuccess, statusCode: res.statusCode });
        });
      });

      req.on('error', (err) => { done(fail(err.message)); });

      req.on('timeout', () => {
        req.destroy();
        done(fail('Request timed out after 10000ms', 408));
      });

      req.write(payloadString);
      req.end();
    } catch (err: any) {
      resolve(fail(err.message));
    }
  });
}
