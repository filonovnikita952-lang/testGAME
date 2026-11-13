const { test } = require('node:test');
const assert = require('node:assert/strict');
global.document = { hidden: false };
require('../static/polling.js');

test('HTTP/network/JSON failures back off, cap at 60s, success resets cadence', async () => {
    let clock = 0, calls = 0, mode = 'http';
    const refresh = createPollRefresh(5000, { now: () => clock, fetcher: async () => {
        calls++;
        if (mode === 'network') throw new Error('offline');
        return { ok: mode !== 'http', status: 500, json: async () => {
            if (mode === 'json') throw new Error('bad json');
            return { ok: true };
        } };
    }});
    await refresh('/status'); assert.equal(calls, 1);
    clock = 9999; await refresh('/status'); assert.equal(calls, 1);
    clock = 10000; mode = 'network'; await refresh('/status'); assert.equal(calls, 2);
    clock = 29999; await refresh('/status'); assert.equal(calls, 2);
    clock = 30000; mode = 'json'; await refresh('/status'); assert.equal(calls, 3);
    clock = 70000; mode = 'http'; await refresh('/status'); assert.equal(calls, 4);
    clock = 129999; await refresh('/status'); assert.equal(calls, 4);
    clock = 130000; mode = 'ok'; assert.deepEqual(await refresh('/status'), {ok:true});
    clock += 5000; await refresh('/status'); assert.equal(calls, 6);
    mode = 'http'; await refresh('/status'); assert.equal(calls, 7);
    clock += 9999; await refresh('/status'); assert.equal(calls, 7);
    clock += 1; await refresh('/status'); assert.equal(calls, 8);
});

test('hidden tabs and concurrent refreshes do not issue requests', async () => {
    let calls = 0, resolve;
    const refresh = createPollRefresh(5000, {fetcher: () => {
        calls++;
        return new Promise(done => { resolve = done; });
    }});
    document.hidden = true;
    await refresh('/status'); assert.equal(calls, 0);
    document.hidden = false;
    const first = refresh('/status');
    await refresh('/status'); assert.equal(calls, 1);
    resolve({ok: true, json: async () => ({})}); await first;
});
