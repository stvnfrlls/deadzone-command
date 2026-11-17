export const TILE = 28;
export const GROUND_TILE_HEIGHT = 20;
export const MAP_W = 82;
export const MAP_H = 58;
export const SURVIVORS_PER_GROUP = 4;
export const SURVIVOR_TARGET = 24;
export type Faction = 'human' | 'raider' | 'zombie';
export type Terrain = 'grass' | 'forest' | 'sand' | 'road' | 'bridge' | 'water' | 'ruin';
export const ENVIRONMENT_LABELS = {
  forest: 'Forest',
  coastal: 'Coastal',
  islands: 'Islands',
  downtown: 'Downtown',
} as const;
export type Environment = keyof typeof ENVIRONMENT_LABELS;
export const TERRAIN_COLORS: Record<Environment, Record<Terrain, number>> = {
  forest: { grass: 0x365039, forest: 0x243d30, sand: 0x7d734f, road: 0x50554b, bridge: 0x67655c, water: 0x16475a, ruin: 0x4f5653 },
  coastal: { grass: 0x3a4b3c, forest: 0x223b32, sand: 0x8b7953, road: 0x494e4b, bridge: 0x67655c, water: 0x16475a, ruin: 0x4f5653 },
  islands: { grass: 0x416049, forest: 0x2b4839, sand: 0xa18b5e, road: 0x555b52, bridge: 0x756d58, water: 0x1c5365, ruin: 0x5f6256 },
  downtown: { grass: 0x444b4c, forest: 0x33483e, sand: 0x817664, road: 0x343c42, bridge: 0x67655c, water: 0x16475a, ruin: 0x535052 },
};
export type UnitKind = 'worker' | 'rifleman' | 'gunner' | 'sniper' | 'scout' | 'demolition' | 'tank' | 'apc' | 'reconBuggy' | 'mortarCarrier' | 'raider' | 'raiderTank' | 'walker' | 'runner' | 'brute';
export type BuildingKind = 'hq' | 'barracks' | 'power' | 'scrapyard' | 'refinery' | 'farm' | 'warFactory' | 'research' | 'garage' | 'armory' | 'turret' | 'wall' | 'radar' | 'hospital' | 'workshop' | 'depot' | 'academy';
export type ResourceKey = 'scrap' | 'oil' | 'food';
export type Resources = Record<ResourceKey, number>;
export type Cost = Partial<Resources>;
export const RESOURCE_DEPOSITS = {
  scrap: { label: 'Metal', icon: '◈', color: 0xd9bc7c, amount: 360 },
  oil: { label: 'Oil', icon: '●', color: 0xe49b6b, amount: 264 },
  food: { label: 'Food', icon: '◆', color: 0xa6ce80, amount: 288 },
} satisfies Record<ResourceKey, { label: string; icon: string; color: number; amount: number }>;
export interface StructureDef {
  label: string;
  short: string;
  description: string;
  size: [number, number];
  cost: Cost;
  requires?: BuildingKind;
  power?: number;
  generates?: number;
  income?: Cost;
  hp: number;
}
export interface UnitDef {
  label: string;
  description: string;
  cost: Cost;
  hp: number;
  speed: number;
  range: number;
  damage: number;
  cooldown: number;
  buildTime: number;
  building?: BuildingKind;
  vehicle?: boolean;
  sight?: number;
  structureDamageMultiplier?: number;
}
export interface TechDef {
  label: string;
  description: string;
  requires: BuildingKind;
  max: number;
  cost: Cost;
  seconds: number;
}
export type TechId = 'cure' | 'weapons' | 'armor' | 'defenses' | 'engines' | 'vehicleArmor' | 'vehicleWeapons';
export const STRUCTURES: Record<BuildingKind, StructureDef> = {
  hq: { label: 'Command Center', short: 'HQ', description: 'Your headquarters. Protect it at all costs.', size: [3, 3], cost: { scrap: 400 }, hp: 1350, generates: 10 },
  barracks: { label: 'Barracks', short: 'BRK', description: 'Trains infantry and tactical specialists.', size: [2, 2], cost: { scrap: 170 }, hp: 520, power: 2 },
  power: { label: 'Power Plant', short: 'PWR', description: 'Generates electricity for your base.', size: [2, 2], cost: { scrap: 110, oil: 40 }, hp: 470, generates: 12 },
  scrapyard: { label: 'Scrap Yard', short: 'SCR', description: 'Recovers scrap from surrounding ruins.', size: [2, 2], cost: { scrap: 140 }, hp: 440, power: 1, income: { scrap: 8 } },
  refinery: { label: 'Oil Refinery', short: 'OIL', description: 'Produces oil for armor and industry.', size: [2, 2], cost: { scrap: 190, oil: 45 }, hp: 510, power: 3, income: { oil: 5 } },
  farm: { label: 'Food Farm', short: 'FRM', description: 'Produces food to sustain military units.', size: [2, 2], cost: { scrap: 115 }, hp: 370, power: 1, income: { food: 6 } },
  warFactory: { label: 'War Factory', short: 'WAR', description: 'Builds APCs and heavy battle tanks.', size: [3, 3], cost: { scrap: 350, oil: 110 }, hp: 780, power: 6, requires: 'barracks' },
  research: { label: 'Research Institute', short: 'R&D', description: 'Unlocks infantry, armor and defense improvements.', size: [3, 2], cost: { scrap: 300, oil: 85 }, hp: 560, power: 5, requires: 'barracks' },
  garage: { label: 'Vehicle Garage', short: 'GAR', description: 'Repairs and upgrades vehicles.', size: [3, 2], cost: { scrap: 255, oil: 75 }, hp: 580, power: 3, requires: 'warFactory' },
  armory: { label: 'Armory', short: 'ARM', description: 'Supports infantry equipment and training.', size: [2, 2], cost: { scrap: 210, oil: 35 }, hp: 440, power: 2, requires: 'barracks' },
  turret: { label: 'Guard Turret', short: 'DEF', description: 'Automatic defense against zombies and raiders.', size: [1, 1], cost: { scrap: 105, oil: 20 }, hp: 310, power: 2 },
  wall: { label: 'Concrete Wall', short: 'WAL', description: 'Cheap fortification that blocks movement.', size: [1, 1], cost: { scrap: 25 }, hp: 350 },
  radar: { label: 'Radar Station', short: 'RAD', description: 'Improves base visibility and reconnaissance.', size: [2, 2], cost: { scrap: 220, oil: 75 }, hp: 400, power: 4, requires: 'research' },
  hospital: { label: 'Field Hospital', short: 'MED', description: 'Automatically heals nearby friendly infantry.', size: [2, 2], cost: { scrap: 190, food: 75 }, hp: 420, power: 2, requires: 'barracks' },
  workshop: { label: 'Engineering Workshop', short: 'ENG', description: 'Repairs nearby buildings.', size: [2, 2], cost: { scrap: 180, oil: 20 }, hp: 410, power: 2 },
  depot: { label: 'Supply Depot', short: 'SUP', description: 'Improves basic oil, scrap and food supplies.', size: [2, 2], cost: { scrap: 150 }, hp: 440, income: { scrap: 2, oil: 2, food: 2 } },
  academy: { label: 'Military Academy', short: 'ACA', description: 'Adds experience to newly trained infantry.', size: [2, 2], cost: { scrap: 280, food: 120 }, hp: 510, power: 3, requires: 'research' }
};
export const UNITS: Record<UnitKind, UnitDef> = {
  worker: { label: 'Worker', description: 'Mines metal for scrap and hauls resources back to base.', cost: { scrap: 40, food: 15 }, hp: 54, speed: 74, range: 0, damage: 0, cooldown: 0, buildTime: 5, building: 'hq' },
  rifleman: { label: 'Rifleman', description: 'Versatile combat infantry.', cost: { scrap: 45, food: 10 }, hp: 65, speed: 68, range: 7 * TILE, damage: 9, cooldown: 0.9, buildTime: 4, building: 'barracks' },
  gunner: { label: 'Heavy Gunner', description: 'Suppresses hordes and armored raiders.', cost: { scrap: 85, food: 16 }, hp: 105, speed: 54, range: 121, damage: 16, cooldown: 1.15, buildTime: 7, building: 'barracks' },
  sniper: { label: 'Sniper', description: 'Long-range infantry support.', cost: { scrap: 105, food: 15 }, hp: 48, speed: 62, range: 245, damage: 32, cooldown: 2.5, buildTime: 8, building: 'barracks' },
  scout: { label: 'Scout', description: 'Fast infantry with an extended sight range.', cost: { scrap: 55, food: 12 }, hp: 44, speed: 105, range: 126, damage: 7, cooldown: .75, buildTime: 4, building: 'barracks', sight: 10 },
  demolition: { label: 'Demolition Trooper', description: 'Short-range rockets deal double damage to structures.', cost: { scrap: 115, food: 24 }, hp: 88, speed: 59, range: 112, damage: 23, cooldown: 1.45, buildTime: 7, building: 'barracks', structureDamageMultiplier: 2 },
  apc: { label: 'APC', description: 'Fast armored support vehicle.', cost: { scrap: 145, oil: 65 }, hp: 215, speed: 77, range: 105, damage: 14, cooldown: 0.9, buildTime: 11, building: 'warFactory', vehicle: true },
  tank: { label: 'Battle Tank', description: 'Heavy armor for base assaults.', cost: { scrap: 225, oil: 100 }, hp: 380, speed: 46, range: 170, damage: 46, cooldown: 2.2, buildTime: 16, building: 'warFactory', vehicle: true },
  reconBuggy: { label: 'Recon Buggy', description: 'Fast, lightly armored recon vehicle with wide visibility.', cost: { scrap: 115, oil: 42 }, hp: 126, speed: 122, range: 140, damage: 10, cooldown: .58, buildTime: 8, building: 'warFactory', vehicle: true, sight: 12 },
  mortarCarrier: { label: 'Mortar Carrier', description: 'Slow armored vehicle with long-range fire support.', cost: { scrap: 195, oil: 82 }, hp: 175, speed: 42, range: 336, damage: 38, cooldown: 2.3, buildTime: 15, building: 'warFactory', vehicle: true },
  raider: { label: 'Raider', description: 'Armed scavenger.', cost: {}, hp: 69, speed: 62, range: 105, damage: 9, cooldown: 1.0, buildTime: 0 },
  raiderTank: { label: 'Raider Technical', description: 'Improvised armored vehicle.', cost: {}, hp: 190, speed: 56, range: 143, damage: 20, cooldown: 1.6, buildTime: 0, vehicle: true },
  walker: { label: 'Walker', description: 'Slow but persistent infected.', cost: {}, hp: 37, speed: 29, range: 18, damage: 7, cooldown: 1.2, buildTime: 0 },
  runner: { label: 'Runner', description: 'Fast infected that closes distance quickly.', cost: {}, hp: 26, speed: 65, range: 18, damage: 5, cooldown: 0.7, buildTime: 0 },
  brute: { label: 'Brute', description: 'Heavily mutated infected.', cost: {}, hp: 170, speed: 33, range: 25, damage: 23, cooldown: 1.6, buildTime: 0 }
};
export const TECH: Record<TechId, TechDef> = {
  cure: { label: 'Infection Cure', description: 'Research the treatment needed to restore humanity.', requires: 'research', max: 1, cost: { scrap: 240, oil: 90 }, seconds: 30 },
  weapons: { label: 'Infantry Ballistics', description: '+18% infantry damage per level.', requires: 'research', max: 3, cost: { scrap: 140, oil: 45 }, seconds: 18 },
  armor: { label: 'Composite Body Armor', description: '+20% infantry maximum health per level.', requires: 'research', max: 3, cost: { scrap: 125, food: 45 }, seconds: 16 },
  defenses: { label: 'Fortification Systems', description: '+25% turret damage per level.', requires: 'research', max: 3, cost: { scrap: 165, oil: 70 }, seconds: 20 },
  engines: { label: 'Tuned Engines', description: '+12% vehicle movement speed per level.', requires: 'garage', max: 3, cost: { scrap: 135, oil: 70 }, seconds: 18 },
  vehicleArmor: { label: 'Reinforced Plating', description: '+20% vehicle maximum health per level.', requires: 'garage', max: 3, cost: { scrap: 175, oil: 85 }, seconds: 22 },
  vehicleWeapons: { label: 'High-Impact Shells', description: '+20% vehicle firepower per level.', requires: 'garage', max: 3, cost: { scrap: 190, oil: 90 }, seconds: 23 }
};
export interface MapSite { tx: number; ty: number; }
export interface ResourceNode extends MapSite { kind: ResourceKey; remaining: number; }
export interface Cargo { kind: ResourceKey; amount: number; }
export interface TileMap {
  seed: string; tiles: Terrain[][]; w: number; h: number;
  environment?: Environment;
  playerStart?: MapSite; raiderStarts?: MapSite[];
  resourceNodes?: ResourceNode[];
}
export interface UnitData {
  id: number; kind: UnitKind; faction: Faction; x: number; y: number; hp: number; maxHp: number;
  cooldown: number; xp: number; holdingPosition?: boolean;
  cargo?: Cargo; gatherTarget?: number;
}
export interface BuildingData {
  id: number; kind: BuildingKind; faction: Faction; tx: number; ty: number;
  hp: number; maxHp: number; level: number;
  production?: { kind: UnitKind; remaining: number }[];
}
export interface ResearchJob { id: TechId; remaining: number; }
export interface SurvivorGroupData {
  id: number; x: number; y: number;
  rescued: boolean; discovered: boolean; escortId: number | null;
}
export interface RestorationProgress {
  rescued: number;
  settlementReady: boolean;
  cureReady: boolean;
}
export interface GameSave {
  version: 1; seed: string; map: TileMap; units: UnitData[]; buildings: BuildingData[];
  resources: Resources; techs: Partial<Record<TechId, number>>; research: ResearchJob | null;
  survivorGroups?: SurvivorGroupData[];
  explored: boolean[][]; elapsed: number; nextId: number; status: 'playing' | 'won' | 'lost';
}
export interface UiSnapshot {
  seed: string; map: TileMap; explored: boolean[][]; visible: boolean[][];
  resources: Resources; powerProduced: number; powerUsed: number;
  selected: string; selectedIds: number[]; selectedType: 'unit' | 'building' | null;
  holdingPosition: boolean; workerSelected: boolean;
  buildings: { kind: BuildingKind; count: number }[];
  units: { id: number; faction: Faction; kind: UnitKind; tx: number; ty: number }[];
  structures: { id: number; faction: Faction; kind: BuildingKind; tx: number; ty: number }[];
  survivorSites: (MapSite & { escorted: boolean })[];
  restoration: RestorationProgress;
  techs: Record<TechId, number>; research: ResearchJob | null;
  production: {
    buildingId: number; building: BuildingKind; tx: number; ty: number;
    jobs: NonNullable<BuildingData['production']>;
  }[];
  placement: BuildingKind | null;
  raiderBases: number; totalRaiderBases: number; zombieCount: number;
  elapsed: number; status: 'playing' | 'won' | 'lost'; paused: boolean;
  messages: { id: number; text: string }[];
}
export const STORAGE_KEY = 'deadzone-command-save-v1';
export const fmtCost = (cost: Cost) => Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(' · ');
