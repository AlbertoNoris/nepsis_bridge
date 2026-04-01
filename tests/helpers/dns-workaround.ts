/**
 * DNS workaround for macOS iCloud Private Relay.
 *
 * The system DNS (getaddrinfo) can't resolve nepsis.stolenorbit.com when
 * iCloud Private Relay is active. We use dns.resolve4() with Google DNS
 * (8.8.8.8) instead, then monkey-patch dns.lookup to return the resolved IP.
 */

import dns from 'dns';

const RELAY_HOST = 'nepsis.stolenorbit.com';
const FALLBACK_DNS = ['8.8.8.8', '8.8.4.4'];

/**
 * Pre-resolve the relay hostname via Google DNS and monkey-patch dns.lookup
 * so all subsequent WebSocket connections resolve correctly.
 * Call once in beforeAll.
 */
export async function patchDnsForRelay(): Promise<void> {
  // Check if system DNS already works
  const systemWorks = await new Promise<boolean>((resolve) => {
    dns.lookup(RELAY_HOST, { family: 4 }, (err, address) => {
      resolve(!err && !!address);
    });
  });

  if (systemWorks) return;

  // Resolve via Google DNS
  const resolver = new dns.Resolver();
  resolver.setServers(FALLBACK_DNS);

  const ip = await new Promise<string>((resolve, reject) => {
    resolver.resolve4(RELAY_HOST, (err, addresses) => {
      if (err || !addresses.length) reject(err || new Error('No addresses found'));
      else resolve(addresses[0]);
    });
  });

  // Monkey-patch dns.lookup to intercept the relay hostname.
  // dns.lookup signatures: (hostname, cb) | (hostname, options, cb)
  // When options.all is true, callback expects (err, [{address, family}])
  // When options.all is false/absent, callback expects (err, address, family)
  const originalLookup = dns.lookup;
  (dns as any).lookup = function patchedLookup(
    hostname: string,
    optionsOrCb: any,
    maybeCb?: any,
  ) {
    const cb = typeof maybeCb === 'function' ? maybeCb : optionsOrCb;
    const opts = typeof optionsOrCb === 'object' ? optionsOrCb : {};

    if (hostname === RELAY_HOST && typeof cb === 'function') {
      if (opts.all) {
        return process.nextTick(cb, null, [{ address: ip, family: 4 }]);
      }
      return process.nextTick(cb, null, ip, 4);
    }

    return (originalLookup as any).call(dns, hostname, optionsOrCb, maybeCb);
  };
}
