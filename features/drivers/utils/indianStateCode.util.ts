export type IndianStateLabel = {
  /** Display name, upper-cased (e.g. "TAMIL NADU"). */
  name: string;
  /** Two-letter code (e.g. "TN"). */
  code: string;
};

const STATE_CODES: Record<string, string> = {
  andhrapradesh: "AP",
  arunachalpradesh: "AR",
  assam: "AS",
  bihar: "BR",
  chhattisgarh: "CG",
  goa: "GA",
  gujarat: "GJ",
  haryana: "HR",
  himachalpradesh: "HP",
  jharkhand: "JH",
  karnataka: "KA",
  kerala: "KL",
  madhyapradesh: "MP",
  maharashtra: "MH",
  manipur: "MN",
  meghalaya: "ML",
  mizoram: "MZ",
  nagaland: "NL",
  odisha: "OD",
  orissa: "OD",
  punjab: "PB",
  rajasthan: "RJ",
  sikkim: "SK",
  tamilnadu: "TN",
  telangana: "TG",
  tripura: "TR",
  uttarakhand: "UK",
  uttaranchal: "UK",
  uttarpradesh: "UP",
  westbengal: "WB",
  andamanandnicobarislands: "AN",
  andamanandnicobar: "AN",
  chandigarh: "CH",
  dadraandnagarhavelianddamananddiu: "DD",
  delhi: "DL",
  newdelhi: "DL",
  nctofdelhi: "DL",
  jammuandkashmir: "JK",
  ladakh: "LA",
  lakshadweep: "LD",
  puducherry: "PY",
  pondicherry: "PY",
};

const IGNORED_PARTS = new Set(["india", "bharat", "in"]);

function normalize(part: string): string {
  return part.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
}

function fallbackCode(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * State label for the trailing part of a location ("Mumbai, Maharashtra, India").
 * Unknown names fall back to their initials; empty input returns null.
 */
export function resolveIndianState(secondary: string | null | undefined): IndianStateLabel | null {
  const parts = (secondary ?? "")
    .split(",")
    .map((part) => part.replace(/\d+/g, "").replace(/\s+/g, " ").trim())
    .filter((part) => part && !IGNORED_PARTS.has(normalize(part)));
  if (parts.length === 0) return null;

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const code = STATE_CODES[normalize(parts[i])];
    if (code) return { name: parts[i].toUpperCase(), code };
  }

  const last = parts[parts.length - 1];
  return { name: last.toUpperCase(), code: fallbackCode(last) };
}
