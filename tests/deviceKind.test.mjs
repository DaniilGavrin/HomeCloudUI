import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf } from '../src/components/devices/deviceKind.ts';

test('recognizes canonical and legacy TV client types', () => {
  for (const type of [
    'tv', 'TV', ' television ', 'android-tv', 'android_tv', 'androidtv',
    'homecloud-tv-player', 'smart-tv', 'smarttv', 'tvplayer',
    'tizen', 'webos', 'web-os', 'player.tv',
  ]) {
    assert.equal(kindOf(type), 'tv', `Expected television for ${type}`);
  }
});

test('does not accidentally classify unrelated types as television', () => {
  for (const type of ['activity', 'connectivity', 'network-activity', 'android', 'mobile', 'desktop', 'backend', 'media_gateway']) {
    assert.notEqual(kindOf(type), 'tv', `Unexpected TV classification for ${type}`);
  }
});

test('keeps mobile, server, desktop and unknown clients distinct', () => {
  assert.equal(kindOf('android'), 'mobile');
  assert.equal(kindOf('android-phone'), 'mobile');
  assert.equal(kindOf('homecloud-storage-agent'), 'server');
  assert.equal(kindOf('media_gateway'), 'server');
  assert.equal(kindOf('windows-desktop'), 'desktop');
  assert.equal(kindOf('mystery-client'), 'other');
  assert.equal(kindOf(''), 'other');
});
