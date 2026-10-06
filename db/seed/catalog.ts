import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '@/db/schema';

export const CATEGORIES = [
  { slug: 'outerwear', name: 'Outerwear', sortOrder: 1,
    description: 'Shells, insulation, and everything between you and the weather.' },
  { slug: 'footwear', name: 'Footwear', sortOrder: 2,
    description: 'Boots and trail runners built for distance.' },
  { slug: 'packs-bags', name: 'Packs & Bags', sortOrder: 3,
    description: 'Carry systems from summit packs to expedition haulers.' },
  { slug: 'shelter-sleep', name: 'Shelter & Sleep', sortOrder: 4,
    description: 'Tents, bags, and pads for a night that counts.' },
  { slug: 'base-layers', name: 'Base Layers & Apparel', sortOrder: 5,
    description: 'Merino and synthetics that keep working when they are wet.' },
  { slug: 'camp-kitchen', name: 'Camp Kitchen', sortOrder: 6,
    description: 'Stoves, cookware, and water treatment.' },
  { slug: 'navigation', name: 'Navigation & Light', sortOrder: 7,
    description: 'Headlamps, compasses, and satellite messengers.' },
  { slug: 'accessories', name: 'Accessories', sortOrder: 8,
    description: 'Gloves, poles, gaiters, and the small things you forget.' },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

/** Inclusive price bands per category, in cents. Enforced by test. */
export const PRICE_BANDS: Record<CategorySlug, [number, number]> = {
  'outerwear': [12_000, 65_000],
  'footwear': [9_500, 28_000],
  'packs-bags': [4_500, 42_000],
  'shelter-sleep': [8_500, 85_000],
  'base-layers': [2_800, 17_500],
  'camp-kitchen': [1_800, 21_000],
  'navigation': [2_400, 38_000],
  'accessories': [1_600, 19_500],
};

export type SeedProduct = {
  sku: string;
  slug: string;
  name: string;
  description: string;
  categorySlug: CategorySlug;
  priceCents: number;
  stockQty: number;
};

// Northbound is own-brand, so every product is a Northbound product. The price
// spread is deliberate: 25 SKUs sit below the $100 policy threshold and 39
// above it, and the two most expensive items sum past $900 — the figures the
// parent project's approval demo uses.
export const PRODUCTS: SeedProduct[] = [
  // ── Outerwear ────────────────────────────────────────────────────────────
  { sku: 'NB-OW-001', slug: 'ridgeline-3l-hardshell', name: 'Ridgeline 3L Hardshell', categorySlug: 'outerwear', priceCents: 48_000, stockQty: 24,
    description: 'A three-layer waterproof shell with fully taped seams and a helmet-compatible hood. Cut long at the back so it still covers under a loaded pack.' },
  { sku: 'NB-OW-002', slug: 'tundra-800-down-parka', name: 'Tundra 800-Fill Down Parka', categorySlug: 'outerwear', priceCents: 65_000, stockQty: 12,
    description: 'Responsibly sourced 800-fill down beneath a recycled ripstop face. Packs down to roughly the size of a loaf of bread and weighs less than a litre of water.' },
  { sku: 'NB-OW-003', slug: 'coastal-rain-shell', name: 'Coastal Rain Shell', categorySlug: 'outerwear', priceCents: 22_000, stockQty: 40,
    description: 'A lighter two-and-a-half-layer shell for days when the forecast is drizzle rather than weather. Pit zips, adjustable hem, packs into its own pocket.' },
  { sku: 'NB-OW-004', slug: 'brushline-grid-fleece', name: 'Brushline Grid Fleece', categorySlug: 'outerwear', priceCents: 13_500, stockQty: 55,
    description: 'Grid-back fleece that moves moisture instead of holding it. Thin enough to layer under a shell, warm enough to be the only thing you wear at camp.' },
  { sku: 'NB-OW-005', slug: 'stormpeak-insulated-jacket', name: 'Stormpeak Insulated Jacket', categorySlug: 'outerwear', priceCents: 39_500, stockQty: 18,
    description: 'Synthetic insulation that keeps loft when damp, wrapped in a wind-resistant face fabric. The jacket for shoulder seasons that cannot make up their mind.' },
  { sku: 'NB-OW-006', slug: 'driftwood-shirt-jacket', name: 'Driftwood Shirt Jacket', categorySlug: 'outerwear', priceCents: 16_500, stockQty: 32,
    description: 'Heavyweight organic cotton twill with a quilted lining. Built for the drive to the trailhead and every errand between trips.' },
  { sku: 'NB-OW-007', slug: 'alpenglow-windbreaker', name: 'Alpenglow Windbreaker', categorySlug: 'outerwear', priceCents: 14_800, stockQty: 44,
    description: 'Ninety grams of wind protection that disappears into a hip belt pocket. Not waterproof, and honest about it.' },
  { sku: 'NB-OW-008', slug: 'glacier-softshell', name: 'Glacier Softshell', categorySlug: 'outerwear', priceCents: 28_500, stockQty: 21,
    description: 'Stretch-woven softshell with a brushed interior, sized to layer over a midweight fleece. Sheds light snow and breathes on a long climb.' },

  // ── Footwear ─────────────────────────────────────────────────────────────
  { sku: 'NB-FW-001', slug: 'summit-gtx-hiking-boot', name: 'Summit GTX Hiking Boot', categorySlug: 'footwear', priceCents: 24_500, stockQty: 30,
    description: 'A waterproof full-grain leather boot with a shank stiff enough for scree and a toe box wide enough for day eight. Resolable.' },
  { sku: 'NB-FW-002', slug: 'switchback-trail-runner', name: 'Switchback Trail Runner', categorySlug: 'footwear', priceCents: 15_500, stockQty: 48,
    description: 'Four-millimetre drop, aggressive lugs, and a rock plate that takes the edge off granite. Drains fast after a creek crossing.' },
  { sku: 'NB-FW-003', slug: 'granite-mid-hiker', name: 'Granite Mid Hiker', categorySlug: 'footwear', priceCents: 19_800, stockQty: 26,
    description: 'A mid-height hiker that splits the difference between a boot and a trail shoe. Supportive enough for a loaded pack, light enough for a day out.' },
  { sku: 'NB-FW-004', slug: 'basecamp-insulated-bootie', name: 'Basecamp Insulated Bootie', categorySlug: 'footwear', priceCents: 9_500, stockQty: 60,
    description: 'Down-filled camp booties with a grippy sole, for the hour between taking your boots off and getting into your bag.' },
  { sku: 'NB-FW-005', slug: 'talus-approach-shoe', name: 'Talus Approach Shoe', categorySlug: 'footwear', priceCents: 17_500, stockQty: 34,
    description: 'Sticky rubber and a climbing-zone toe for scrambling, with enough cushion to walk in for an hour first.' },
  { sku: 'NB-FW-006', slug: 'wanderer-leather-boot', name: 'Wanderer Leather Boot', categorySlug: 'footwear', priceCents: 28_000, stockQty: 15,
    description: 'Oiled full-grain leather over a Goodyear welt. Heavy, slow to break in, and likely to outlast several pairs of anything else.' },
  { sku: 'NB-FW-007', slug: 'creekbed-water-shoe', name: 'Creekbed Water Shoe', categorySlug: 'footwear', priceCents: 9_800, stockQty: 52,
    description: 'Quick-draining mesh with a closed toe, for river crossings and days where wet feet are the plan rather than the accident.' },
  { sku: 'NB-FW-008', slug: 'longtrail-gtx-low', name: 'Longtrail GTX Low', categorySlug: 'footwear', priceCents: 21_500, stockQty: 29,
    description: 'A waterproof low-cut hiker for people who have decided ankle support is a matter of preference rather than physics.' },

  // ── Packs & Bags ─────────────────────────────────────────────────────────
  { sku: 'NB-PK-001', slug: 'cascade-45l-expedition-pack', name: 'Cascade 45L Expedition Pack', categorySlug: 'packs-bags', priceCents: 42_000, stockQty: 20,
    description: 'Forty-five litres with a load-transferring hip belt and a frame sheet that carries fifty pounds without complaint. Built for four-night trips.' },
  { sku: 'NB-PK-002', slug: 'daybreak-22l-daypack', name: 'Daybreak 22L Daypack', categorySlug: 'packs-bags', priceCents: 14_500, stockQty: 60,
    description: 'Twenty-two litres, a reservoir sleeve, and hip-belt pockets that fit a phone and a bar. The pack most days actually need.' },
  { sku: 'NB-PK-003', slug: 'haulline-70l-expedition-pack', name: 'Haulline 70L Expedition Pack', categorySlug: 'packs-bags', priceCents: 38_500, stockQty: 11,
    description: 'Seventy litres for winter loads and week-long resupplies. Removable lid converts to a summit pack.' },
  { sku: 'NB-PK-004', slug: 'spire-18l-summit-pack', name: 'Spire 18L Summit Pack', categorySlug: 'packs-bags', priceCents: 11_500, stockQty: 45,
    description: 'A stripped-down eighteen litres with ice axe loops and nothing you would not carry uphill. Stuffs into its own lid.' },
  { sku: 'NB-PK-005', slug: 'portage-60l-duffel', name: 'Portage 60L Duffel', categorySlug: 'packs-bags', priceCents: 17_500, stockQty: 38,
    description: 'Welded tarpaulin duffel with stowable shoulder straps. Survives bush planes, roof racks, and baggage handlers.' },
  { sku: 'NB-PK-006', slug: 'riverrun-20l-dry-bag', name: 'Riverrun 20L Dry Bag', categorySlug: 'packs-bags', priceCents: 4_500, stockQty: 80,
    description: 'Roll-top dry bag in twenty litres, with a purge valve so it compresses instead of fighting you inside a pack.' },
  { sku: 'NB-PK-007', slug: 'trailhead-hip-pack', name: 'Trailhead Hip Pack', categorySlug: 'packs-bags', priceCents: 5_800, stockQty: 70,
    description: 'Three litres across the hips for a shell, a filter, and a snack. The right size for a trail run or a town day.' },
  { sku: 'NB-PK-008', slug: 'overland-40l-travel-pack', name: 'Overland 40L Travel Pack', categorySlug: 'packs-bags', priceCents: 26_500, stockQty: 24,
    description: 'Carry-on-legal forty litres that opens like a suitcase, with straps that hide away for the airport.' },

  // ── Shelter & Sleep ──────────────────────────────────────────────────────
  { sku: 'NB-SS-001', slug: 'aurora-2p-tent', name: 'Aurora 2P Tent', categorySlug: 'shelter-sleep', priceCents: 65_000, stockQty: 14,
    description: 'A two-person three-season tent with two doors, two vestibules, and a pitch you can manage alone in wind. Under two kilograms packed.' },
  { sku: 'NB-SS-002', slug: 'basecamp-4p-dome-tent', name: 'Basecamp 4P Dome Tent', categorySlug: 'shelter-sleep', priceCents: 85_000, stockQty: 8,
    description: 'Four-person dome with standing headroom and a full-coverage fly. Heavy by design: this one lives at the trailhead, not in your pack.' },
  { sku: 'NB-SS-003', slug: 'featherline-20f-down-bag', name: 'Featherline 20°F Down Bag', categorySlug: 'shelter-sleep', priceCents: 44_500, stockQty: 17,
    description: 'An 850-fill mummy bag rated to twenty degrees, with a draft collar that actually seals. Compresses smaller than you expect.' },
  { sku: 'NB-SS-004', slug: 'driftoff-sleeping-pad', name: 'Driftoff Insulated Sleeping Pad', categorySlug: 'shelter-sleep', priceCents: 16_500, stockQty: 42,
    description: 'An R-value of 4.2 in under five hundred grams, with a pump sack so you are not lightheaded before bed.' },
  { sku: 'NB-SS-005', slug: 'hollow-single-hammock', name: 'Hollow Single Hammock', categorySlug: 'shelter-sleep', priceCents: 8_500, stockQty: 55,
    description: 'Ripstop nylon hammock with tree-friendly straps included. Three hundred grams for an afternoon you will remember.' },
  { sku: 'NB-SS-006', slug: 'ridgetop-1p-bivy', name: 'Ridgetop 1P Bivy', categorySlug: 'shelter-sleep', priceCents: 32_000, stockQty: 12,
    description: 'A single-hoop bivy for alpine starts and ledges too small for a tent. Waterproof, breathable, and unapologetically snug.' },
  { sku: 'NB-SS-007', slug: 'lowland-30f-synthetic-bag', name: 'Lowland 30°F Synthetic Bag', categorySlug: 'shelter-sleep', priceCents: 21_500, stockQty: 28,
    description: 'Synthetic fill that keeps working when it gets damp, rated to thirty degrees. The honest choice for wet coastal trips.' },
  { sku: 'NB-SS-008', slug: 'shelter-tarp-3x3', name: 'Shelter Tarp 3×3', categorySlug: 'shelter-sleep', priceCents: 12_500, stockQty: 36,
    description: 'A silnylon three-by-three metre tarp with nineteen tie-outs. The most shelter per gram available, if you know your knots.' },

  // ── Base Layers & Apparel ────────────────────────────────────────────────
  { sku: 'NB-BL-001', slug: 'merino-150-crew-tee', name: 'Merino 150 Crew Tee', categorySlug: 'base-layers', priceCents: 7_800, stockQty: 75,
    description: 'A 150gsm merino tee that resists odour for days and dries on your back. The first thing most people pack and the last thing they replace.' },
  { sku: 'NB-BL-002', slug: 'merino-250-half-zip', name: 'Merino 250 Half-Zip', categorySlug: 'base-layers', priceCents: 14_800, stockQty: 40,
    description: 'Midweight 250gsm merino with a deep zip for dumping heat on a climb. Flatlock seams that do not chafe under a hip belt.' },
  { sku: 'NB-BL-003', slug: 'trailworn-hiking-pant', name: 'Trailworn Hiking Pant', categorySlug: 'base-layers', priceCents: 12_800, stockQty: 46,
    description: 'Four-way stretch nylon with a gusseted crotch and articulated knees. Dries in the time it takes to eat lunch.' },
  { sku: 'NB-BL-004', slug: 'switchgrass-sun-hoodie', name: 'Switchgrass Sun Hoodie', categorySlug: 'base-layers', priceCents: 9_500, stockQty: 58,
    description: 'UPF 50 hooded layer with thumb loops, for exposed ridgelines and long days on the water. Weighs almost nothing.' },
  { sku: 'NB-BL-005', slug: 'merino-blend-legging', name: 'Merino Blend Legging', categorySlug: 'base-layers', priceCents: 11_800, stockQty: 44,
    description: 'A merino-and-nylon blend that holds its shape through a week of wear. Warm enough to sleep in, thin enough to hike in.' },
  { sku: 'NB-BL-006', slug: 'fieldstone-flannel', name: 'Fieldstone Flannel', categorySlug: 'base-layers', priceCents: 13_800, stockQty: 33,
    description: 'Brushed organic cotton flannel in a relaxed cut. Not technical, not pretending to be, and the nicest thing in your duffel.' },
  { sku: 'NB-BL-007', slug: 'quickdry-trail-short', name: 'Quickdry Trail Short', categorySlug: 'base-layers', priceCents: 6_800, stockQty: 62,
    description: 'A five-inch short with a liner and two zip pockets. Swims, hikes, and goes to dinner without changing.' },
  { sku: 'NB-BL-008', slug: 'merino-hiking-sock-3pk', name: 'Merino Hiking Sock, 3-Pack', categorySlug: 'base-layers', priceCents: 4_200, stockQty: 90,
    description: 'Cushioned merino crew socks in a three-pack, with a reinforced heel and toe. The cheapest upgrade to any boot you own.' },

  // ── Camp Kitchen ─────────────────────────────────────────────────────────
  { sku: 'NB-CK-001', slug: 'emberlight-canister-stove', name: 'Emberlight Canister Stove', categorySlug: 'camp-kitchen', priceCents: 13_500, stockQty: 47,
    description: 'An integrated canister stove that boils half a litre in under three minutes and packs inside its own pot.' },
  { sku: 'NB-CK-002', slug: 'trail-enamel-mug', name: 'Trail Enamel Mug', categorySlug: 'camp-kitchen', priceCents: 1_800, stockQty: 120,
    description: 'Twelve ounces of speckled enamel over steel. Chips honourably, lasts decades, and hangs off a pack strap.' },
  { sku: 'NB-CK-003', slug: 'basin-2p-cook-set', name: 'Basin 2P Cook Set', categorySlug: 'camp-kitchen', priceCents: 14_800, stockQty: 31,
    description: 'Hard-anodised pot and pan for two, with folding handles and nesting bowls. Everything stacks into the larger pot.' },
  { sku: 'NB-CK-004', slug: 'springwater-filter-bottle', name: 'Springwater Filter Bottle', categorySlug: 'camp-kitchen', priceCents: 5_800, stockQty: 66,
    description: 'A one-litre bottle with an inline hollow-fibre filter. Drink as you walk instead of stopping to pump.' },
  { sku: 'NB-CK-005', slug: 'packdown-1l-kettle', name: 'Packdown 1L Kettle', categorySlug: 'camp-kitchen', priceCents: 7_200, stockQty: 40,
    description: 'A titanium litre kettle weighing under a hundred and twenty grams, with a folding bail handle for hanging over a fire.' },
  { sku: 'NB-CK-006', slug: 'gravity-6l-reservoir', name: 'Gravity 6L Reservoir', categorySlug: 'camp-kitchen', priceCents: 9_500, stockQty: 35,
    description: 'Six litres of gravity-fed filtration for a whole group. Hang it from a branch and stop thinking about water.' },
  { sku: 'NB-CK-007', slug: 'woodsmoke-folding-grill', name: 'Woodsmoke Folding Grill', categorySlug: 'camp-kitchen', priceCents: 21_000, stockQty: 16,
    description: 'A stainless firebox that folds flat and burns sticks instead of fuel canisters. Doubles as a windscreen.' },
  { sku: 'NB-CK-008', slug: 'titanium-spork-set', name: 'Titanium Spork Set', categorySlug: 'camp-kitchen', priceCents: 2_400, stockQty: 100,
    description: 'Two long-handled titanium sporks that reach the bottom of a freeze-dried pouch without coating your knuckles.' },

  // ── Navigation & Light ───────────────────────────────────────────────────
  { sku: 'NB-NV-001', slug: 'beacon-400-headlamp', name: 'Beacon 400 Headlamp', categorySlug: 'navigation', priceCents: 6_800, stockQty: 72,
    description: 'Four hundred lumens, USB-C rechargeable, with a red mode that does not wake the tent. Locks out so it cannot drain in your pack.' },
  { sku: 'NB-NV-002', slug: 'hearth-camp-lantern', name: 'Hearth Camp Lantern', categorySlug: 'navigation', priceCents: 8_500, stockQty: 50,
    description: 'A warm-toned collapsible lantern that runs forty hours on low and charges a phone in a pinch.' },
  { sku: 'NB-NV-003', slug: 'waypoint-handheld-gps', name: 'Waypoint Handheld GPS', categorySlug: 'navigation', priceCents: 38_000, stockQty: 9,
    description: 'A dedicated handheld with a sunlight-readable screen, preloaded topographic maps, and buttons you can work in gloves.' },
  { sku: 'NB-NV-004', slug: 'truenorth-baseplate-compass', name: 'Truenorth Baseplate Compass', categorySlug: 'navigation', priceCents: 3_400, stockQty: 85,
    description: 'A liquid-damped baseplate compass with an adjustable declination screw. No batteries, no firmware, no excuses.' },
  { sku: 'NB-NV-005', slug: 'signal-satellite-messenger', name: 'Signal Satellite Messenger', categorySlug: 'navigation', priceCents: 34_500, stockQty: 10,
    description: 'Two-way satellite messaging and SOS anywhere with sky overhead. Subscription sold separately, and worth it.' },
  { sku: 'NB-NV-006', slug: 'packlight-string-lantern', name: 'Packlight String Lantern', categorySlug: 'navigation', priceCents: 4_200, stockQty: 64,
    description: 'Three metres of warm LED string that coils into a palm-sized case. Turns a tarp into somewhere you want to sit.' },
  { sku: 'NB-NV-007', slug: 'dawnpatrol-800-headlamp', name: 'Dawnpatrol 800 Headlamp', categorySlug: 'navigation', priceCents: 12_500, stockQty: 38,
    description: 'Eight hundred lumens with a rear battery pack for balance on long descents in the dark. Reactive dimming.' },
  { sku: 'NB-NV-008', slug: 'emberflare-signal-light', name: 'Emberflare Signal Light', categorySlug: 'navigation', priceCents: 2_400, stockQty: 95,
    description: 'A twenty-gram clip-on strobe visible for over a kilometre. Lives on a pack lid and is forgotten until it matters.' },

  // ── Accessories ──────────────────────────────────────────────────────────
  { sku: 'NB-AC-001', slug: 'summit-insulated-glove', name: 'Summit Insulated Glove', categorySlug: 'accessories', priceCents: 11_800, stockQty: 42,
    description: 'A waterproof insulated glove with a leather palm and a cuff long enough to seal under a shell sleeve.' },
  { sku: 'NB-AC-002', slug: 'ridgeline-merino-beanie', name: 'Ridgeline Merino Beanie', categorySlug: 'accessories', priceCents: 3_800, stockQty: 88,
    description: 'A ribbed merino beanie that fits under a helmet and does not itch. The one piece of gear nobody regrets packing.' },
  { sku: 'NB-AC-003', slug: 'alpine-high-gaiter', name: 'Alpine High Gaiter', categorySlug: 'accessories', priceCents: 7_200, stockQty: 44,
    description: 'Full-height waterproof gaiters with a steel underfoot cable. Keeps scree, snow, and most of the trail out of your boots.' },
  { sku: 'NB-AC-004', slug: 'carbon-trekking-pole-pair', name: 'Carbon Trekking Pole Pair', categorySlug: 'accessories', priceCents: 19_500, stockQty: 27,
    description: 'Three-section carbon poles with cork grips, folding to thirty-eight centimetres. Your knees will notice on the way down.' },
  { sku: 'NB-AC-005', slug: 'fieldkit-first-aid', name: 'Fieldkit First Aid', categorySlug: 'accessories', priceCents: 5_800, stockQty: 58,
    description: 'A weekend-trip first aid kit in a waterproof roll, organised by injury rather than by item so you can find things quickly.' },
  { sku: 'NB-AC-006', slug: 'packable-sun-hat', name: 'Packable Sun Hat', categorySlug: 'accessories', priceCents: 4_200, stockQty: 61,
    description: 'A wide-brim UPF 50 hat with a chin cord, that can be crushed into a pocket and shaken back into shape.' },
  { sku: 'NB-AC-007', slug: 'merino-neck-gaiter', name: 'Merino Neck Gaiter', categorySlug: 'accessories', priceCents: 2_800, stockQty: 92,
    description: 'A lightweight merino tube that works as a neck warmer, a headband, or a way to breathe warmer air on a cold morning.' },
  { sku: 'NB-AC-008', slug: 'trail-repair-kit', name: 'Trail Repair Kit', categorySlug: 'accessories', priceCents: 1_600, stockQty: 110,
    description: 'Tenacious tape, a pole splint, spare buckles, cord, and a needle. Forty grams that have saved a great many trips.' },
];

export async function seedCatalog(db: LibSQLDatabase<typeof schema>): Promise<void> {
  const now = new Date();

  const inserted = await db.insert(schema.categories)
    .values(CATEGORIES.map((c) => ({ ...c })))
    .returning();

  const idBySlug = new Map(inserted.map((c) => [c.slug, c.id]));

  await db.insert(schema.products).values(PRODUCTS.map((p) => ({
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    description: p.description,
    categoryId: idBySlug.get(p.categorySlug)!,
    priceCents: p.priceCents,
    imagePath: `/products/${p.slug}.webp`,
    stockQty: p.stockQty,
    isActive: true,
    createdAt: now,
  })));
}
