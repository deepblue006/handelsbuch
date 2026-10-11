/**
 * Einstellungen in der Datenbank (Tabelle Setting), validiert mit Zod; fehlende Werte = Startwerte.
 */
import { prisma } from "./db";
import { RuleConfigSchema, ScoreWeightsSchema, GeneralSettingsSchema, type RuleConfig, type ScoreWeights, type GeneralSettings } from "./rules/config";

async function read<T>(key: string, schema: { parse: (v: unknown) => T }): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  try {
    return schema.parse(row?.value ?? {});
  } catch {
    return schema.parse({});
  }
}

export const getRuleConfig = (): Promise<RuleConfig> => read("rules", RuleConfigSchema);
export const getScoreWeights = (): Promise<ScoreWeights> => read("scoreWeights", ScoreWeightsSchema);
export const getGeneral = (): Promise<GeneralSettings> => read("general", GeneralSettingsSchema);

export async function saveSetting(key: "rules" | "scoreWeights" | "general", value: unknown) {
  const schema = key === "rules" ? RuleConfigSchema : key === "scoreWeights" ? ScoreWeightsSchema : GeneralSettingsSchema;
  const parsed = schema.parse(value);
  await prisma.setting.upsert({ where: { key }, create: { key, value: parsed as object }, update: { value: parsed as object } });
  return parsed;
}

/** "Heute" als ISO-Datum in der konfigurierten Zeitzone. */
export function todayIso(tz = "Europe/Berlin", now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
