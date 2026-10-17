/**
 * Network safety helpers. Configuration is admin-controlled, but the Worker must never be
 * able to be pointed at loopback, private, link-local, or reserved addresses.
 */

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value < 0 || value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
}

function isPrivateOrReservedIPv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function stripAddressDecoration(address: string): string {
  let host = address.trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) {
      host = host.slice(1, end);
    }
  } else if ((host.match(/:/g) ?? []).length === 1) {
    const index = host.lastIndexOf(':');
    if (/^\d+$/.test(host.slice(index + 1))) {
      host = host.slice(0, index);
    }
  }
  return host.replace(/%.*$/, '').toLowerCase();
}

function ipv4FromHexGroups(groups: string[]): string | null {
  if (groups.length !== 4 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  const values = groups.map((group) => Number.parseInt(group, 16));
  return values.map((value) => `${value >> 8}.${value & 0xff}`).join('.');
}

function isPrivateOrReservedIPv6(host: string): boolean {
  if (host === '::' || host === '::1') {
    return true;
  }
  if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^ff/.test(host)) {
    return true;
  }
  if (host.startsWith('2001:db8') || host.startsWith('2001:0db8')) {
    return true;
  }

  const mapped = host.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1]!;
    if (tail.includes('.')) {
      const octets = parseIPv4(tail);
      return !octets || isPrivateOrReservedIPv4(octets);
    }
    const octets = ipv4FromHexGroups(tail.split(':'));
    return octets === null || isPrivateOrReservedIPv4(parseIPv4(octets)!);
  }

  const nat64 = host.match(/^64:ff9b::(.+)$/);
  if (nat64 && nat64[1]!.includes('.')) {
    const octets = parseIPv4(nat64[1]!);
    return !octets || isPrivateOrReservedIPv4(octets);
  }

  return false;
}

/** True for loopback, private, link-local, multicast, documentation, and other reserved IPs. */
export function isPrivateAddress(address: string): boolean {
  const host = stripAddressDecoration(address);
  if (host === '') {
    return true;
  }
  const octets = parseIPv4(host);
  if (octets) {
    return isPrivateOrReservedIPv4(octets);
  }
  if (host.includes(':')) {
    return isPrivateOrReservedIPv6(host);
  }
  return false;
}

const RESERVED_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'lan',
  'home.arpa',
  'test',
  'invalid',
  'example',
  'onion',
];

/**
 * Validates a host before any socket or HTTP request is opened. Accepts only public
 * hostnames and public IP literals; rejects schemes, credentials, ports, and reserved names.
 */
export function assertSafeHost(rawHost: string): string {
  const host = rawHost.trim().replace(/\.$/, '');
  if (host === '') {
    throw new Error('host is empty');
  }
  if (host.length > 253) {
    throw new Error('host is too long');
  }
  if (/[\s\u0000-\u001f\u007f/\\@?#]/.test(host) || host.includes('://')) {
    throw new Error(`invalid host: ${rawHost}`);
  }

  const ipv4 = parseIPv4(host);
  if (ipv4) {
    if (isPrivateOrReservedIPv4(ipv4)) {
      throw new Error(`refusing private or reserved address: ${host}`);
    }
    return host;
  }
  if (/^[\d.]+$/.test(host)) {
    throw new Error(`invalid IPv4 address: ${host}`);
  }

  if (host.includes(':')) {
    if (!/^[0-9a-f:]+$/i.test(host) || host.split(':').length < 3) {
      throw new Error(`invalid IPv6 address: ${host}`);
    }
    if (isPrivateOrReservedIPv6(host.toLowerCase())) {
      throw new Error(`refusing private or reserved address: ${host}`);
    }
    return host;
  }

  const lower = host.toLowerCase();
  if (!lower.includes('.')) {
    throw new Error(`refusing single-label hostname: ${host}`);
  }
  for (const label of lower.split('.')) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      throw new Error(`invalid hostname label in ${host}`);
    }
  }
  if (RESERVED_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`))) {
    throw new Error(`refusing reserved hostname: ${host}`);
  }
  return lower;
}

export function assertTelegramApiUrl(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new Error('Telegram API must be called over HTTPS');
  }
  if (url.hostname !== 'api.telegram.org') {
    throw new Error('unexpected Telegram API host');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('credentials are not allowed in the Telegram API URL');
  }
  if (url.port !== '' && url.port !== '443') {
    throw new Error('unexpected Telegram API port');
  }
}
