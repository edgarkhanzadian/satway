import { FAVICON_URL } from '../config.js';
import type { World } from '../world/world.js';
import type { BrowserEvent, Harness, NetworkEntry } from './harness.js';

export interface Allowances {
  hosts: readonly string[];
  consoleErrors: readonly RegExp[];
  worldUnexpected: readonly RegExp[];
}

export const NO_ALLOWANCES: Allowances = { hosts: [], consoleErrors: [], worldUnexpected: [] };

export interface Violations {
  blockedRequests: NetworkEntry[];
  cspViolations: unknown[];
  corsFailures: BrowserEvent[];
  pageErrors: BrowserEvent[];
  consoleErrors: BrowserEvent[];
  worldUnexpected: string[];
  realNodeFetches: string[];
}

export const NO_VIOLATIONS: Violations = {
  blockedRequests: [],
  cspViolations: [],
  corsFailures: [],
  pageErrors: [],
  consoleErrors: [],
  worldUnexpected: [],
  realNodeFetches: [],
};

const NOT_FOUND = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

const EXPECTED_NOT_FOUND: readonly RegExp[] = [
  new RegExp(`^${FAVICON_URL.replaceAll('.', '\\.')}$`),
  /^https:\/\/sbtc-emily\.com\/deposit\/[0-9a-f]{64}\/\d+$/,
];

function allowedConsole(event: BrowserEvent, allow: Allowances): boolean {
  const url = event.url;
  if (event.text === NOT_FOUND && url !== undefined && EXPECTED_NOT_FOUND.some(p => p.test(url)))
    return true;
  return allow.consoleErrors.some(pattern => pattern.test(event.text));
}

export function collectViolations(
  harness: Harness,
  world: World,
  realNodeFetches: readonly string[],
  allow: Allowances
): Violations {
  return {
    blockedRequests: harness.blocked.filter(e => !allow.hosts.some(h => e.url.startsWith(h))),
    cspViolations: harness.csp.map(c => c.detail),
    corsFailures: [...harness.cors],
    pageErrors: [...harness.pageErrors],
    consoleErrors: harness.consoleErrors.filter(
      e => !allowedConsole(e, allow) && !harness.consoleAllowances.some(p => p.test(e.text))
    ),
    worldUnexpected: world.unexpected.filter(u => !allow.worldUnexpected.some(p => p.test(u))),
    realNodeFetches: [...realNodeFetches],
  };
}
