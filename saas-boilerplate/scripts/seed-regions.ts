/**
 * Region seed script — idempotent.
 *
 *   pnpm db:seed-regions
 *
 * Defines the canonical North American wilderness regions used by the
 * Wilderness Intelligence product. Safe to re-run; each region is upserted
 * by `slug`. Edit the catalog below to add/rename regions per product.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";

interface RegionSeed {
  slug: string;
  name: string;
  description: string;
  accentColor: string;
  boundingBox: { north: number; south: number; east: number; west: number };
  displayOrder: number;
}

const SEED: RegionSeed[] = [
  {
    slug: "pacific-northwest",
    name: "Pacific Northwest",
    description: "Temperate rainforests, volcanoes, and rugged Pacific coastline from northern California to British Columbia.",
    accentColor: "#2f6a3d",
    boundingBox: { north: 55, south: 40, east: -116, west: -125 },
    displayOrder: 10,
  },
  {
    slug: "rocky-mountains",
    name: "Rocky Mountains",
    description: "Continental spine of high peaks, alpine lakes, and montane forests from New Mexico to British Columbia.",
    accentColor: "#7a5a3a",
    boundingBox: { north: 56, south: 32, east: -104, west: -118 },
    displayOrder: 20,
  },
  {
    slug: "sierra-nevada",
    name: "Sierra Nevada",
    description: "Granite ranges, sequoia groves, and alpine basins running along the California–Nevada border.",
    accentColor: "#8a8a3d",
    boundingBox: { north: 41, south: 35, east: -118, west: -121 },
    displayOrder: 30,
  },
  {
    slug: "desert-southwest",
    name: "Desert Southwest",
    description: "Arid basin-and-range and slickrock country across Arizona, Utah, Nevada, and southeastern California.",
    accentColor: "#c87a3a",
    boundingBox: { north: 42, south: 28, east: -103, west: -119 },
    displayOrder: 40,
  },
  {
    slug: "great-basin",
    name: "Great Basin",
    description: "Cold high-altitude desert of internally-drained valleys and isolated mountain ranges.",
    accentColor: "#a37a4a",
    boundingBox: { north: 43, south: 35, east: -110, west: -120 },
    displayOrder: 50,
  },
  {
    slug: "appalachians",
    name: "Appalachians",
    description: "Ancient eroded mountains and hardwood forests stretching from Alabama to Newfoundland.",
    accentColor: "#3a5a2f",
    boundingBox: { north: 50, south: 33, east: -74, west: -88 },
    displayOrder: 60,
  },
  {
    slug: "great-lakes",
    name: "Great Lakes & Northwoods",
    description: "Glacial lake country, boreal–temperate transition forests, and northern hardwood swamps.",
    accentColor: "#3a6a8a",
    boundingBox: { north: 50, south: 41, east: -76, west: -97 },
    displayOrder: 70,
  },
  {
    slug: "boreal-forest",
    name: "Canadian Boreal",
    description: "Vast spruce, fir, and birch forest belt across interior Canada and Alaska.",
    accentColor: "#1f4a3a",
    boundingBox: { north: 70, south: 49, east: -55, west: -141 },
    displayOrder: 80,
  },
  {
    slug: "coastal-plains",
    name: "Atlantic & Gulf Coastal Plains",
    description: "Pine flatwoods, cypress swamps, and barrier-island ecosystems from Texas to New Jersey.",
    accentColor: "#6a8a4a",
    boundingBox: { north: 40, south: 25, east: -75, west: -98 },
    displayOrder: 90,
  },
  {
    slug: "subtropical-florida",
    name: "Subtropical Florida",
    description: "Everglades, mangrove coasts, pine rocklands, and tropical hardwood hammocks.",
    accentColor: "#3a8a6a",
    boundingBox: { north: 30, south: 24, east: -80, west: -88 },
    displayOrder: 100,
  },
];

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED is required.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  try {
    for (const r of SEED) {
      await db
        .insert(schema.regions)
        .values({
          slug: r.slug,
          name: r.name,
          description: r.description,
          accentColor: r.accentColor,
          boundingBox: r.boundingBox,
          displayOrder: r.displayOrder,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.regions.slug,
          set: {
            name: r.name,
            description: r.description,
            accentColor: r.accentColor,
            boundingBox: r.boundingBox,
            displayOrder: r.displayOrder,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }
    const result = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM regions`,
    );
    const count = result.rows[0]?.count ?? 0;
    console.log(`Region seed complete — ${count} active regions in catalog.`);
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
