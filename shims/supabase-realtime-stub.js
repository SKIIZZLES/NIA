/**
 * No-op stub for @supabase/realtime-js.
 * Auth / REST / Storage keep working; realtime is intentionally disabled for Expo Go MVP
 * so Metro never resolves nested Node `ws` → `stream`.
 */
'use strict';

function noop() {}

function stubChannel() {
  const ch = {
    topic: '',
    params: {},
    state: 'closed',
    subscribe(cb) {
      if (typeof cb === 'function') {
        try {
          cb('SUBSCRIBED');
        } catch (_) {}
      }
      return ch;
    },
    unsubscribe() {
      return Promise.resolve('ok');
    },
    on() {
      return ch;
    },
    off() {
      return ch;
    },
    send() {
      return Promise.resolve('ok');
    },
    track() {
      return Promise.resolve('ok');
    },
    untrack() {
      return Promise.resolve('ok');
    },
  };
  return ch;
}

class RealtimeClient {
  constructor(_url, _options) {
    this.channels = [];
    this.accessTokenValue = null;
  }
  connect() {}
  disconnect() {}
  endpointURL() {
    return '';
  }
  channel(_topic, _params) {
    return stubChannel();
  }
  getChannels() {
    return this.channels.slice();
  }
  removeChannel(_channel) {
    return Promise.resolve('ok');
  }
  removeAllChannels() {
    this.channels = [];
    return Promise.resolve([]);
  }
  setAuth(_token) {
    this.accessTokenValue = _token == null ? null : _token;
  }
  connectionState() {
    return 'closed';
  }
  isConnected() {
    return false;
  }
}

class RealtimeChannel {
  constructor() {
    Object.assign(this, stubChannel());
  }
  subscribe(cb) {
    return stubChannel().subscribe(cb);
  }
  unsubscribe() {
    return Promise.resolve('ok');
  }
  on() {
    return this;
  }
  send() {
    return Promise.resolve('ok');
  }
}

class RealtimePresence {
  constructor() {
    this.state = {};
    this.onJoin = noop;
    this.onLeave = noop;
    this.onSync = noop;
  }
}

const REALTIME_POSTGRES_CHANGES_LISTEN_EVENT = {
  ALL: '*',
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
};

const REALTIME_LISTEN_TYPES = {
  BROADCAST: 'broadcast',
  PRESENCE: 'presence',
  POSTGRES_CHANGES: 'postgres_changes',
  SYSTEM: 'system',
};

const REALTIME_SUBSCRIBE_STATES = {
  SUBSCRIBED: 'SUBSCRIBED',
  TIMED_OUT: 'TIMED_OUT',
  CLOSED: 'CLOSED',
  CHANNEL_ERROR: 'CHANNEL_ERROR',
};

const REALTIME_CHANNEL_STATES = {
  closed: 'closed',
  errored: 'errored',
  joined: 'joined',
  joining: 'joining',
  leaving: 'leaving',
};

const REALTIME_PRESENCE_LISTEN_EVENTS = {
  SYNC: 'sync',
  JOIN: 'join',
  LEAVE: 'leave',
};

module.exports = {
  RealtimeClient,
  RealtimeChannel,
  RealtimePresence,
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  REALTIME_SUBSCRIBE_STATES,
  REALTIME_CHANNEL_STATES,
  REALTIME_PRESENCE_LISTEN_EVENTS,
};
module.exports.default = module.exports;
