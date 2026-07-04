// Generates slightly-varied names/tickers for spam pairs so they're recognizable
// but not identical — e.g. from "BULLPOST": bulpost, bul pst, post, bullp0st,
// Bull Post. Keeps the same vibe without a clean string linking the pairs.

const randInt = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[randInt(a.length)];

function dropAVowel(s: string): string {
  const idxs = [...s].map((c, i) => ('aeiou'.includes(c) ? i : -1)).filter((i) => i >= 0);
  if (idxs.length < 2) return s; // keep it readable
  const d = pick(idxs);
  return s.slice(0, d) + s.slice(d + 1);
}

function insertSpace(s: string): string {
  if (s.length < 4) return s;
  const at = 2 + randInt(s.length - 3);
  return (s.slice(0, at) + ' ' + s.slice(at)).replace(/ +/g, ' ');
}

function truncate(s: string): string {
  if (s.length <= 3) return s;
  return s.slice(0, 3 + randInt(s.length - 3));
}

const leet = (s: string): string => s.replace(/o/g, '0').replace(/s/g, '5').replace(/i/g, '1');
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Produce a varied {name, symbol} from a base like "BULLPOST". Applies one or
 * two random transforms (drop a letter, add a space, truncate, leetify, recase)
 * so no two launches read exactly the same.
 */
export function varyName(base: string): { name: string; symbol: string } {
  const clean = base.toLowerCase().replace(/[^a-z0-9]/g, '') || 'coin';
  const transforms: ((s: string) => string)[] = [
    (s) => s,
    dropAVowel,
    insertSpace,
    truncate,
    leet,
    (s) => s.toUpperCase(),
    cap,
  ];
  let name = clean;
  const rounds = 1 + randInt(2);
  for (let i = 0; i < rounds; i++) name = pick(transforms)(name);
  name = name.trim().slice(0, 32);
  if (name.replace(/\s/g, '').length < 2) name = clean; // guard against over-mangling

  const symbol = (name.replace(/[^a-z0-9]/gi, '') || clean).toUpperCase().slice(0, 10);
  return { name, symbol };
}
