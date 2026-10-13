/** Leert alle Tabellen – NUR für Datenbanken, deren Name auf "_test" endet. */
import { prisma } from "../src/lib/db";

async function main() {
  const name = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Abbruch: „${name}“ ist keine Testdatenbank (_test).`);
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
  console.log(`Testdatenbank ${name} geleert (${tables.length} Tabellen).`);
}
main().finally(() => prisma.$disconnect());
