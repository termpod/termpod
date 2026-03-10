// Module-level storage for the local auth secret, shared by useLocalServer and useDeviceWS.
// Extracted to its own module to avoid circular imports.

let _localAuthSecret: string | null = null;

export function getLocalAuthSecret(): string | null {
  return _localAuthSecret;
}

export function setLocalAuthSecret(secret: string): void {
  _localAuthSecret = secret;
}
