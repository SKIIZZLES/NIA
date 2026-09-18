/**
 * Optional native stub for @supabase/supabase-js + realtime.
 * NOT wired by metro.config.js anymore (EAS needs the real client).
 * Kept for emergency/manual Metro override only.
 */
'use strict';

var DISABLED = new Error(
  'Supabase JS désactivé sur Expo Go — utilise le web ou un build natif'
);

function emptyResult() {
  return Promise.resolve({ data: null, error: null, count: null, status: 200, statusText: 'OK' });
}

function emptyList() {
  return Promise.resolve({ data: [], error: null, count: 0, status: 200, statusText: 'OK' });
}

function queryBuilder() {
  var q = {
    select: function () { return q; },
    insert: function () { return q; },
    update: function () { return q; },
    upsert: function () { return q; },
    delete: function () { return q; },
    eq: function () { return q; },
    neq: function () { return q; },
    gt: function () { return q; },
    gte: function () { return q; },
    lt: function () { return q; },
    lte: function () { return q; },
    like: function () { return q; },
    ilike: function () { return q; },
    is: function () { return q; },
    in: function () { return q; },
    contains: function () { return q; },
    containedBy: function () { return q; },
    range: function () { return q; },
    order: function () { return q; },
    limit: function () { return q; },
    single: function () { return emptyResult(); },
    maybeSingle: function () { return emptyResult(); },
    then: function (resolve, reject) {
      return emptyList().then(resolve, reject);
    },
  };
  return q;
}

function storageBucket() {
  return {
    upload: function () {
      return Promise.reject(DISABLED);
    },
    download: function () {
      return Promise.reject(DISABLED);
    },
    remove: function () {
      return Promise.resolve({ data: [], error: null });
    },
    list: function () {
      return Promise.resolve({ data: [], error: null });
    },
    getPublicUrl: function (path) {
      return { data: { publicUrl: '' } };
    },
  };
}

function createClient(_url, _key, _opts) {
  return {
    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: null }, error: null });
      },
      getUser: function () {
        return Promise.resolve({ data: { user: null }, error: null });
      },
      onAuthStateChange: function (_cb) {
        return {
          data: {
            subscription: {
              unsubscribe: function () {},
            },
          },
        };
      },
      signInWithPassword: function () {
        return Promise.reject(DISABLED);
      },
      signUp: function () {
        return Promise.reject(DISABLED);
      },
      signOut: function () {
        return Promise.resolve({ error: null });
      },
      setSession: function () {
        return Promise.resolve({ data: { session: null, user: null }, error: null });
      },
    },
    from: function (_table) {
      return queryBuilder();
    },
    storage: {
      from: function (_bucket) {
        return storageBucket();
      },
    },
    channel: function () {
      return {
        on: function () { return this; },
        subscribe: function (cb) {
          if (typeof cb === 'function') {
            try { cb('SUBSCRIBED'); } catch (_) {}
          }
          return this;
        },
        unsubscribe: function () {
          return Promise.resolve('ok');
        },
      };
    },
    removeChannel: function () {
      return Promise.resolve('ok');
    },
    removeAllChannels: function () {
      return Promise.resolve([]);
    },
    realtime: {
      connect: function () {},
      disconnect: function () {},
      setAuth: function () {},
    },
  };
}

function RealtimeClient() {
  this.channels = [];
}
RealtimeClient.prototype.connect = function () {};
RealtimeClient.prototype.disconnect = function () {};
RealtimeClient.prototype.channel = function () {
  return {
    subscribe: function () { return this; },
    unsubscribe: function () { return Promise.resolve('ok'); },
    on: function () { return this; },
  };
};
RealtimeClient.prototype.setAuth = function () {};

module.exports = {
  createClient: createClient,
  RealtimeClient: RealtimeClient,
  RealtimeChannel: function () {},
  RealtimePresence: function () {},
  SupabaseClient: function () {},
};
module.exports.default = module.exports;
