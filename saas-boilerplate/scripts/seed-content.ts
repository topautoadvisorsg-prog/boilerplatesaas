/**
 * Global content seed — populates `global_decks` and `global_cards`.
 *
 *   pnpm db:seed-content
 *   (or: pnpm db:seed-regions && pnpm db:seed-content)
 *
 * Safe to re-run. Decks are upserted by slug; cards are upserted by
 * (global_deck_id, deterministic external_key encoded in payload.key).
 *
 * Edit the catalog below to extend the Wilderness Intelligence library.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

interface SeedCard {
  key: string;
  front: string;
  back: string;
  hints?: string[];
  imageUrl?: string;
  cardType?: "basic" | "image" | "audio" | "cloze";
}

interface SeedDeck {
  slug: string;
  name: string;
  description: string;
  regionSlug: string;
  accessTier: "free" | "pro" | "premium";
  tags: string[];
  coverImageUrl?: string;
  displayOrder: number;
  cards: SeedCard[];
}

const SEED: SeedDeck[] = [
  {
    slug: "pnw-conifers",
    name: "Pacific Northwest Conifers",
    description: "Identify the dominant conifers of the Pacific coastal forest by needle, cone, and bark.",
    regionSlug: "pacific-northwest",
    accessTier: "free",
    tags: ["trees", "identification", "starter"],
    displayOrder: 10,
    cards: [
      {
        key: "douglas-fir",
        front: "Soft, flat needles arranged singly on the twig; cones hang downward with distinctive three-pointed bracts. Which conifer?",
        back: "**Douglas-fir** (_Pseudotsuga menziesii_). The protruding bracts on the cones look like the back legs and tail of a mouse hiding inside.",
        hints: ["Cones hang downward, not upward.", "Bracts look like 'mouse tails'."],
      },
      {
        key: "western-redcedar",
        front: "Flat, scale-like foliage in fan-shaped sprays; fibrous stringy red-brown bark. Which conifer?",
        back: "**Western redcedar** (_Thuja plicata_). Foundational to coastal Indigenous cultures; bark is highly weather-resistant.",
        hints: ["Foliage looks like fans, not needles.", "Bark peels in long vertical strips."],
      },
      {
        key: "sitka-spruce",
        front: "Sharp, square-cross-section needles that roll between fingers; thin, scaly purplish bark; coastal-only. Which conifer?",
        back: "**Sitka spruce** (_Picea sitchensis_). The largest spruce in the world; thrives in the salt-sprayed coastal fog belt.",
        hints: ["Needles painful to grip.", "Almost never found more than 80 km from the coast."],
      },
    ],
  },
  {
    slug: "rocky-mtn-mammals",
    name: "Rocky Mountain Mammals",
    description: "Track, sign, and silhouette ID for charismatic Rocky Mountain wildlife.",
    regionSlug: "rocky-mountains",
    accessTier: "free",
    tags: ["mammals", "tracking"],
    displayOrder: 20,
    cards: [
      {
        key: "elk-track",
        front: "Cloven hoofprint roughly 10 cm long, rounded heart shape, often in muddy meadows above 2000 m. What species?",
        back: "**Elk / Wapiti** (_Cervus canadensis_). Track is noticeably larger than deer; the two hoof halves are more rounded than a moose's.",
        hints: ["Larger than mule deer, smaller than moose.", "Common in subalpine meadows."],
      },
      {
        key: "mountain-goat",
        front: "Square-tipped cloven track on near-vertical talus; white tuft of hair caught in willow. What species?",
        back: "**Mountain goat** (_Oreamnos americanus_). Specialized hooves with rubbery pads and sharp edges grip almost any rock.",
        hints: ["Lives where almost nothing else does.", "Sheds in summer; clumps catch on shrubs."],
      },
    ],
  },
  {
    slug: "desert-southwest-flora",
    name: "Desert Southwest Flora",
    description: "Cacti, succulents, and shrubs of the Mojave, Sonoran, and Chihuahuan deserts.",
    regionSlug: "desert-southwest",
    accessTier: "pro",
    tags: ["plants", "desert"],
    displayOrder: 30,
    cards: [
      {
        key: "saguaro",
        front: "Columnar cactus to 12 m tall with vertical ribs and branching arms above 3 m. Endemic to which desert?",
        back: "**Saguaro** (_Carnegiea gigantea_), endemic to the **Sonoran Desert**. May live 150+ years; first arms appear around age 75.",
        hints: ["Only one of the four North American deserts."],
      },
      {
        key: "creosote",
        front: "Resinous evergreen shrub with small olive-green leaves that smell strongly of rain after a storm. Species?",
        back: "**Creosote bush** (_Larrea tridentata_). Clonal rings can be 11,000+ years old — among the oldest living things on Earth.",
        hints: ["Smells like rain.", "Forms ring-shaped clones."],
      },
    ],
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
    // Resolve region slugs → ids up front.
    const regionRows = await db.select().from(schema.regions);
    const regionBySlug = new Map(regionRows.map((r) => [r.slug, r.id]));

    let decksUpserted = 0;
    let cardsUpserted = 0;

    for (const d of SEED) {
      const regionId = regionBySlug.get(d.regionSlug);
      if (!regionId) {
        console.warn(`Skipping deck "${d.slug}" — region "${d.regionSlug}" not seeded.`);
        continue;
      }

      const [deck] = await db
        .insert(schema.globalDecks)
        .values({
          slug: d.slug,
          name: d.name,
          description: d.description,
          regionId,
          accessTier: d.accessTier,
          tags: d.tags,
          coverImageUrl: d.coverImageUrl ?? null,
          displayOrder: d.displayOrder,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.globalDecks.slug,
          set: {
            name: d.name,
            description: d.description,
            regionId,
            accessTier: d.accessTier,
            tags: d.tags,
            coverImageUrl: d.coverImageUrl ?? null,
            displayOrder: d.displayOrder,
            isActive: true,
            updatedAt: new Date(),
          },
        })
        .returning({ id: schema.globalDecks.id });
      if (!deck) continue;
      decksUpserted++;

      for (let i = 0; i < d.cards.length; i++) {
        const c = d.cards[i]!;
        // Look up by (deck_id, payload->>'key') to make seeding idempotent
        // without polluting the schema with a synthetic column.
        const [existing] = await db
          .select({ id: schema.globalCards.id })
          .from(schema.globalCards)
          .where(
            and(
              eq(schema.globalCards.globalDeckId, deck.id),
              sql`(${schema.globalCards.payload} ->> 'key') = ${c.key}`,
            ),
          )
          .limit(1);

        const values = {
          globalDeckId: deck.id,
          cardType: c.cardType ?? ("basic" as const),
          front: c.front,
          back: c.back,
          imageUrl: c.imageUrl ?? null,
          hints: c.hints ?? [],
          payload: { key: c.key },
          displayOrder: (i + 1) * 10,
          isActive: true,
        };

        if (existing) {
          await db
            .update(schema.globalCards)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(schema.globalCards.id, existing.id));
        } else {
          await db.insert(schema.globalCards).values(values);
        }
        cardsUpserted++;
      }
    }

    console.log(
      `Content seed complete — ${decksUpserted} decks, ${cardsUpserted} cards upserted.`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
