// The deterministic seed catalogue for the 2026-27 season.
//
// Every value comes from fixed tables below or from a seeded PRNG, never from
// Math.random or the clock, so the data (and the evaluation set built on it)
// is identical on every run. Each ship has its own PRNG stream, so changing
// one ship doesn't reshuffle the others.
//
// All operator, ship and voyage names are invented.

export type Route = "peninsula" | "antarctic_circle" | "falklands_south_georgia" | "fly_cruise";

export interface OperatorRow {
  id: string;
  name: string;
}

export interface ShipRow {
  id: string;
  operator_id: string;
  name: string;
  passenger_capacity: number;
}

export interface VoyageRow {
  id: string;
  ship_id: string;
  name: string;
  route: Route;
  embark_port: string;
  nights: number;
}

export interface DepartureRow {
  id: string;
  voyage_id: string;
  start_date: string;
  end_date: string;
  availability_updated_at: string;
}

export interface CabinCategoryRow {
  id: string;
  ship_id: string;
  name: string;
  sleeps: number;
  description: string;
}

export interface DepartureFareRow {
  departure_id: string;
  cabin_category_id: string;
  price_gbp_pp: number;
  solo_price_gbp: number | null;
  berths_left: number;
}

export interface ActivityRow {
  id: string;
  name: string;
  description: string;
}

export interface DepartureActivityRow {
  departure_id: string;
  activity_id: string;
  places_left: number;
  price_gbp: number;
}

// ---------------------------------------------------------------------------
// PRNG and date helpers

const SEED = 20262027;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Rng {
  next(): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
}

function rngFor(key: string): Rng {
  const next = mulberry32(SEED ^ hash(key));
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
  };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function round50(pounds: number): number {
  return Math.round(pounds / 50) * 50;
}

const SEASON_START = "2026-11-02";
const SEASON_END = "2027-03-31";
export const AVAILABILITY_BASE = Date.parse("2026-11-01T09:00:00Z");

// ---------------------------------------------------------------------------
// Fixed catalogue

export const operators: OperatorRow[] = [
  { id: "op_brashline", name: "Brashline Voyages" },
  { id: "op_skua_bay", name: "Skua Bay Expeditions" },
  { id: "op_far_meridian", name: "Far Meridian Cruises" },
  { id: "op_katabatic", name: "Katabatic Travel" },
  { id: "op_driftwell", name: "Driftwell Polar" },
  { id: "op_grand_southern", name: "Grand Southern Line" },
];

export const activities: ActivityRow[] = [
  { id: "act_kayak", name: "Sea kayaking", description: "Guided paddles among the ice in small groups." },
  { id: "act_camp", name: "Overnight camping", description: "One night ashore in a bivvy bag, weather permitting." },
  { id: "act_snowshoe", name: "Snowshoeing", description: "Guided walks to viewpoints above the landing sites." },
  { id: "act_sup", name: "Stand-up paddleboarding", description: "Calm-water paddleboarding in sheltered bays." },
];

type CabinCode = "triple" | "twin_porthole" | "twin_window" | "balcony" | "suite" | "inside_twin" | "oceanview_twin";

interface CabinTemplate {
  code: CabinCode;
  name: string;
  sleeps: number;
  description: string;
  /** Multiplier on the ship's twin porthole price. */
  factor: number;
  /** Whether this kind of cabin can ever be sold for single occupancy. */
  soloAllowed: boolean;
}

const EXPEDITION_CABINS: Record<string, CabinTemplate> = {
  triple: { code: "triple", name: "Triple porthole", sleeps: 3, description: "Three lower berths, porthole, shared with friends or family.", factor: 0.84, soloAllowed: false },
  twin_porthole: { code: "twin_porthole", name: "Twin porthole", sleeps: 2, description: "Two lower berths and a porthole, on a lower deck.", factor: 1, soloAllowed: true },
  twin_window: { code: "twin_window", name: "Twin window", sleeps: 2, description: "Two lower berths and a picture window.", factor: 1.16, soloAllowed: true },
  balcony: { code: "balcony", name: "Balcony stateroom", sleeps: 2, description: "Twin or double bed with a private balcony.", factor: 1.42, soloAllowed: true },
  suite: { code: "suite", name: "Owner's suite", sleeps: 2, description: "Separate sitting area, large windows and a balcony.", factor: 1.78, soloAllowed: false },
};

const LARGE_SHIP_CABINS: CabinTemplate[] = [
  { code: "inside_twin", name: "Inside twin", sleeps: 2, description: "Two beds, no window, on a middle deck.", factor: 0.85, soloAllowed: true },
  { code: "oceanview_twin", name: "Ocean view twin", sleeps: 2, description: "Two beds and a window.", factor: 1, soloAllowed: true },
  { code: "balcony", name: "Balcony stateroom", sleeps: 2, description: "Double bed with a private balcony.", factor: 1.3, soloAllowed: false },
  { code: "suite", name: "Grand suite", sleeps: 2, description: "Sitting room, balcony and butler service.", factor: 1.95, soloAllowed: false },
];

/** Twin porthole price per person per night, before ship and season factors. */
const NIGHTLY_RATE: Record<Route, number> = {
  peninsula: 880,
  antarctic_circle: 900,
  falklands_south_georgia: 700,
  fly_cruise: 1500,
};

const SEASON_FACTOR: Record<string, number> = {
  "11": 0.92,
  "12": 1.08,
  "01": 1.1,
  "02": 1,
  "03": 0.9,
};

const ACTIVITY_PRICE: Record<string, [number, number]> = {
  act_kayak: [695, 895],
  act_camp: [395, 495],
  act_snowshoe: [150, 225],
  act_sup: [250, 325],
};

const ACTIVITY_PLACES: Record<string, number> = {
  act_kayak: 14,
  act_camp: 30,
  act_snowshoe: 24,
  act_sup: 12,
};

interface VoyageSpec {
  id: string;
  name: string;
  route: Route;
  nights: number;
  embark_port?: string;
}

/** Brief-shaped adjustments applied to one pinned departure after generation. */
interface PinAdjust {
  /** The cheapest twin fare is lowered to at most maxPp, with at least minBerths. */
  ensureFare?: { maxPp: number; minBerths: number; soloMax?: number };
  /** Every fare is scaled so the cheapest is exactly this, with at least 4 berths. */
  cheapestFareExactly?: number;
  soldOut?: boolean;
  noSolo?: boolean;
  activityPlaces?: Record<string, number>;
}

interface Pin {
  key: string;
  voyage: string;
  start: string;
  adjust: PinAdjust;
}

interface ShipSpec {
  id: string;
  operator_id: string;
  name: string;
  passenger_capacity: number;
  /** Multiplier on the nightly rate: newer or smaller ships cost more. */
  priceFactor: number;
  cabins: CabinTemplate[];
  activities: string[];
  voyages: VoyageSpec[];
  /** Total departures this season, pinned ones included. */
  departures: number;
  pins: Pin[];
}

const cabins = (...codes: CabinCode[]): CabinTemplate[] => codes.map((code) => EXPEDITION_CABINS[code]);

const SHIPS: ShipSpec[] = [
  {
    id: "ship_storm_petrel",
    operator_id: "op_brashline",
    name: "MV Storm Petrel",
    passenger_capacity: 116,
    priceFactor: 1,
    cabins: cabins("triple", "twin_porthole", "twin_window", "balcony"),
    activities: ["act_kayak", "act_camp", "act_snowshoe"],
    voyages: [
      { id: "voy_petrel_peninsula", name: "Classic Antarctic Peninsula", route: "peninsula", nights: 10 },
      { id: "voy_petrel_circle", name: "Crossing the Circle", route: "antarctic_circle", nights: 13 },
    ],
    departures: 6,
    pins: [
      { key: "soloCompanion", voyage: "voy_petrel_peninsula", start: "2026-11-18", adjust: { ensureFare: { maxPp: 9500, minBerths: 3, soloMax: 10800 } } },
      { key: "soldOutCompanion", voyage: "voy_petrel_peninsula", start: "2026-12-12", adjust: { ensureFare: { maxPp: 11000, minBerths: 4 } } },
    ],
  },
  {
    id: "ship_fulmar",
    operator_id: "op_brashline",
    name: "MV Fulmar",
    passenger_capacity: 164,
    priceFactor: 0.95,
    cabins: cabins("twin_porthole", "twin_window", "balcony", "suite"),
    activities: ["act_snowshoe", "act_sup"],
    voyages: [
      { id: "voy_fulmar_peninsula", name: "Peninsula Explorer", route: "peninsula", nights: 10 },
      { id: "voy_fulmar_south_georgia", name: "Falklands, South Georgia and the Peninsula", route: "falklands_south_georgia", nights: 20 },
    ],
    departures: 6,
    pins: [
      { key: "flyCruiseCompanion", voyage: "voy_fulmar_peninsula", start: "2027-01-18", adjust: { ensureFare: { maxPp: 11000, minBerths: 6 } } },
    ],
  },
  {
    id: "ship_skua_point",
    operator_id: "op_skua_bay",
    name: "MV Skua Point",
    passenger_capacity: 100,
    priceFactor: 1.08,
    cabins: cabins("twin_porthole", "twin_window", "balcony"),
    activities: ["act_kayak", "act_snowshoe"],
    voyages: [
      { id: "voy_skua_peninsula", name: "Antarctic Peninsula in Depth", route: "peninsula", nights: 10 },
      { id: "voy_skua_circle", name: "Polar Circle Quest", route: "antarctic_circle", nights: 14 },
    ],
    departures: 6,
    pins: [
      { key: "soldOutFavourite", voyage: "voy_skua_peninsula", start: "2026-12-14", adjust: { ensureFare: { maxPp: 10000, minBerths: 0 }, soldOut: true } },
    ],
  },
  {
    id: "ship_cormorant_rock",
    operator_id: "op_skua_bay",
    name: "MV Cormorant Rock",
    passenger_capacity: 132,
    priceFactor: 1.02,
    cabins: cabins("triple", "twin_porthole", "twin_window", "balcony", "suite"),
    activities: ["act_kayak", "act_sup"],
    voyages: [
      { id: "voy_cormorant_peninsula", name: "White Continent Discovery", route: "peninsula", nights: 11 },
      { id: "voy_cormorant_south_georgia", name: "South Georgia Odyssey", route: "falklands_south_georgia", nights: 19 },
    ],
    departures: 6,
    pins: [
      { key: "noSoloButShareFits", voyage: "voy_cormorant_peninsula", start: "2026-11-20", adjust: { ensureFare: { maxPp: 10000, minBerths: 3 }, noSolo: true } },
    ],
  },
  {
    id: "ship_meridian_star",
    operator_id: "op_far_meridian",
    name: "MS Meridian Star",
    passenger_capacity: 199,
    priceFactor: 1.05,
    cabins: cabins("twin_porthole", "twin_window", "balcony", "suite"),
    activities: ["act_kayak", "act_snowshoe"],
    voyages: [
      { id: "voy_mstar_circle", name: "Beyond the Antarctic Circle", route: "antarctic_circle", nights: 14 },
      { id: "voy_mstar_peninsula", name: "Peninsula Highlights", route: "peninsula", nights: 10 },
    ],
    departures: 6,
    pins: [
      { key: "runsPastWindow", voyage: "voy_mstar_circle", start: "2027-01-03", adjust: { ensureFare: { maxPp: 14500, minBerths: 4 } } },
    ],
  },
  {
    id: "ship_polar_meridian",
    operator_id: "op_far_meridian",
    name: "MS Polar Meridian",
    passenger_capacity: 264,
    priceFactor: 0.88,
    cabins: cabins("twin_porthole", "twin_window", "balcony", "suite"),
    activities: ["act_camp", "act_snowshoe"],
    voyages: [
      { id: "voy_pmer_peninsula", name: "Antarctic Essentials", route: "peninsula", nights: 10 },
      { id: "voy_pmer_south_georgia", name: "Islands of the Southern Ocean", route: "falklands_south_georgia", nights: 21 },
    ],
    departures: 5,
    pins: [],
  },
  {
    id: "ship_katabatic_wind",
    operator_id: "op_katabatic",
    name: "MV Katabatic Wind",
    passenger_capacity: 140,
    priceFactor: 1,
    cabins: cabins("triple", "twin_porthole", "twin_window", "balcony"),
    activities: ["act_kayak", "act_camp", "act_sup"],
    voyages: [
      { id: "voy_katabatic_peninsula", name: "Peninsula by Kayak and Boot", route: "peninsula", nights: 10 },
      { id: "voy_katabatic_circle", name: "The Circle and the Fjords", route: "antarctic_circle", nights: 15 },
    ],
    departures: 6,
    pins: [
      { key: "kayakOnePlaceLeft", voyage: "voy_katabatic_peninsula", start: "2027-02-08", adjust: { ensureFare: { maxPp: 12000, minBerths: 6 }, activityPlaces: { act_kayak: 1 } } },
    ],
  },
  {
    id: "ship_nunatak",
    operator_id: "op_katabatic",
    name: "MV Nunatak",
    passenger_capacity: 180,
    priceFactor: 0.97,
    cabins: cabins("twin_porthole", "twin_window", "balcony", "suite"),
    activities: ["act_kayak", "act_camp", "act_snowshoe"],
    voyages: [
      { id: "voy_nunatak_peninsula", name: "Peninsula Wildlife Voyage", route: "peninsula", nights: 11 },
      { id: "voy_nunatak_south_georgia", name: "Penguin Kingdoms of South Georgia", route: "falklands_south_georgia", nights: 18 },
    ],
    departures: 6,
    pins: [
      { key: "kayakCompanion", voyage: "voy_nunatak_peninsula", start: "2027-02-10", adjust: { ensureFare: { maxPp: 12500, minBerths: 4 }, activityPlaces: { act_kayak: 8 } } },
    ],
  },
  {
    id: "ship_sastrugi",
    operator_id: "op_katabatic",
    name: "MV Sastrugi",
    passenger_capacity: 96,
    priceFactor: 1.1,
    cabins: cabins("twin_porthole", "twin_window", "suite"),
    activities: ["act_kayak", "act_snowshoe", "act_sup"],
    voyages: [
      { id: "voy_sastrugi_peninsula", name: "Small Ship Peninsula", route: "peninsula", nights: 10 },
      { id: "voy_sastrugi_circle", name: "Southern Circle Expedition", route: "antarctic_circle", nights: 13 },
    ],
    departures: 6,
    pins: [
      { key: "runsPastCompanion", voyage: "voy_sastrugi_peninsula", start: "2027-01-02", adjust: { ensureFare: { maxPp: 14000, minBerths: 4 } } },
    ],
  },
  {
    id: "ship_driftwell",
    operator_id: "op_driftwell",
    name: "MV Driftwell",
    passenger_capacity: 154,
    priceFactor: 1,
    cabins: cabins("twin_porthole", "twin_window", "balcony"),
    activities: ["act_snowshoe"],
    voyages: [
      { id: "voy_driftwell_fly", name: "Fly the Drake: Peninsula", route: "fly_cruise", nights: 8, embark_port: "Punta Arenas" },
      { id: "voy_driftwell_fly_long", name: "Fly the Drake: Peninsula and Beyond", route: "fly_cruise", nights: 9, embark_port: "Punta Arenas" },
    ],
    departures: 7,
    pins: [
      { key: "flyCruiseJustOverBudget", voyage: "voy_driftwell_fly", start: "2027-01-20", adjust: { cheapestFareExactly: 12400 } },
    ],
  },
  {
    id: "ship_prion",
    operator_id: "op_driftwell",
    name: "MV Prion",
    passenger_capacity: 88,
    priceFactor: 1.06,
    cabins: cabins("twin_porthole", "twin_window", "suite"),
    activities: ["act_kayak"],
    voyages: [{ id: "voy_prion_fly", name: "Express Fly-Cruise", route: "fly_cruise", nights: 7, embark_port: "Punta Arenas" }],
    departures: 7,
    pins: [],
  },
  {
    id: "ship_growler",
    operator_id: "op_driftwell",
    name: "MV Growler",
    passenger_capacity: 110,
    priceFactor: 1.03,
    cabins: cabins("triple", "twin_porthole", "twin_window", "balcony"),
    activities: ["act_kayak", "act_camp", "act_snowshoe"],
    voyages: [
      { id: "voy_growler_peninsula", name: "Peninsula Adventure", route: "peninsula", nights: 10 },
      { id: "voy_growler_south_georgia", name: "Grand South Georgia", route: "falklands_south_georgia", nights: 22 },
    ],
    departures: 5,
    pins: [],
  },
  {
    id: "ship_grand_horizon",
    operator_id: "op_grand_southern",
    name: "MS Grand Horizon",
    passenger_capacity: 920,
    priceFactor: 0.55,
    cabins: LARGE_SHIP_CABINS,
    activities: [],
    voyages: [{ id: "voy_horizon_scenic", name: "Antarctic Scenic Cruising", route: "peninsula", nights: 10 }],
    departures: 6,
    pins: [{ key: "bigCheapNoLanding", voyage: "voy_horizon_scenic", start: "2027-01-05", adjust: { ensureFare: { maxPp: 4500, minBerths: 12 } } }],
  },
  {
    id: "ship_southern_belle",
    operator_id: "op_grand_southern",
    name: "MS Southern Belle",
    passenger_capacity: 380,
    priceFactor: 0.75,
    cabins: LARGE_SHIP_CABINS.slice(0, 3),
    activities: ["act_snowshoe"],
    voyages: [
      { id: "voy_belle_peninsula", name: "Antarctica in Comfort", route: "peninsula", nights: 11 },
      { id: "voy_belle_circle", name: "Southern Lights to the Circle", route: "antarctic_circle", nights: 14 },
    ],
    departures: 5,
    pins: [],
  },
];

// ---------------------------------------------------------------------------
// Generation

interface Draft {
  ship: ShipSpec;
  voyage: VoyageSpec;
  start: string;
  pin?: Pin;
}

function schedule(ship: ShipSpec, rng: Rng): Draft[] {
  const voyageById = new Map(ship.voyages.map((v) => [v.id, v]));
  const pins = [...ship.pins].sort((a, b) => a.start.localeCompare(b.start));
  const drafts: Draft[] = [];
  let cursor = addDays(SEASON_START, rng.int(0, 8));
  // The day the ship returns from its last placed departure.
  let lastEnd = addDays(SEASON_START, -1);
  let rotation = 0;
  let fillers = ship.departures - pins.length;

  while (pins.length > 0 || fillers > 0) {
    const voyage = ship.voyages[rotation % ship.voyages.length];
    const fillerEnd = addDays(cursor, voyage.nights);
    const nextPin = pins[0];
    let placed: Draft;
    // A filler goes in only if the ship is back at least a day before the pin.
    if (nextPin && (fillers === 0 || daysBetween(fillerEnd, nextPin.start) < 1)) {
      const pinVoyage = voyageById.get(nextPin.voyage);
      if (!pinVoyage) throw new Error(`Unknown voyage ${nextPin.voyage} on ${ship.id}`);
      if (nextPin.start <= lastEnd) throw new Error(`Pin ${nextPin.key} overlaps an earlier departure on ${ship.id}`);
      placed = { ship, voyage: pinVoyage, start: nextPin.start, pin: nextPin };
      pins.shift();
    } else {
      if (fillerEnd > SEASON_END) break;
      placed = { ship, voyage, start: cursor };
      fillers--;
      rotation++;
    }
    drafts.push(placed);
    lastEnd = addDays(placed.start, placed.voyage.nights);
    cursor = addDays(lastEnd, rng.int(1, 9));
  }
  return drafts;
}

function cabinId(ship: ShipSpec, cabin: CabinTemplate): string {
  return `cab_${ship.id.replace(/^ship_/, "")}_${cabin.code}`;
}

function build() {
  const ships: ShipRow[] = [];
  const voyages: VoyageRow[] = [];
  const cabinCategories: CabinCategoryRow[] = [];
  const drafts: Draft[] = [];
  const soloMultiplier = new Map<string, number | null>();

  for (const ship of SHIPS) {
    const rng = rngFor(ship.id);
    ships.push({ id: ship.id, operator_id: ship.operator_id, name: ship.name, passenger_capacity: ship.passenger_capacity });
    for (const v of ship.voyages) {
      voyages.push({ id: v.id, ship_id: ship.id, name: v.name, route: v.route, embark_port: v.embark_port ?? "Ushuaia", nights: v.nights });
    }
    for (const cabin of ship.cabins) {
      const id = cabinId(ship, cabin);
      cabinCategories.push({ id, ship_id: ship.id, name: cabin.name, sleeps: cabin.sleeps, description: cabin.description });
      // Some ships sell a cabin for single occupancy, some don't.
      soloMultiplier.set(id, cabin.soloAllowed && rng.chance(0.65) ? 1.5 + rng.int(0, 6) / 20 : null);
    }
    drafts.push(...schedule(ship, rng));
  }

  drafts.sort((a, b) => a.start.localeCompare(b.start) || a.ship.id.localeCompare(b.ship.id));

  const departures: DepartureRow[] = [];
  const fares: DepartureFareRow[] = [];
  const departureActivities: DepartureActivityRow[] = [];
  const pinned: Record<string, string> = {};

  drafts.forEach((draft, index) => {
    const id = `dep_${String(index + 1).padStart(3, "0")}`;
    const rng = rngFor(id);
    const { ship, voyage, start, pin } = draft;
    if (pin) pinned[pin.key] = id;

    departures.push({
      id,
      voyage_id: voyage.id,
      start_date: start,
      end_date: addDays(start, voyage.nights),
      availability_updated_at: new Date(AVAILABILITY_BASE - rng.int(0, 14 * 24 * 60) * 60_000).toISOString(),
    });

    const twinPp =
      NIGHTLY_RATE[voyage.route] * voyage.nights * ship.priceFactor * SEASON_FACTOR[start.slice(5, 7)] * (0.97 + rng.next() * 0.06);

    const depFares: DepartureFareRow[] = ship.cabins.map((cabin) => {
      const cabId = cabinId(ship, cabin);
      const price = round50(twinPp * cabin.factor);
      const solo = soloMultiplier.get(cabId) ?? null;
      return {
        departure_id: id,
        cabin_category_id: cabId,
        price_gbp_pp: price,
        solo_price_gbp: solo === null ? null : round50(price * solo),
        berths_left: rng.chance(0.15) ? 0 : rng.int(1, 20),
      };
    });

    if (pin) applyFareAdjust(depFares, ship, pin.adjust);
    fares.push(...depFares);

    for (const activityId of ship.activities) {
      const forced = pin?.adjust.activityPlaces?.[activityId];
      if (forced === undefined && !rng.chance(0.8)) continue;
      const [low, high] = ACTIVITY_PRICE[activityId];
      departureActivities.push({
        departure_id: id,
        activity_id: activityId,
        places_left: forced ?? rng.int(0, ACTIVITY_PLACES[activityId]),
        price_gbp: round50(low + rng.next() * (high - low)) - 5,
      });
    }
    // A forced activity the ship doesn't normally offer is a spec mistake.
    for (const activityId of Object.keys(pin?.adjust.activityPlaces ?? {})) {
      if (!ship.activities.includes(activityId)) throw new Error(`${ship.id} doesn't offer ${activityId}`);
    }
  });

  return { ships, voyages, cabinCategories, departures, fares, departureActivities, pinned };
}

function applyFareAdjust(depFares: DepartureFareRow[], ship: ShipSpec, adjust: PinAdjust): void {
  const sleeps = new Map(ship.cabins.map((c) => [cabinId(ship, c), c.sleeps]));

  if (adjust.ensureFare) {
    const { maxPp, minBerths, soloMax } = adjust.ensureFare;
    const twins = depFares.filter((f) => sleeps.get(f.cabin_category_id) === 2);
    const target = twins.reduce((a, b) => (b.price_gbp_pp < a.price_gbp_pp ? b : a));
    if (target.price_gbp_pp > maxPp) {
      const scale = maxPp / target.price_gbp_pp;
      for (const f of depFares) {
        f.price_gbp_pp = f === target ? maxPp : round50(f.price_gbp_pp * scale);
        if (f.solo_price_gbp !== null) f.solo_price_gbp = round50(f.solo_price_gbp * scale);
      }
    }
    target.berths_left = Math.max(target.berths_left, minBerths);
    if (soloMax !== undefined) {
      target.solo_price_gbp = Math.min(target.solo_price_gbp ?? soloMax, soloMax);
    }
  }

  if (adjust.cheapestFareExactly !== undefined) {
    const cheapest = Math.min(...depFares.map((f) => f.price_gbp_pp));
    const scale = adjust.cheapestFareExactly / cheapest;
    for (const f of depFares) {
      f.price_gbp_pp = f.price_gbp_pp === cheapest ? adjust.cheapestFareExactly : round50(f.price_gbp_pp * scale);
      if (f.solo_price_gbp !== null) f.solo_price_gbp = round50(f.solo_price_gbp * scale);
      f.berths_left = Math.max(f.berths_left, 4);
    }
  }

  if (adjust.soldOut) for (const f of depFares) f.berths_left = 0;
  if (adjust.noSolo) for (const f of depFares) f.solo_price_gbp = null;
}

const built = build();

export const ships: ShipRow[] = built.ships;
export const voyages: VoyageRow[] = built.voyages;
export const cabinCategories: CabinCategoryRow[] = built.cabinCategories;
export const departures: DepartureRow[] = built.departures;
export const departureFares: DepartureFareRow[] = built.fares;
export const departureActivities: DepartureActivityRow[] = built.departureActivities;

function pinnedId(key: string): string {
  const id = built.pinned[key];
  if (!id) throw new Error(`Pinned departure ${key} was not scheduled`);
  return id;
}

/**
 * Departures placed on purpose so the hard filter and near-miss queries have
 * something to catch. Each `...Companion` is an ordinary departure that does
 * fit the same brief, so a test can show "candidate X, but not edge case Y".
 */
export const EDGE_CASES = {
  /** Small ship, mid-December peninsula, every fare sold out. Exposed by a
   * couple in mid-December on a £12,000 pp budget: a berths near miss. */
  soldOutFavourite: pinnedId("soldOutFavourite"),
  soldOutCompanion: pinnedId("soldOutCompanion"),
  /** Fly-cruise whose cheapest fare is £12,400 pp. Exposed by a couple in late
   * January on £12,000 pp: a budget near miss, £400 over. */
  flyCruiseJustOverBudget: pinnedId("flyCruiseJustOverBudget"),
  flyCruiseCompanion: pinnedId("flyCruiseCompanion"),
  /** The 920-passenger ship, cheapest fares in the dataset. SQL can't exclude
   * it (ship size is a soft preference), so it's a candidate the ranking
   * should mark down for anyone wanting landings. */
  bigCheapNoLanding: pinnedId("bigCheapNoLanding"),
  /** No fare has a solo price, but a shared twin fits. Exposed by one person
   * wanting their own cabin in late November on £11,000: a near miss labelled
   * "no single cabin, sharing available". */
  noSoloButShareFits: pinnedId("noSoloButShareFits"),
  soloCompanion: pinnedId("soloCompanion"),
  /** Kayaking has 1 place left. Exposed by a couple who must kayak in
   * February: an activity places near miss, short by 1. */
  kayakOnePlaceLeft: pinnedId("kayakOnePlaceLeft"),
  kayakCompanion: pinnedId("kayakCompanion"),
  /** Ends 2027-01-17. Exposed by a window ending 2027-01-15: a date near
   * miss, 2 days outside. */
  runsPastWindow: pinnedId("runsPastWindow"),
  runsPastCompanion: pinnedId("runsPastCompanion"),
} as const;
