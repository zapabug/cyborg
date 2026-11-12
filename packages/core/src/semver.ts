// MOD-11: the small range grammar the module manifest uses; no semver dependency (AGENTS.md).

export type Version = [number, number, number];

export function parseVersion(text: string): Version {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!m) throw new Error(`"${text}" is not a version like 1.2.3`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}

/** True if `version` satisfies every comparator in `range` (`>=1.0.0 <2.0.0`, `^0.1.0`, `=1.2.3`, `*`). */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  const parts = range.trim().split(/\s+/);
  if (parts.length === 1 && parts[0] === '*') return true;
  return parts.every((part) => {
    const m = /^(>=|<=|>|<|=|\^)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!m) throw new Error(`"${part}" is not a comparator (>=, >, <=, <, =, ^ and x.y.z)`);
    const target = parseVersion(m[2]!);
    const c = compareVersions(v, target);
    switch (m[1] ?? '=') {
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
      case '=': return c === 0;
      case '^': {
        // Same left-most non-zero part, not below the target.
        const upper: Version = target[0] > 0 ? [target[0] + 1, 0, 0] : target[1] > 0 ? [0, target[1] + 1, 0] : [0, 0, target[2] + 1];
        return c >= 0 && compareVersions(v, upper) < 0;
      }
      default: return false;
    }
  });
}

export function isValidRange(range: string): boolean {
  try {
    satisfies('0.0.0', range);
    return true;
  } catch {
    return false;
  }
}
