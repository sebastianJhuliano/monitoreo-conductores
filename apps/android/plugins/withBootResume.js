const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RECEIVER_CLASS = 'com.monitoreo.conductores.BootResumeReceiver';

const RECEIVER_KOTLIN = `package com.monitoreo.conductores

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Se dispara cuando el teléfono termina de prender (BOOT_COMPLETED).
// Abre la app para que reanude la transmisión sola si estaba activa.
class BootResumeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
        intent.action != "android.intent.action.QUICKBOOT_POWERON") {
      return
    }
    try {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(launch)
    } catch (e: Exception) {
      // si falla, que el usuario abra la app manualmente
    }
  }
}
`;

function addManifestEntries(manifest) {
  const app = manifest.manifest.application && manifest.manifest.application[0];
  if (!app) throw new Error('withBootResume: no application node in manifest');

  const perms = manifest.manifest['uses-permission'] || [];
  const hasPerm = perms.some(
    (p) => p.$ && p.$['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED',
  );
  if (!hasPerm) {
    perms.push({ $: { 'android:name': 'android.permission.RECEIVE_BOOT_COMPLETED' } });
  }
  manifest.manifest['uses-permission'] = perms;

  const receivers = app['receiver'] || [];
  const hasReceiver = receivers.some((r) => r.$ && r.$['android:name'] === RECEIVER_CLASS);
  if (!hasReceiver) {
    receivers.push({
      $: { 'android:name': RECEIVER_CLASS, 'android:exported': 'true', 'android:enabled': 'true' },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
          ],
        },
      ],
    });
  }
  app['receiver'] = receivers;

  return manifest;
}

module.exports = function withBootResume(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = addManifestEntries(cfg.modResults);
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/monitoreo/conductores',
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'BootResumeReceiver.kt'), RECEIVER_KOTLIN);
      return cfg;
    },
  ]);

  return config;
};