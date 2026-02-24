/**
 * Generate a unique device fingerprint for device limit tracking.
 * Uses localStorage to persist across sessions.
 */
const STORAGE_KEY = 'aibt_device_id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'unknown';
  
  let stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;

  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
  ].join('|');

  // Simple hash for fingerprint
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const deviceId = `aibt_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
  localStorage.setItem(STORAGE_KEY, deviceId);
  return deviceId;
}
