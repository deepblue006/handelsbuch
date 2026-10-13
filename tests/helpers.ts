import fs from "node:fs";
import path from "node:path";

export const SNAP = path.resolve(__dirname, "../data/snapshots/alphavantage");
export function loadSnapshot(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(SNAP, name), "utf8"));
}
