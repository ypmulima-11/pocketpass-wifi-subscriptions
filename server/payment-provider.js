import crypto from 'node:crypto';

// Provider-specific API versions, request signing and callback verification
// vary by merchant product. Keep those details isolated here; do not trust the
// browser's claim that a payment succeeded.
export class PaymentProvider {
  async startPush(_payment) {
    throw new Error('Payment provider is not configured');
  }
  verifyWebhook(_rawBody, _headers) {
    return false;
  }
  parseWebhook(_body) {
    throw new Error('Payment provider is not configured');
  }
}

export class MockPaymentProvider extends PaymentProvider {
  async startPush(payment) {
    return { reference: payment.provider_tx_id, message: 'Demo prompt created. Use the demo confirmation action.' };
  }
  verifyWebhook(rawBody, headers) {
    const received = headers['x-demo-signature'];
    if (typeof received !== 'string') return false;
    const expected = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest();
    let candidate;
    try { candidate = Buffer.from(received, 'hex'); } catch { return false; }
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }
  parseWebhook(body) { return body; }
}

export function getPaymentProvider() {
  if (process.env.PAYMENT_DRIVER === 'mock' && process.env.NODE_ENV !== 'production') return new MockPaymentProvider();
  return new PaymentProvider();
}
