'use strict';
// Sends task events to other apps (outbound webhooks), signed with HMAC-SHA256.
const crypto = require('crypto');
const S = require('../public/js/shared.js');

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

class WebhookDispatcher {
  constructor(store, { retryDelays = [2000, 10000, 60000], timeoutMs = 8000, log = () => {} } = {}) {
    this.store = store;
    this.retryDelays = retryDelays;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.timers = new Set();
  }

  dispatch(event, data) {
    for (const wh of this.store.db.webhooks) {
      if (!wh.active) continue;
      if (!wh.events.includes('*') && !wh.events.includes(event)) continue;
      this.deliver(wh, { id: S.uid('evt_'), event, createdAt: new Date().toISOString(), data }, 0);
    }
  }

  async deliver(wh, payload, attempt) {
    const body = JSON.stringify(payload);
    let status = null;
    let error = null;
    try {
      const res = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `X10Tasks-Webhook/${S.VERSION}`,
          'X-X10-Event': payload.event,
          'X-X10-Delivery': payload.id,
          'X-X10-Signature': sign(wh.secret, body),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e.name === 'TimeoutError' ? 'Timed out' : e.message;
    }
    wh.lastDeliveryAt = new Date().toISOString();
    wh.lastStatus = status;
    wh.lastError = error;
    this.store.save();
    if (error) {
      this.log(`webhook ${wh.id} ${payload.event} failed (attempt ${attempt + 1}): ${error}`);
      if (attempt < this.retryDelays.length) {
        const t = setTimeout(() => {
          this.timers.delete(t);
          const current = this.store.db.webhooks.find((w) => w.id === wh.id);
          if (current && current.active) this.deliver(current, payload, attempt + 1);
        }, this.retryDelays[attempt]);
        this.timers.add(t);
      }
    }
    return { status, error };
  }

  close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

module.exports = { WebhookDispatcher, sign };
