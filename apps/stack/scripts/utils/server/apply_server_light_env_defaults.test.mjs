import assert from 'node:assert/strict';
import test from 'node:test';

import { applyServerLightEnvDefaults } from './apply_server_light_env_defaults.mjs';

test('applyServerLightEnvDefaults expands ~/ light-server path overrides against HOME', () => {
  const serverEnv = {};

  applyServerLightEnvDefaults({
    baseEnv: {
      HOME: '/scoped/home',
      HAPPIER_SERVER_LIGHT_DATA_DIR: '~/server-light',
      HAPPIER_SERVER_LIGHT_FILES_DIR: '~/server-light/files-override',
      HAPPIER_SERVER_LIGHT_DB_DIR: '~/server-light/db-override',
    },
    serverEnv,
    baseDir: '/stack/base',
  });

  assert.deepEqual(serverEnv, {
    HAPPIER_SERVER_LIGHT_DATA_DIR: '/scoped/home/server-light',
    HAPPIER_SERVER_LIGHT_FILES_DIR: '/scoped/home/server-light/files-override',
    HAPPIER_SERVER_LIGHT_DB_DIR: '/scoped/home/server-light/db-override',
  });
});
