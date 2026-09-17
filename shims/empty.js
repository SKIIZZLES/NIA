// Empty shim for Node-only modules (ws, zlib) that must not load in React Native.
module.exports = function EmptyShim() {};
module.exports.default = module.exports;
