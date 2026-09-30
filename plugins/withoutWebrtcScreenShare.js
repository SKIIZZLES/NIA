/**
 * Retire le service de partage d'écran de react-native-webrtc.
 *
 * `@livekit/react-native-webrtc` déclare `com.oney.WebRTCModule.MediaProjectionService`
 * (service de premier plan, type mediaProjection) et la permission
 * FOREGROUND_SERVICE. NIA ne partage jamais l'écran : le live filme la caméra,
 * app au premier plan (L1). Garder ce service exposerait l'app aux exigences
 * Play Store sur les services de premier plan sans aucun usage. On le retire
 * du manifeste fusionné (tools:node="remove") ; FOREGROUND_SERVICE est bloquée
 * dans app.json (android.blockedPermissions).
 *
 * À revoir si un jour on diffuse en arrière-plan ou l'écran (L5).
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SERVICE = 'com.oney.WebRTCModule.MediaProjectionService';

module.exports = function withoutWebrtcScreenShare(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const services = (app.service || []).filter(
      (s) => !(s && s.$ && s.$['android:name'] === SERVICE),
    );
    services.push({ $: { 'android:name': SERVICE, 'tools:node': 'remove' } });
    app.service = services;
    return cfg;
  });
};
