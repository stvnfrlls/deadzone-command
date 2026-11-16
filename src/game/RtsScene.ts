import Phaser from 'phaser';
import { action, publish, registerController, type GameController } from './bridge';
import { center, createMap, createResourceNodes, createSurvivorSites, findPath, hasLineOfSight, legacyPlayerStart, RAIDER_BASE_COUNT, seededRandom, walkable } from './map';
import { MAP_H, MAP_W, TILE, STORAGE_KEY, RESOURCE_DEPOSITS, STRUCTURES, SURVIVORS_PER_GROUP, SURVIVOR_TARGET, TERRAIN_COLORS, TECH, UNITS, type BuildingData, type BuildingKind, type Faction, type GameSave, type MapSite, type ResearchJob, type Resources, type RestorationProgress, type SurvivorGroupData, type TechId, type TileMap, type UiSnapshot, type UnitData, type UnitKind } from './model';

type Point = { x: number; y: number };
type Unit = UnitData & { sprite: Phaser.GameObjects.Image; path: Point[]; goal: Point | null; attackId: number | null; nextPath: number; patrol: boolean; holdingPosition: boolean; gatherProgress: number };
type Building = BuildingData & { sprite: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text };
type SurvivorGroup = SurvivorGroupData & { sprite: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; path: Point[]; nextPath: number };
type Shot = { from: Point; to: Point; age: number; flight: number; distance: number; color: number; heavy: boolean };
const GROUND_SCALE = 20 / TILE;
const GROUND_TILE_HEIGHT = TILE * GROUND_SCALE;
const BUILDING_HEADROOM = 30;
const UNIT_HEIGHT = 30;
const UNIT_FEET = 24;
const GUARD_TURRET_RANGE = 180;
const WORKER_CAPACITY = 24;
const GATHER_SECONDS = 2.1;
const freshTech = (): Record<TechId, number> => ({ cure: 0, weapons: 0, armor: 0, defenses: 0, engines: 0, vehicleArmor: 0, vehicleWeapons: 0 });
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const isVehicle = (kind: UnitKind) => Boolean(UNITS[kind].vehicle);
const isZombie = (kind: UnitKind) => kind === 'walker' || kind === 'runner' || kind === 'brute';
const actorDepth = (groundY: number) => 10 + groundY / (MAP_H * TILE);

export class RtsScene extends Phaser.Scene implements GameController {
  map!: TileMap;
  units: Unit[] = [];
  buildings: Building[] = [];
  private groups: SurvivorGroup[] = [];
  resources: Resources = { scrap: 970, oil: 360, food: 310 };
  techs = freshTech();
  research: ResearchJob | null = null;
  selected: number[] = [];
  selectedType: 'unit' | 'building' | null = null;
  placement: BuildingKind | null = null;
  explored: boolean[][] = [];
  visibleTiles: boolean[][] = [];
  elapsed = 0;
  nextId = 1;
  status: 'playing' | 'won' | 'lost' = 'playing';
  pausedByPlayer = false;
  messages: { id: number; text: string }[] = [];
  lastSnapshot = 0;
  nextAi = 0;
  nextIncome = 0;
  nextFog = 0;
  nextRaid = 18;
  nextZombies = 11;
  nextMessageId = 0;
  rng!: () => number;
  selectionOverlay!: Phaser.GameObjects.Graphics;
  groundSelection!: Phaser.GameObjects.Graphics;
  resourceOverlay!: Phaser.GameObjects.Graphics;
  previewOverlay!: Phaser.GameObjects.Graphics;
  fogOverlay!: Phaser.GameObjects.Graphics;
  shotOverlay!: Phaser.GameObjects.Graphics;
  private shots: Shot[] = [];
  private resourceLabels: Phaser.GameObjects.Text[] = [];
  dragStart: Point | null = null;
  dragEnd: Point | null = null;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private saveToRestore?: GameSave;
  private seed: string;

  constructor(seed = 'OUTBREAK-001', saved?: GameSave) {
    super({ key: 'RTS' });
    this.seed = seed;
    this.saveToRestore = saved;
  }

  create() {
    const operation = this.saveToRestore
      ? { map: this.saveToRestore.map, save: this.saveToRestore }
      : { map: createMap(this.seed), save: undefined };
    this.map = operation.map;
    this.rng = seededRandom(`${this.seed}-ai`);
    this.explored = this.saveToRestore?.explored ?? Array.from({ length: MAP_H }, () => Array<boolean>(MAP_W).fill(false));
    this.visibleTiles = Array.from({ length: MAP_H }, () => Array<boolean>(MAP_W).fill(false));
    this.drawTerrain();
    this.resourceOverlay = this.add.graphics().setDepth(.5);
    this.fogOverlay = this.add.graphics().setDepth(1);
    this.groundSelection = this.add.graphics().setDepth(2);
    this.previewOverlay = this.add.graphics().setDepth(3);
    this.shotOverlay = this.add.graphics().setDepth(19);
    this.selectionOverlay = this.add.graphics().setDepth(20);
    this.createTextures();
    if (operation.save) this.loadSave(operation.save);
    else this.startBattle(operation.map.playerStart, operation.map.raiderStarts);
    const hq = this.headquarters();
    const home = this.map.playerStart ?? (hq ? { tx: hq.tx + 2, ty: hq.ty + 2 } : legacyPlayerStart);
    const occupied = this.blockedCells();
    this.map.resourceNodes ??= createResourceNodes(this.map, home, occupied);
    this.drawResourceNodes();
    const groups = operation.save?.survivorGroups ?? (this.status === 'playing' ?
      createSurvivorSites(this.map, home, occupied).map(({ tx, ty }, id) => ({
        id, ...center(tx, ty), rescued: false, discovered: false, escortId: null,
      })) : []);
    this.groups = groups.map(group => this.spawnSurvivors(group));
    this.cameras.main.setBounds(0, -BUILDING_HEADROOM, MAP_W * TILE, MAP_H * GROUND_TILE_HEIGHT + BUILDING_HEADROOM);
    this.cameras.main.setZoom(1.04);
    this.focusHome();
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.dragStart && pointer.isDown) this.dragEnd = this.pointerPosition(pointer);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onPointerUp(pointer));
    this.input.on('wheel', (_p: unknown, _objs: unknown, _dx: number, dy: number) => {
      const camera = this.cameras.main;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom - Math.sign(dy) * .11, .65, 1.85));
    });
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,ESC,P') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on('keydown-ESC', () => { this.placement = null; this.emitSnapshot(); });
    this.input.keyboard!.on('keydown-P', () => this.togglePause());
    this.input.keyboard!.on('keydown-SPACE', () => this.focusHome());
    registerController(this);
    this.events.once('shutdown', () => { if (action() === this) registerController(null); });
    this.updateVisibility();
    this.emitSnapshot();
    if (!operation.save) this.message('Escort survivors to HQ. Build a powered farm and hospital, then research the infection cure.');
  }

  private startBattle(home: MapSite, raiderSites: MapSite[]) {
    this.spawnBuilding('hq', 'human', home.tx - 2, home.ty - 2);
    this.spawnBuilding('power', 'human', home.tx + 3, home.ty - 3);
    this.spawnBuilding('barracks', 'human', home.tx - 3, home.ty + 3);
    this.spawnBuilding('scrapyard', 'human', home.tx + 3, home.ty + 3);
    for (const [dx, dy, kind] of [[1, -2, 'rifleman'], [1, -1, 'rifleman'], [2, 0, 'rifleman'], [3, -1, 'gunner']] as [number, number, UnitKind][]) {
      const pos = center(home.tx + dx, home.ty + dy);
      this.spawnUnit(kind, 'human', pos.x, pos.y);
    }
    const workerStart = center(home.tx + 5, home.ty - 2);
    this.spawnUnit('worker', 'human', workerStart.x, workerStart.y);
    for (const site of raiderSites) {
      this.spawnBuilding('hq', 'raider', site.tx - 1, site.ty - 1);
      this.spawnBuilding('turret', 'raider', site.tx - 4, site.ty - 2);
      this.spawnBuilding('turret', 'raider', site.tx + 3, site.ty + 3);
      for (let i = 0; i < 4; i++) {
        const pos = center(site.tx + (i % 3) - 3, site.ty + Math.floor(i / 3) + 2);
        this.spawnUnit(i === 3 ? 'raiderTank' : 'raider', 'raider', pos.x, pos.y);
      }
    }
    for (let i = 0; i < 15; i++) this.spawnWanderer();
  }

  private loadSave(save: GameSave) {
    this.resources = { ...save.resources };
    this.techs = { ...freshTech(), ...save.techs };
    this.research = save.research;
    this.elapsed = save.elapsed;
    this.nextId = save.nextId;
    this.status = save.status;
    for (const item of save.buildings) this.spawnBuilding(item.kind, item.faction, item.tx, item.ty, item);
    for (const item of save.units) this.spawnUnit(item.kind, item.faction, item.x, item.y, item);
    this.nextRaid = this.elapsed + 15;
    this.nextZombies = this.elapsed + 10;
    this.nextIncome = this.elapsed + 4;
    this.nextAi = this.elapsed;
    this.message('Saved operation restored.');
  }

  private drawTerrain() {
    const g = this.make.graphics({ x: 0, y: 0 });
    const rand = seededRandom(`${this.map.seed}-terrain`);
    const environment = this.map.environment ?? 'coastal';
    const colors = TERRAIN_COLORS[environment];
    const roadAt = (x: number, y: number) => {
      const tile = this.map.tiles[y]?.[x];
      return tile === 'road' || tile === 'bridge';
    };
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const kind = this.map.tiles[y][x], px = x * TILE, py = y * TILE;
      g.fillStyle(colors[kind]); g.fillRect(px, py, TILE, TILE);
      if (kind === 'grass' || kind === 'sand') {
        g.fillStyle(kind === 'sand' ? 0xb6a073 : environment === 'downtown' ? 0x626866 : 0x50634a, .66);
        for (let i = 0; i < 3; i++) g.fillRect(px + 2 + rand() * 22, py + 2 + rand() * 22, 2, 2);
      } else if (kind === 'forest') {
        g.fillStyle(0x18362c); g.fillCircle(px + 9, py + 8, 7); g.fillCircle(px + 20, py + 17, 7);
        g.fillStyle(0x39624a); g.fillRect(px + 6, py + 7, 5, 3); g.fillRect(px + 17, py + 14, 5, 3);
      } else if (kind === 'road' || kind === 'bridge') {
        const horizontal = roadAt(x - 1, y) || roadAt(x + 1, y);
        const vertical = roadAt(x, y - 1) || roadAt(x, y + 1);
        if (kind === 'bridge') {
          g.fillStyle(0xa4a18c);
          if (horizontal || !vertical) g.fillRect(px, py + 2, TILE, 2).fillRect(px, py + 24, TILE, 2);
          else g.fillRect(px + 2, py, 2, TILE).fillRect(px + 24, py, 2, TILE);
        } else {
          g.fillStyle(0x74786d, .42);
          if (horizontal) g.fillRect(px, py + 13, TILE, 2);
          if (vertical) g.fillRect(px + 13, py, 2, TILE);
          g.fillStyle(0xc3ac6c, .6);
          if (horizontal && !vertical && x % 2 === 0) g.fillRect(px + 8, py + 13, 10, 2);
          if (vertical && !horizontal && y % 2 === 0) g.fillRect(px + 13, py + 8, 2, 10);
        }
      } else if (kind === 'water') {
        g.fillStyle(0x2c6b7c, .55); g.fillRect(px + (x + y) % 5 + 4, py + 9, 10, 2);
      } else if (kind === 'ruin') {
        g.fillStyle(0x354043); g.fillRect(px + 2, py + 4, 24, 22);
        g.fillStyle(environment === 'downtown' ? 0x6e6563 : 0x655e51); g.fillRect(px + 4, py + 4, 19, 20);
        g.fillStyle(environment === 'downtown' ? 0xa19a93 : 0x999483); g.fillRect(px + 4, py + 3, 20, 5); g.fillRect(px + 4, py + 8, 4, 11);
        g.fillStyle(0x202b2e); g.fillRect(px + 8, py + 8, 13, 11); g.fillRect(px + 12, py + 21, 6, 3);
        g.fillStyle(0x706d5f); g.fillRect(px + 9, py + 13, 6, 4); g.fillRect(px + 21, py + 9, 3, 7);
      }
      g.lineStyle(.45, 0x0c1920, .12); g.strokeRect(px, py, TILE, TILE);
    }
    g.generateTexture('battlefield', MAP_W * TILE, MAP_H * TILE);
    g.destroy();
    this.add.image(0, 0, 'battlefield').setOrigin(0).setScale(1, GROUND_SCALE);
  }

  private drawResourceNodes() {
    const g = this.resourceOverlay;
    g.clear();
    for (const label of this.resourceLabels) label.destroy();
    this.resourceLabels = [];
    for (const node of this.map.resourceNodes ?? []) {
      if (node.remaining <= 0) continue;
      const x = (node.tx + .5) * TILE, y = (node.ty + .5) * GROUND_TILE_HEIGHT;
      const { label, color } = RESOURCE_DEPOSITS[node.kind];
      g.fillStyle(0x142321, .8).fillRect(x - 9, y - 3, 19, 11);
      if (node.kind === 'scrap') {
        g.fillStyle(0x74654d).fillRect(x - 7, y - 3, 14, 9);
        g.fillStyle(color).fillRect(x - 6, y - 2, 6, 3).fillRect(x + 2, y + 1, 4, 3);
      } else if (node.kind === 'oil') {
        g.fillStyle(0x604237).fillRect(x - 8, y - 3, 7, 9).fillRect(x + 2, y - 3, 7, 9);
        g.fillStyle(color).fillRect(x - 7, y - 3, 5, 2).fillRect(x + 3, y - 3, 5, 2);
      } else {
        g.fillStyle(0x506841).fillRect(x - 7, y - 3, 14, 9);
        g.fillStyle(color).fillRect(x - 6, y - 2, 12, 3).fillRect(x - 3, y + 3, 6, 2);
      }
      this.resourceLabels.push(this.add.text(x, y - 5, label.toUpperCase(), {
        color: '#f0e7ce', backgroundColor: '#182523', fontSize: '8px', fontFamily: 'monospace',
        padding: { x: 2, y: 1 },
      }).setOrigin(.5, 1).setDepth(.6));
    }
  }

  private createTextures() {
    const survivors = this.make.graphics({ x: 0, y: 0 });
    for (const [x, y, color] of [[7, 9, 0xc9aa78], [19, 9, 0x91b4a4], [12, 15, 0xa78167], [23, 15, 0xc3b493]]) {
      survivors.fillStyle(0x172222).fillRect(x - 3, y - 4, 7, 12);
      survivors.fillStyle(0xe0bd91).fillRect(x - 1, y - 4, 4, 4);
      survivors.fillStyle(color).fillRect(x - 2, y, 5, 5);
      survivors.fillStyle(0x314444).fillRect(x - 2, y + 6, 2, 2).fillRect(x + 1, y + 6, 2, 2);
    }
    survivors.generateTexture('survivor-group', 32, 26);
    survivors.destroy();
    for (const faction of ['human', 'raider', 'zombie'] as const) {
      for (const kind of Object.keys(UNITS) as UnitKind[]) {
        if ((faction === 'zombie') === isZombie(kind)) this.createUnitTexture(kind, faction);
      }
    }
    for (const faction of ['human', 'raider'] as const) {
      for (const kind of Object.keys(STRUCTURES) as BuildingKind[]) this.createBuildingTexture(kind, faction);
    }
  }

  private spawnSurvivors(data: SurvivorGroupData): SurvivorGroup {
    const y = data.y * GROUND_SCALE;
    const sprite = this.add.image(data.x, y, 'survivor-group').setOrigin(.5, 21 / 26).setDepth(actorDepth(data.y)).setVisible(false);
    const label = this.add.text(data.x, y - 23, data.escortId === null ? `${SURVIVORS_PER_GROUP} SURVIVORS` : `${SURVIVORS_PER_GROUP} FOLLOWING`, {
      color: '#f5dfad', backgroundColor: '#151f22', fontSize: '9px', fontFamily: 'monospace', padding: { x: 3, y: 1 },
    }).setOrigin(.5, 1).setDepth(18).setVisible(false);
    return { ...data, sprite, label, path: [], nextPath: 0 };
  }

  private createUnitTexture(kind: UnitKind, faction: Faction) {
    const g = this.make.graphics({ x: 0, y: 0 });
    const rect = (color: number, x: number, y: number, w: number, h: number) => g.fillStyle(color).fillRect(x, y, w, h);
    const allied = faction === 'human';
    const base = allied ? 0x73978b : 0xa26b47;
    const light = allied ? 0xb1c3a0 : 0xd0a16d;
    const shade = allied ? 0x435e56 : 0x62433a;
    const ink = 0x1a2525;

    if (isVehicle(kind)) {
      g.fillStyle(0x111c1a, .55).fillEllipse(18, 24, 34, 9);
      rect(ink, 3, 11, 29, 13);
      rect(shade, 5, 9, 24, 7);
      rect(base, 6, 7, 23, 8);
      rect(light, 8, 7, 19, 2);
      rect(shade, 7, 15, 22, 5);
      if (kind === 'tank') {
        for (let x = 6; x < 30; x += 5) rect(0x53605a, x, 20, 3, 3);
        rect(ink, 11, 4, 13, 10);
        rect(light, 12, 3, 11, 6);
        rect(base, 12, 9, 12, 4);
        rect(ink, 22, 6, 13, 4);
        rect(light, 23, 6, 10, 2);
      } else {
        for (const x of [6, 15, 25]) {
          rect(ink, x, 18, 6, 6);
          rect(0x677169, x + 2, 20, 2, 2);
        }
        rect(0x283d3a, 22, 9, 6, 4);
        rect(light, 29, 14, 2, 3);
        rect(kind === 'apc' ? base : 0x714631, 9, 9, 11, 5);
        rect(ink, 14, 4, 4, 6);
        rect(light, 17, 5, 8, 2);
      }
    } else if (isZombie(kind)) {
      const brute = kind === 'brute', runner = kind === 'runner';
      const x = runner ? 17 : 15, top = brute ? 3 : runner ? 8 : 6;
      const cloth = brute ? 0x58684a : runner ? 0x795457 : 0x606b50;
      const skin = brute ? 0xa7b588 : 0xb1b58c;
      g.fillStyle(0x15201c, .55).fillEllipse(18, 24, brute ? 20 : 14, 5);
      rect(ink, x - 2, 17, 5, 7);
      rect(ink, x + 4, 17, 4, 7);
      rect(cloth, x, 11, brute ? 12 : 7, 8);
      rect(0x333f38, x + 1, 16, brute ? 10 : 5, 4);
      rect(0x394c3d, x, top, brute ? 8 : 6, 6);
      rect(skin, x + 2, top + 2, brute ? 6 : 5, 4);
      rect(0x702f2d, x + 5, top + 3, 2, 1);
      rect(skin, x - 2, 12, brute ? 4 : 2, 7);
      rect(skin, x + (brute ? 10 : 5), 11, brute ? 7 : 5, 3);
      rect(cloth, x + (brute ? 14 : 8), 10, 4, 2);
    } else {
      const heavy = kind === 'gunner', sniper = kind === 'sniper';
      const worker = kind === 'worker';
      const uniform = worker ? 0xbd9351 : sniper ? 0x638369 : base;
      g.fillStyle(0x15201c, .55).fillEllipse(18, 24, 16, 5);
      rect(ink, 14, 17, 4, 7);
      rect(ink, 20, 17, 3, 7);
      rect(shade, 14, 17, 8, 4);
      rect(shade, heavy ? 11 : 13, 10, heavy ? 7 : 5, 7);
      rect(uniform, 15, 9, heavy ? 9 : 7, 9);
      rect(light, 14, 10, heavy ? 6 : 4, 3);
      rect(ink, 15, 4, 7, 6);
      rect(allied ? uniform : 0x7a483a, 15, 3, 8, 4);
      rect(0xd8b68c, 18, 7, 5, 3);
      if (worker) {
        rect(ink, 24, 10, 2, 12);
        rect(0xd6c39b, 21, 9, 8, 3);
        rect(0xe2be70, 14, 3, 10, 2);
      } else {
        rect(ink, 20, 11, sniper ? 14 : heavy ? 13 : 11, heavy ? 4 : 3);
        rect(0x8c9a8a, 25, 11, sniper ? 8 : 5, 1);
        rect(light, 21, 13, 4, 2);
      }
      if (sniper) rect(0xcaaf70, 24, 9, 4, 2);
      if (heavy) rect(0x958551, 25, 15, 3, 3);
    }
    g.generateTexture(`unit-${faction}-${kind}`, 36, UNIT_HEIGHT);
    g.destroy();
  }

  private createBuildingTexture(kind: BuildingKind, faction: 'human' | 'raider') {
    const [tilesWide, tilesHigh] = STRUCTURES[kind].size;
    const w = tilesWide * TILE, groundHeight = tilesHigh * GROUND_TILE_HEIGHT;
    const g = this.make.graphics({ x: 0, y: 0 });
    const rect = (color: number, x: number, y: number, width: number, height: number) => g.fillStyle(color).fillRect(x, y, width, height);
    const allied = faction === 'human';
    const roof = allied ? 0x607b70 : 0x8a604c;
    const trim = allied ? 0x9bb49a : 0xc89b67;
    const front = allied ? 0x3a534e : 0x594038;
    const steel = 0x273a39, shadow = 0x182828, glass = 0xa5c3a8, paint = 0xd3aa58;
    const left = 6, right = w - 7, mid = Math.floor(w / 2), bottom = BUILDING_HEADROOM + groundHeight - 4;

    g.fillStyle(0x11201b, .52).fillRect(3, BUILDING_HEADROOM + 3, w - 5, groundHeight - 5);
    if (kind === 'farm') {
      rect(0x796543, 5, BUILDING_HEADROOM + 4, w - 10, groundHeight - 8);
      for (let x = 8; x < w - 9; x += 8) {
        rect(0x3c5133, x, BUILDING_HEADROOM + 6, 5, groundHeight - 12);
        for (let y = BUILDING_HEADROOM + 8; y < bottom - 3; y += 5) rect(0x8da75b, x + 1, y, 4, 2);
      }
      rect(0x99aa97, left, bottom - 14, 10, 10);
      rect(steel, left, bottom - 5, 10, 5);
    } else {
      const wallHeight = kind === 'wall' ? 8 : kind === 'turret' || kind === 'scrapyard' || kind === 'depot' ? 10 : kind === 'hq' || kind === 'warFactory' ? 20 : 15;
      const eave = bottom - wallHeight;
      const top = BUILDING_HEADROOM + (tilesHigh === 1 ? 5 : 9) - wallHeight;
      const window = (x: number, y: number, width: number) => {
        rect(shadow, x, y, width, 6);
        rect(glass, x + 1, y + 1, width - 2, 2);
      };
      const vent = (x: number, y: number) => {
        rect(steel, x, y, 10, 8);
        rect(trim, x + 1, y + 1, 8, 2);
        rect(0x5b6f63, x + 2, y + 4, 6, 1);
      };
      const bay = (x: number, width: number) => {
        rect(shadow, x, eave + 3, width, wallHeight - 3);
        rect(trim, x + 1, eave + 4, width - 2, 2);
        for (let stripe = x + 2; stripe < x + width - 2; stripe += 5) rect(paint, stripe, bottom - 2, 3, 2);
      };
      const tank = (x: number, y: number, width: number, length: number) => {
        rect(shadow, x + 2, y + 4, width, length);
        rect(front, x, y + 2, width, length);
        rect(trim, x, y, width, length - 4);
        rect(roof, x + 2, y + 2, width - 4, length - 7);
        rect(steel, x + 2, y + length - 4, width - 4, 2);
      };

      rect(shadow, left - 1, top - 1, right - left + 3, bottom - top + 2);
      rect(front, left, eave, right - left, wallHeight);
      rect(steel, right - 5, eave, 5, wallHeight);
      rect(roof, left, top, right - left, eave - top);
      rect(trim, left, top, right - left, 2);
      rect(allied ? 0x759288 : 0xa57857, left, eave - 2, right - left, 3);
      rect(steel, left, bottom - 2, right - left, 2);

      switch (kind) {
        case 'hq':
          rect(shadow, mid - 19, top + 6, 39, 22);
          rect(steel, mid - 19, top + 3, 36, 21);
          rect(trim, mid - 17, top + 3, 33, 3);
          window(mid - 15, top + 15, 28);
          rect(steel, mid + 12, top - 8, 2, 22);
          rect(trim, mid + 5, top - 8, 16, 2);
          rect(allied ? 0x92d3ac : 0xe38a58, mid + 16, top - 10, 3, 3);
          bay(mid - 10, 20);
          window(left + 4, eave + 7, 12);
          window(right - 19, eave + 7, 12);
          break;
        case 'barracks':
          rect(front, left + 4, top + 4, right - left - 8, 8);
          rect(trim, left + 4, top + 4, right - left - 8, 2);
          bay(mid - 5, 10);
          window(left + 3, eave + 6, 10);
          window(right - 15, eave + 6, 9);
          break;
        case 'power':
          for (const x of [left + 7, right - 16]) {
            rect(shadow, x + 2, top + 5, 9, 15);
            rect(steel, x, top - 8, 9, 23);
            rect(0xa8a995, x, top - 8, 9, 3);
            rect(paint, x, top - 3, 9, 2);
          }
          rect(paint, mid - 5, eave + 5, 9, 5);
          break;
        case 'refinery':
          tank(left + 4, top + 3, 13, 17);
          tank(right - 18, top + 3, 13, 17);
          rect(paint, mid - 4, top + 11, 8, 3);
          rect(steel, mid - 3, top + 12, 3, bottom - top - 13);
          break;
        case 'warFactory':
          bay(left + 8, 22);
          bay(right - 29, 22);
          for (let y = top + 7; y < eave - 3; y += 7) rect(front, left + 3, y, right - left - 6, 2);
          vent(right - 16, top + 5);
          break;
        case 'garage':
          bay(mid - 14, 28);
          vent(left + 6, top + 7);
          rect(trim, mid - 10, top + 8, 21, 3);
          rect(paint, right - 13, eave + 5, 6, 3);
          break;
        case 'research':
          for (const x of [left + 6, mid - 9, right - 25]) {
            rect(steel, x, top + 5, 18, 14);
            rect(0x7dada0, x + 2, top + 6, 14, 10);
            rect(glass, x + 3, top + 7, 12, 2);
          }
          window(mid - 22, eave + 4, 44);
          break;
        case 'radar':
          rect(steel, mid - 6, top + 9, 12, 12);
          rect(trim, mid - 2, top - 7, 4, 20);
          g.fillStyle(steel).fillEllipse(mid, top + 1, 27, 11);
          g.fillStyle(glass).fillEllipse(mid - 2, top - 1, 22, 8);
          rect(trim, mid + 2, top - 10, 2, 9);
          window(mid - 11, eave + 4, 22);
          break;
        case 'hospital':
          rect(0xb9bfb0, mid - 11, top + 4, 22, 16);
          rect(0xa34e45, mid - 2, top + 6, 4, 12);
          rect(0xa34e45, mid - 6, top + 10, 12, 4);
          window(mid - 17, eave + 5, 34);
          break;
        case 'turret':
          rect(steel, mid - 8, top - 1, 16, 12);
          rect(trim, mid - 6, top - 3, 12, 5);
          rect(shadow, mid + 3, top + 2, 11, 4);
          rect(trim, mid + 4, top + 2, 8, 2);
          break;
        case 'wall':
          rect(steel, mid - 1, top + 2, 2, bottom - top - 2);
          rect(trim, left + 2, eave + 3, 4, 2);
          rect(trim, right - 7, eave + 3, 4, 2);
          break;
        case 'scrapyard':
          rect(steel, left + 4, top + 5, 21, 13);
          rect(0xa38262, left + 7, top + 8, 7, 3);
          rect(trim, left + 13, top + 12, 8, 3);
          rect(shadow, right - 14, top + 4, 4, 18);
          rect(paint, right - 24, top + 4, 18, 3);
          rect(paint, right - 24, top + 5, 2, 9);
          break;
        case 'depot':
          for (const x of [left + 3, mid - 6, right - 15]) tank(x, top + 5, 12, 14);
          break;
        case 'armory':
          rect(steel, left + 4, top + 5, right - left - 8, 12);
          rect(trim, mid - 7, top + 6, 14, 2);
          bay(mid - 9, 18);
          break;
        case 'workshop':
          vent(left + 5, top + 5);
          vent(right - 16, top + 5);
          bay(mid - 11, 22);
          break;
        case 'academy':
          rect(paint, mid - 14, top + 7, 28, 3);
          rect(paint, mid - 10, top + 13, 20, 3);
          bay(mid - 6, 12);
          window(left + 4, eave + 5, 8);
          window(right - 13, eave + 5, 7);
          break;
      }
    }
    g.generateTexture(`building-${faction}-${kind}`, w, BUILDING_HEADROOM + groundHeight);
    g.destroy();
  }

  private spawnUnit(kind: UnitKind, faction: Faction, x: number, y: number, data?: UnitData): Unit {
    const def = UNITS[kind], vehicle = Boolean(def.vehicle);
    const extra = faction === 'human' ? 1 + (vehicle ? this.techs.vehicleArmor : this.techs.armor) * .2 : 1;
    const hp = Math.round(def.hp * extra);
    const sprite = this.add.image(x, y * GROUND_SCALE, `unit-${faction}-${kind}`)
      .setOrigin(.5, UNIT_FEET / UNIT_HEIGHT).setDepth(actorDepth(y));
    const unit: Unit = {
      id: data?.id ?? this.nextId++, kind, faction, x, y,
      hp: data?.hp ?? hp, maxHp: data?.maxHp ?? hp, cooldown: data?.cooldown ?? 0,
      xp: data?.xp ?? (faction === 'human' && !vehicle && this.hasBuilding('academy') ? 1 : 0),
      sprite, path: [], goal: null, attackId: null, nextPath: 0, patrol: false,
      holdingPosition: data?.holdingPosition ?? false, cargo: data?.cargo && { ...data.cargo },
      gatherTarget: data?.gatherTarget, gatherProgress: 0
    };
    this.units.push(unit);
    return unit;
  }

  private spawnBuilding(kind: BuildingKind, faction: Faction, tx: number, ty: number, data?: BuildingData): Building {
    const def = STRUCTURES[kind], x = tx * TILE, y = ty * GROUND_TILE_HEIGHT;
    const frontY = y + def.size[1] * GROUND_TILE_HEIGHT;
    const sprite = this.add.image(x, y - BUILDING_HEADROOM, `building-${faction}-${kind}`)
      .setOrigin(0).setDepth(actorDepth((ty + def.size[1]) * TILE - 4 / GROUND_SCALE));
    const label = this.add.text(x + def.size[0] * TILE / 2, frontY - 5, def.short,
      { color: '#e6e6d1', fontSize: '9px', fontStyle: 'bold', fontFamily: 'monospace', backgroundColor: '#101a1cdb', padding: { x: 3, y: 1 } })
      .setOrigin(.5, 0).setDepth(18);
    const building: Building = {
      id: data?.id ?? this.nextId++, kind, faction, tx, ty,
      hp: data?.hp ?? def.hp, maxHp: data?.maxHp ?? def.hp, level: data?.level ?? 1,
      production: data?.production ?? [], sprite, label
    };
    this.buildings.push(building);
    return building;
  }

  private hasBuilding(kind: BuildingKind) { return this.buildings.some(b => b.faction === 'human' && b.kind === kind && b.hp > 0); }
  private powerStats() {
    const human = this.buildings.filter(b => b.faction === 'human' && b.hp > 0);
    return {
      produced: human.reduce((sum, b) => sum + (STRUCTURES[b.kind].generates ?? 0), 0),
      used: human.reduce((sum, b) => sum + (STRUCTURES[b.kind].power ?? 0), 0)
    };
  }
  private powered() { const p = this.powerStats(); return p.produced >= p.used; }
  private afford(cost: Partial<Resources>) { return Object.entries(cost).every(([k, v]) => this.resources[k as keyof Resources] >= (v ?? 0)); }
  private pay(cost: Partial<Resources>) { for (const [key, value] of Object.entries(cost)) this.resources[key as keyof Resources] -= value ?? 0; }
  private message(text: string) {
    this.messages = [...this.messages.slice(-4), { id: ++this.nextMessageId, text }];
    this.emitSnapshot();
  }
  private validPlacement(kind: BuildingKind, tx: number, ty: number): boolean {
    const def = STRUCTURES[kind];
    if (tx < 1 || ty < 1 || tx + def.size[0] >= MAP_W - 1 || ty + def.size[1] >= MAP_H - 1) return false;
    for (let y = ty; y < ty + def.size[1]; y++) for (let x = tx; x < tx + def.size[0]; x++) {
      if (!['grass', 'sand'].includes(this.map.tiles[y][x])) return false;
      if (this.map.resourceNodes?.some(node => node.remaining > 0 && node.tx === x && node.ty === y)) return false;
      if (this.groups.some(group => !group.rescued && Math.floor(group.x / TILE) === x && Math.floor(group.y / TILE) === y)) return false;
      if (this.buildings.some(b => b.hp > 0 && x >= b.tx && y >= b.ty && x < b.tx + STRUCTURES[b.kind].size[0] && y < b.ty + STRUCTURES[b.kind].size[1])) return false;
    }
    const mid = center(tx + def.size[0] / 2, ty + def.size[1] / 2);
    return this.buildings.some(b => b.faction === 'human' && b.hp > 0 && near(mid, center(b.tx + STRUCTURES[b.kind].size[0] / 2, b.ty + STRUCTURES[b.kind].size[1] / 2)) < 10 * TILE);
  }

  place(kind: BuildingKind) {
    if (this.status !== 'playing') return;
    if (kind === 'hq') { this.message('The command center is unique.'); return; }
    const def = STRUCTURES[kind];
    if (def.requires && !this.hasBuilding(def.requires)) { this.message(`Requires ${STRUCTURES[def.requires].label}.`); return; }
    if (!this.afford(def.cost)) { this.message('Insufficient resources to construct ' + def.label + '.'); return; }
    this.placement = this.placement === kind ? null : kind;
    this.emitSnapshot();
  }
  private placeAt(tx: number, ty: number) {
    if (!this.placement) return;
    if (!this.validPlacement(this.placement, tx, ty)) { this.message('Invalid location. Build on clear land near your base.'); return; }
    const kind = this.placement;
    this.pay(STRUCTURES[kind].cost);
    this.spawnBuilding(kind, 'human', tx, ty);
    this.placement = null;
    this.message(`${STRUCTURES[kind].label} constructed.`);
    this.updateVisibility();
  }
  train(kind: UnitKind) {
    const def = UNITS[kind];
    if (!def.building || this.status !== 'playing') return;
    const building = this.buildings.find(b => b.faction === 'human' && b.kind === def.building && b.hp > 0 && (b.production?.length ?? 0) < 6);
    if (!building) { this.message(`Requires ${STRUCTURES[def.building].label} with an open queue slot.`); return; }
    if (!this.afford(def.cost)) { this.message('Insufficient resources to train ' + def.label + '.'); return; }
    if (!this.powered()) { this.message('Insufficient power. Build a power plant.'); return; }
    this.pay(def.cost);
    building.production!.push({ kind, remaining: def.buildTime });
    this.message(`${def.label} queued at ${STRUCTURES[building.kind].label}.`);
  }
  researchTechnology(id: TechId) {
    const def = TECH[id];
    if (this.status !== 'playing') return;
    if (!this.hasBuilding(def.requires)) { this.message(`Requires ${STRUCTURES[def.requires].label}.`); return; }
    if (this.research) { this.message('A research project is already active.'); return; }
    if (this.techs[id] >= def.max) { this.message('Technology already at maximum level.'); return; }
    const level = this.techs[id];
    const cost = Object.fromEntries(Object.entries(def.cost).map(([key, value]) => [key, Math.ceil((value ?? 0) * (1 + level * .6))]));
    if (!this.afford(cost)) { this.message('Insufficient resources for research.'); return; }
    if (!this.powered()) { this.message('Insufficient power for research.'); return; }
    this.pay(cost);
    this.research = { id, remaining: def.seconds * (1 + level * .35) };
    this.message(`Research started: ${def.label} level ${level + 1}.`);
  }
  private finishResearch(id: TechId) {
    this.techs[id]++;
    if (id === 'armor' || id === 'vehicleArmor') {
      for (const unit of this.units) {
        if (unit.faction !== 'human' || isVehicle(unit.kind) !== (id === 'vehicleArmor')) continue;
        const extra = Math.round(UNITS[unit.kind].hp * .2);
        unit.maxHp += extra;
        unit.hp += extra;
      }
    }
    this.message(id === 'cure' ? 'Infection cure research completed.' : `${TECH[id].label} upgraded to level ${this.techs[id]}.`);
  }
  repairVehicles() {
    const garages = this.buildings.filter(b => b.faction === 'human' && b.kind === 'garage' && b.hp > 0);
    if (!garages.length) { this.message('Construct a Vehicle Garage first.'); return; }
    if (this.resources.scrap < 25) { this.message('Vehicle repair requires 25 scrap.'); return; }
    const vehicles = this.units.filter(u => u.faction === 'human' && isVehicle(u.kind) && u.hp < u.maxHp && garages.some(g => near(u, center(g.tx + 1, g.ty + 1)) < 170));
    if (!vehicles.length) { this.message('No damaged vehicles in garage range.'); return; }
    this.resources.scrap -= 25;
    for (const unit of vehicles) unit.hp = Math.min(unit.maxHp, unit.hp + 75);
    this.message(`${vehicles.length} vehicle(s) repaired.`);
  }
  upgradeSelected() {
    if (this.selectedType !== 'building') return;
    const building = this.buildings.find(b => b.id === this.selected[0] && b.faction === 'human');
    if (!building) return;
    if (building.level >= 3) { this.message('Building is fully upgraded.'); return; }
    const cost = { scrap: 90 * building.level, oil: 25 * building.level };
    if (!this.afford(cost)) { this.message('Insufficient resources for structure upgrade.'); return; }
    this.pay(cost);
    building.level++;
    building.maxHp += Math.round(STRUCTURES[building.kind].hp * .25);
    building.hp += Math.round(STRUCTURES[building.kind].hp * .25);
    this.message(`${STRUCTURES[building.kind].label} upgraded to level ${building.level}.`);
  }
  togglePause() { this.pausedByPlayer = !this.pausedByPlayer; this.emitSnapshot(); }
  focusAt(tx: number, ty: number) { this.cameras.main.centerOn((tx + .5) * TILE, (ty + .5) * GROUND_TILE_HEIGHT); }
  private headquarters() { return this.buildings.find(b => b.faction === 'human' && b.kind === 'hq' && b.hp > 0); }
  private focusHome() {
    const hq = this.headquarters();
    if (hq) {
      const pos = this.entityPos(hq);
      this.cameras.main.centerOn(pos.x, pos.y * GROUND_SCALE);
    } else {
      const { tx, ty } = this.map.playerStart ?? legacyPlayerStart;
      this.focusAt(tx, ty);
    }
  }
  toggleHoldPosition() {
    const units = this.units.filter(u => this.selected.includes(u.id) && u.faction === 'human' && u.hp > 0);
    if (!units.length) return;
    const holding = !units.every(u => u.holdingPosition);
    for (const unit of units) {
      unit.holdingPosition = holding;
      unit.goal = null;
      unit.path = [];
      unit.attackId = null;
      unit.nextPath = this.elapsed;
      unit.gatherTarget = undefined;
      unit.gatherProgress = 0;
    }
    this.emitSnapshot();
  }
  saveGame() {
    const save: GameSave = {
      version: 1, seed: this.seed, map: this.map, resources: this.resources, techs: this.techs,
      research: this.research, explored: this.explored, elapsed: this.elapsed, nextId: this.nextId, status: this.status,
      survivorGroups: this.groups.map(({ id, x, y, rescued, discovered, escortId }) => ({ id, x, y, rescued, discovered, escortId })),
      units: this.units.filter(u => u.hp > 0).map(({ id, kind, faction, x, y, hp, maxHp, cooldown, xp, holdingPosition, cargo, gatherTarget }) =>
        ({ id, kind, faction, x, y, hp, maxHp, cooldown, xp, holdingPosition, cargo, gatherTarget })),
      buildings: this.buildings.filter(b => b.hp > 0).map(({ id, kind, faction, tx, ty, hp, maxHp, level, production }) => ({ id, kind, faction, tx, ty, hp, maxHp, level, production }))
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); this.message('Operation saved in this browser.'); }
    catch { this.message('Unable to save. Browser storage may be unavailable.'); }
  }

  private pointerPosition(pointer: Phaser.Input.Pointer): Point {
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }
  private getEntityAt(x: number, y: number, faction?: Faction): Unit | Building | null {
    let hit: Unit | Building | null = null;
    for (const entity of [...this.units, ...this.buildings]) {
      const sprite = entity.sprite;
      if (entity.hp <= 0 || !sprite.visible || (faction && entity.faction !== faction) || (hit && hit.sprite.depth > sprite.depth)) continue;
      if ('tx' in entity) {
        const localX = Math.floor(x - sprite.x), localY = Math.floor(y - sprite.y);
        if (localX < 0 || localX >= sprite.width || localY < 0 || localY >= sprite.height) continue;
        if (localY >= BUILDING_HEADROOM || (this.textures.getPixelAlpha(localX, localY, sprite.texture.key) ?? 0) > 100) hit = entity;
      } else {
        const halfWidth = isVehicle(entity.kind) ? 19 : 13;
        if (Math.abs(x - sprite.x) <= halfWidth && y >= sprite.y - UNIT_FEET && y <= sprite.y + 7) hit = entity;
      }
    }
    return hit;
  }
  private onPointerDown(pointer: Phaser.Input.Pointer) {
    const { x, y } = this.pointerPosition(pointer);
    const groundY = y / GROUND_SCALE;
    if (pointer.rightButtonDown()) {
      if (this.placement) { this.placement = null; this.emitSnapshot(); return; }
      if (this.selectedType !== 'unit' || !this.selected.length) return;
      const target = this.getEntityAt(x, y);
      const enemy = target && target.faction !== 'human' ? target : null;
      const tx = Math.floor(x / TILE), ty = Math.floor(groundY / TILE);
      const deposit = this.visibleTiles[ty]?.[tx] && this.map.resourceNodes?.find(node => node.tx === tx && node.ty === ty && node.remaining > 0);
      const units = this.units.filter(u => this.selected.includes(u.id) && u.faction === 'human');
      const blocked = this.blockedCells();
      units.forEach((unit, index) => {
        unit.holdingPosition = false;
        unit.gatherTarget = undefined;
        unit.gatherProgress = 0;
        unit.attackId = unit.kind === 'worker' ? null : enemy?.id ?? null;
        if (deposit && unit.kind === 'worker') {
          unit.gatherTarget = ty * MAP_W + tx;
          unit.goal = null;
          unit.path = [];
          unit.nextPath = this.elapsed;
        } else if (unit.attackId !== null) {
          unit.goal = null;
          unit.path = [];
          unit.nextPath = this.elapsed;
        } else {
          const col = index % 5, row = Math.floor(index / 5);
          const offset = units.length === 1 ? 0 : (col - (Math.min(units.length, 5) - 1) / 2) * 16;
          this.setGoal(unit, { x: x + offset, y: groundY + row * 16 }, blocked);
        }
      });
      this.emitSnapshot();
      return;
    }
    if (!pointer.leftButtonDown()) return;
    if (this.placement) {
      this.placeAt(Math.floor(x / TILE), Math.floor(groundY / TILE));
      return;
    }
    this.dragStart = { x, y };
    this.dragEnd = { ...this.dragStart };
  }
  private onPointerUp(pointer: Phaser.Input.Pointer) {
    if (!this.dragStart || pointer.button !== 0) return;
    const start = this.dragStart, end = this.pointerPosition(pointer);
    this.dragStart = null; this.dragEnd = null;
    if (near(start, end) > 12) {
      const minX = Math.min(start.x, end.x), minY = Math.min(start.y, end.y);
      const maxX = Math.max(start.x, end.x), maxY = Math.max(start.y, end.y);
      const matched = this.units.filter(u => u.faction === 'human' && u.hp > 0 && u.sprite.x >= minX && u.sprite.x <= maxX &&
        u.sprite.y >= minY && u.sprite.y - UNIT_FEET <= maxY);
      this.selected = matched.map(u => u.id);
      this.selectedType = matched.length ? 'unit' : null;
    } else {
      const found = this.getEntityAt(end.x, end.y, 'human');
      this.selected = found ? [found.id] : [];
      this.selectedType = found ? ('tx' in found ? 'building' : 'unit') : null;
    }
    this.emitSnapshot();
  }

  private entityPos(entity: Unit | Building): Point {
    if ('tx' in entity) return center(entity.tx + STRUCTURES[entity.kind].size[0] / 2 - .5, entity.ty + STRUCTURES[entity.kind].size[1] / 2 - .5);
    return { x: entity.x, y: entity.y };
  }
  private targetDistance(from: Point, target: Unit | Building): number {
    if (!('tx' in target)) return near(from, target);
    const [w, h] = STRUCTURES[target.kind].size;
    const dx = Math.max(target.tx * TILE - from.x, 0, from.x - (target.tx + w) * TILE);
    const dy = Math.max(target.ty * TILE - from.y, 0, from.y - (target.ty + h) * TILE);
    return Math.hypot(dx, dy);
  }
  private blockedCells() {
    const blocked = new Map<number, Building>();
    for (const b of this.buildings) if (b.hp > 0) for (let y = b.ty; y < b.ty + STRUCTURES[b.kind].size[1]; y++) for (let x = b.tx; x < b.tx + STRUCTURES[b.kind].size[0]; x++) blocked.set(y * MAP_W + x, b);
    return blocked;
  }
  private blocksSight(tx: number, ty: number, blocked: Map<number, Building>, observer: Unit | Building, target?: Unit | Building) {
    const building = blocked.get(ty * MAP_W + tx);
    return this.map.tiles[ty]?.[tx] === 'ruin' || Boolean(building && building !== observer && building !== target);
  }
  private canSee(observer: Unit | Building, target: Unit | Building, blocked: Map<number, Building>) {
    return hasLineOfSight(this.entityPos(observer), this.entityPos(target),
      (x, y) => this.blocksSight(x, y, blocked, observer, target));
  }
  private setGoal(unit: Unit, position: Point, blocked = this.blockedCells()) {
    this.setPath(unit, position, blocked);
    unit.goal = unit.path.length ? { ...position } : null;
  }
  private setPath(unit: Unit, position: Point, blocked: Map<number, Building>) {
    unit.path = findPath(this.map, unit.x, unit.y, position.x, position.y, isVehicle(unit.kind), blocked);
    unit.nextPath = this.elapsed + 1.2;
  }
  private spawnWanderer() {
    if (this.units.filter(u => u.faction === 'zombie').length >= 90) return;
    const side = this.rng();
    let tx: number, ty: number;
    if (side < .6) { tx = 20 + Math.floor(this.rng() * 43); ty = 3 + Math.floor(this.rng() * (MAP_H - 6)); }
    else { tx = this.rng() < .5 ? 3 : 75; ty = 3 + Math.floor(this.rng() * (MAP_H - 6)); }
    if (!walkable(this.map.tiles[ty][tx]) || this.buildings.some(b => Math.abs(b.tx - tx) < 3 && Math.abs(b.ty - ty) < 3)) return;
    const kind: UnitKind = this.rng() < .08 ? 'brute' : this.rng() < .32 ? 'runner' : 'walker';
    const pos = center(tx, ty);
    this.spawnUnit(kind, 'zombie', pos.x, pos.y);
  }

  private nearestOpponent(unit: Unit, radius: number, blocked: Map<number, Building>): Unit | Building | null {
    let closest: Unit | Building | null = null, dist = radius;
    for (const other of this.units) {
      if (other.hp <= 0 || other.faction === unit.faction) continue;
      const d = near(unit, other);
      if (d <= dist && this.canSee(unit, other, blocked)) { dist = d; closest = other; }
    }
    for (const other of this.buildings) {
      if (other.hp <= 0 || other.faction === unit.faction) continue;
      const d = this.targetDistance(unit, other);
      if (d <= dist && this.canSee(unit, other, blocked)) { dist = d; closest = other; }
    }
    return closest;
  }
  private findEntity(id: number) { return this.units.find(u => u.id === id && u.hp > 0) ?? this.buildings.find(b => b.id === id && b.hp > 0) ?? null; }
  private damage(target: Unit | Building, amount: number) { target.hp = Math.max(0, target.hp - amount); }
  private tracer(shooter: Unit | Building, target: Unit | Building) {
    const aim = this.entityPos(target);
    const to = { x: aim.x, y: aim.y * GROUND_SCALE - ('tx' in target ? 4 : 12) };
    const origin = this.entityPos(shooter);
    const facingLeft = to.x === origin.x ? shooter.sprite.flipX : to.x < origin.x;
    shooter.sprite.setFlipX(facingLeft);
    if (!shooter.sprite.visible || !target.sprite.visible) return;

    const turret = 'tx' in shooter;
    const heavy = turret || shooter.kind === 'tank' || shooter.kind === 'gunner';
    const muzzleReach = turret || shooter.kind === 'rifleman' || shooter.kind === 'raider' ? 13
      : shooter.kind === 'tank' || shooter.kind === 'sniper' ? 16 : shooter.kind === 'gunner' ? 15 : 7;
    const muzzleHeight = turret ? 13 : isVehicle(shooter.kind) ? (shooter.kind === 'tank' ? 17 : 18) : 12;
    const from = { x: origin.x + (facingLeft ? -muzzleReach : muzzleReach), y: origin.y * GROUND_SCALE - muzzleHeight };
    const distance = near(from, to);
    this.shots.push({
      from, to, distance, heavy, age: 0,
      flight: Math.max(.032, distance / (heavy ? 1250 : 1850)),
      color: shooter.faction === 'human' ? 0xf5c77e : 0xf0a06e,
    });
  }
  private drawShots(dt: number) {
    const g = this.shotOverlay;
    g.clear();
    for (const shot of this.shots) {
      const { from, to, flight, color, heavy, distance, age } = shot;
      if (age < .045) {
        const alpha = 1 - age / .045;
        const size = heavy ? 4 : 2;
        g.fillStyle(color, alpha * .68).fillRect(from.x - size, from.y - 1, size * 2 + 1, 3);
        g.fillStyle(0xfff2ca, alpha).fillRect(from.x - 1, from.y - 2, 3, 5);
      }
      if (age > 0 && age < flight && distance > 1) {
        const head = age / flight;
        const tail = Math.max(0, head - (heavy ? 22 : 15) / distance);
        const dx = to.x - from.x, dy = to.y - from.y;
        const x = from.x + dx * head, y = from.y + dy * head;
        const startX = from.x + dx * tail, startY = from.y + dy * tail;
        g.lineStyle(heavy ? 2 : 1, color, .74).lineBetween(startX, startY, x, y);
        g.fillStyle(0xffecc1, .96).fillRect(x - 1, y - 1, 2, 2);
      }
      if (age >= flight && age < flight + .12) {
        const spread = (age - flight) / .12;
        const fade = 1 - spread;
        const dust = (heavy ? 4 : 2) + spread * 5;
        g.fillStyle(0x9d9578, .46 * fade).fillRect(to.x - dust, to.y - spread * 3, dust * 2, 3);
        g.fillStyle(0xffd595, fade)
          .fillRect(to.x - 3 - spread * 8, to.y - 2 - spread * 6, 2, 1)
          .fillRect(to.x + 3 + spread * 6, to.y - 3 - spread * 9, 2, 1)
          .fillRect(to.x, to.y - 2, 2, 2);
      }
      shot.age += dt;
    }
    this.shots = this.shots.filter(shot => shot.age < shot.flight + .12);
  }
  private doCombat(unit: Unit, target: Unit | Building) {
    const def = UNITS[unit.kind];
    let multiplier = 1;
    if (unit.faction === 'human') multiplier += (def.vehicle ? this.techs.vehicleWeapons * .2 : this.techs.weapons * .18) + unit.xp * .025;
    this.damage(target, Math.round(def.damage * multiplier));
    unit.cooldown = def.cooldown;
    if (!isZombie(unit.kind)) this.tracer(unit, target);
    if (target.hp <= 0) {
      if (unit.faction === 'human') unit.xp = Math.min(10, unit.xp + 1);
      if ('tx' in target && target.kind === 'hq' && target.faction === 'raider') this.message('Raider command center destroyed. Enemy territory weakened.');
    }
  }
  private updateGathering(unit: Unit, dt: number, blocked: Map<number, Building>) {
    const node = unit.gatherTarget === undefined ? undefined
      : this.map.resourceNodes?.find(candidate => candidate.ty * MAP_W + candidate.tx === unit.gatherTarget);
    const cargo = unit.cargo;
    if (cargo && (!node || cargo.amount >= WORKER_CAPACITY || node.remaining <= 0 || cargo.kind !== node.kind)) {
      const dropOffs = this.buildings.filter(b => b.faction === 'human' && b.hp > 0 && (b.kind === 'hq' || b.kind === 'depot'))
        .sort((a, b) => this.targetDistance(unit, a) - this.targetDistance(unit, b));
      if (dropOffs.some(b => this.targetDistance(unit, b) <= TILE * .75)) {
        this.resources[cargo.kind] += cargo.amount;
        unit.cargo = undefined;
        unit.path = [];
        unit.nextPath = this.elapsed;
      } else if (node && !unit.path.length && this.elapsed >= unit.nextPath) {
        for (const dropOff of dropOffs) {
          this.setPath(unit, this.entityPos(dropOff), blocked);
          if (unit.path.length) break;
        }
      }
      return;
    }
    if (!node || node.remaining <= 0) {
      unit.gatherTarget = undefined;
      return;
    }
    const position = center(node.tx, node.ty);
    if (near(unit, position) > TILE * .7) {
      if (!unit.path.length && this.elapsed >= unit.nextPath) this.setPath(unit, position, blocked);
      return;
    }
    unit.path = [];
    unit.gatherProgress += dt;
    if (unit.gatherProgress + 1e-9 < GATHER_SECONDS) return;
    const carried = cargo?.amount ?? 0;
    const amount = Math.min(node.remaining, WORKER_CAPACITY - carried);
    node.remaining -= amount;
    unit.cargo = { kind: node.kind, amount: carried + amount };
    unit.gatherProgress = 0;
    unit.nextPath = this.elapsed;
    if (node.remaining <= 0) this.drawResourceNodes();
  }
  private updateAI(dt: number) {
    const blocked = this.blockedCells();
    for (const unit of this.units) {
      if (unit.hp <= 0) continue;
      if (unit.kind === 'worker') {
        this.updateGathering(unit, dt, blocked);
        continue;
      }
      unit.cooldown = Math.max(0, unit.cooldown - dt);
      const def = UNITS[unit.kind];
      let target = unit.attackId !== null ? this.findEntity(unit.attackId) : null;
      if (unit.attackId !== null && !target) {
        unit.attackId = null;
        unit.path = [];
        unit.nextPath = this.elapsed;
      }
      if (!target) {
        const radius = unit.holdingPosition ? def.range
          : unit.faction === 'zombie' ? 280 : unit.faction === 'raider' ? 260
          : unit.goal ? def.range * 1.3 : Math.max(210, def.range + 1);
        target = this.nearestOpponent(unit, radius, blocked);
      }
      if (target) {
        if (this.targetDistance(unit, target) <= def.range && this.canSee(unit, target, blocked)) {
          if (unit.faction !== 'human' || unit.attackId === target.id || !unit.goal) {
            unit.goal = null;
            unit.path = [];
            unit.nextPath = this.elapsed;
          }
          if (unit.cooldown <= 0) this.doCombat(unit, target);
        } else if (!unit.holdingPosition && (unit.faction !== 'human' || unit.attackId === target.id || !unit.goal) && this.elapsed >= unit.nextPath) {
          this.setPath(unit, this.entityPos(target), blocked);
        }
      } else if (unit.faction === 'human' && !unit.goal) {
        unit.path = [];
      } else if (unit.faction === 'zombie' && (!unit.path.length || this.elapsed >= unit.nextPath + 4)) {
        const wander = { x: unit.x + (this.rng() - .5) * 300, y: unit.y + (this.rng() - .5) * 300 };
        this.setGoal(unit, wander, blocked);
        unit.nextPath = this.elapsed + 5;
      } else if (unit.faction === 'raider' && !unit.path.length && !unit.patrol) {
        const enemy = this.buildings.find(b => b.faction === 'human' && b.kind === 'hq');
        if (enemy && near(unit, this.entityPos(enemy)) < 450) this.setGoal(unit, this.entityPos(enemy), blocked);
      }
    }
    for (const b of this.buildings) {
      if (b.faction === 'human' && !this.powered()) continue;
      if (b.hp <= 0 || b.kind !== 'turret') continue;
      const pos = this.entityPos(b);
      const enemy = this.units.filter(u => u.hp > 0 && u.faction !== b.faction && near(pos, u) < GUARD_TURRET_RANGE && this.canSee(b, u, blocked))
        .sort((a, c) => near(pos, a) - near(pos, c))[0];
      if (enemy && ((b as Building & { nextFire?: number }).nextFire ?? 0) <= this.elapsed) {
        this.damage(enemy, Math.round(17 * (b.faction === 'human' ? 1 + this.techs.defenses * .25 : 1)));
        this.tracer(b, enemy);
        (b as Building & { nextFire?: number }).nextFire = this.elapsed + .85;
      }
    }
  }

  private restorationProgress(powered = this.powered()): RestorationProgress {
    return {
      rescued: this.groups.filter(group => group.rescued).length * SURVIVORS_PER_GROUP,
      settlementReady: powered && this.hasBuilding('hq') && this.hasBuilding('farm') && this.hasBuilding('hospital'),
      cureReady: this.techs.cure > 0,
    };
  }

  private updateSurvivors(dt: number) {
    const hq = this.headquarters();
    if (!hq) return;
    let occupied: Map<number, Building> | undefined;
    for (const group of this.groups) {
      if (group.rescued) continue;
      let escort = this.units.find(unit => unit.id === group.escortId && unit.hp > 0);
      if (this.elapsed >= group.nextPath) {
        group.nextPath = this.elapsed + .5;
        const blocked = occupied ??= this.blockedCells();
        if (!escort) {
          group.path = [];
          escort = this.units.find(unit => unit.faction === 'human' && unit.hp > 0 && UNITS[unit.kind].damage > 0 &&
            near(unit, group) <= 2 * TILE &&
            hasLineOfSight(unit, group, (x, y) => this.blocksSight(x, y, blocked, unit)));
          if (escort) {
            group.discovered = true;
            this.message(`Survivors found. Escort all ${SURVIVORS_PER_GROUP} back to your command center.`);
          }
        }
        if ((escort?.id ?? null) !== group.escortId) {
          group.escortId = escort?.id ?? null;
          group.label.setText(escort ? `${SURVIVORS_PER_GROUP} FOLLOWING` : `${SURVIVORS_PER_GROUP} SURVIVORS`);
        }
        if (escort) {
          group.path = near(group, escort) > TILE
            ? findPath(this.map, group.x, group.y, escort.x, escort.y, false, blocked)
            : [];
        }
      }
      if (!escort) continue;
      const next = group.path[0];
      if (next) {
        const distance = near(group, next);
        const travel = dt * 82;
        if (distance <= travel) {
          group.x = next.x;
          group.y = next.y;
          group.path.shift();
        } else {
          group.x += (next.x - group.x) * travel / distance;
          group.y += (next.y - group.y) * travel / distance;
        }
        const viewY = group.y * GROUND_SCALE;
        group.sprite.setPosition(group.x, viewY).setDepth(actorDepth(group.y));
        group.label.setPosition(group.x, viewY - 23);
      }
      if (this.targetDistance(group, hq) <= TILE * 1.75) {
        const blocked = occupied ??= this.blockedCells();
        if (hasLineOfSight(group, this.entityPos(hq), (x, y) => this.blocksSight(x, y, blocked, hq))) {
          group.rescued = true;
          group.escortId = null;
          group.path = [];
          group.sprite.setVisible(false);
          group.label.setVisible(false);
          const rescued = this.restorationProgress().rescued;
          this.message(`${SURVIVORS_PER_GROUP} survivors rescued. ${rescued}/${SURVIVOR_TARGET} are safe at HQ.`);
        }
      }
    }
  }

  private updateSimulation(dt: number) {
    this.elapsed += dt;
    const p = this.powered();
    for (const b of this.buildings) {
      if (b.hp <= 0 || b.faction !== 'human' || !b.production?.length || !p) continue;
      const item = b.production[0];
      item.remaining -= dt;
      if (item.remaining <= 0) {
        const spot = this.findSpawnPosition(b);
        this.spawnUnit(item.kind, 'human', spot.x, spot.y);
        b.production.shift();
        this.message(`${UNITS[item.kind].label} reporting for duty.`);
      }
    }
    if (this.research && p && (this.research.id !== 'cure' || this.hasBuilding('research'))) {
      this.research.remaining -= dt;
      if (this.research.remaining <= 0) { const done = this.research.id; this.research = null; this.finishResearch(done); }
    }
    if (this.elapsed >= this.nextIncome) {
      this.nextIncome = this.elapsed + 4;
      for (const b of this.buildings) {
        if (b.faction !== 'human' || b.hp <= 0) continue;
        if (!p && STRUCTURES[b.kind].power) continue;
        for (const [key, amount] of Object.entries(STRUCTURES[b.kind].income ?? {})) this.resources[key as keyof Resources] += amount ?? 0;
      }
      // Local workshop and hospital repair, limited by power.
      if (p) for (const b of this.buildings.filter(b => b.faction === 'human' && b.hp > 0)) {
        const origin = this.entityPos(b);
        if (b.kind === 'hospital') for (const u of this.units) if (u.faction === 'human' && !isVehicle(u.kind) && near(u, origin) < 180) u.hp = Math.min(u.maxHp, u.hp + 6);
        if (b.kind === 'workshop') for (const other of this.buildings) if (other.faction === 'human' && near(this.entityPos(other), origin) < 170) other.hp = Math.min(other.maxHp, other.hp + 8);
      }
    }
    if (this.elapsed >= this.nextAi) { this.nextAi = this.elapsed + .35; this.updateAI(.35); }
    if (this.elapsed >= this.nextZombies) {
      this.nextZombies = this.elapsed + Math.max(7, 14 - this.elapsed / 150);
      for (let i = 0; i < 3 + Math.min(5, Math.floor(this.elapsed / 150)); i++) this.spawnWanderer();
      if (this.elapsed > 30 && this.rng() < .6) this.message('Zombie movement detected near abandoned settlements.');
    }
    if (this.elapsed >= this.nextRaid) {
      this.nextRaid = this.elapsed + 25 + this.rng() * 14;
      const base = this.buildings.filter(b => b.faction === 'raider' && b.kind === 'hq' && b.hp > 0);
      if (base.length) {
        const site = base[Math.floor(this.rng() * base.length)];
        const count = Math.min(5, 2 + Math.floor(this.elapsed / 130));
        for (let i = 0; i < count; i++) {
          const pos = center(site.tx + i % 3 - 2, site.ty + 4 + Math.floor(i / 3));
          const u = this.spawnUnit(this.rng() < .18 ? 'raiderTank' : 'raider', 'raider', pos.x, pos.y);
          const player = this.buildings.find(b => b.faction === 'human' && b.kind === 'hq');
          if (player) this.setGoal(u, this.entityPos(player));
        }
        this.message('Raider patrol mobilized. Protect your supply routes.');
      }
    }
    let occupied: Map<number, Building> | undefined;
    for (const unit of this.units) {
      if (unit.hp <= 0 || !unit.path.length) continue;
      if (unit.attackId !== null) {
        const target = this.findEntity(unit.attackId);
        if (!target || (this.targetDistance(unit, target) <= UNITS[unit.kind].range &&
          this.canSee(unit, target, occupied ??= this.blockedCells()))) {
          unit.path = [];
          unit.nextPath = this.elapsed;
          continue;
        }
      }
      const next = unit.path[0], d = near(unit, next);
      const speed = UNITS[unit.kind].speed * (unit.faction === 'human' && isVehicle(unit.kind) ? 1 + this.techs.engines * .12 : 1);
      const terrain = this.map.tiles[Math.max(0, Math.min(MAP_H - 1, Math.floor(unit.y / TILE)))][Math.max(0, Math.min(MAP_W - 1, Math.floor(unit.x / TILE)))];
      const step = speed * (terrain === 'road' ? 1.22 : 1) * dt;
      if (d <= step + 1) { unit.x = next.x; unit.y = next.y; unit.path.shift(); }
      else { unit.x += (next.x - unit.x) / d * step; unit.y += (next.y - unit.y) / d * step; }
      if (!unit.path.length) unit.goal = null;
      if (Math.abs(next.x - unit.x) > .5) unit.sprite.setFlipX(next.x < unit.x);
      unit.sprite.setPosition(unit.x, unit.y * GROUND_SCALE).setDepth(actorDepth(unit.y));
    }
    for (const unit of this.units.filter(u => u.hp <= 0)) { unit.sprite.destroy(); this.selected = this.selected.filter(id => id !== unit.id); }
    this.units = this.units.filter(u => u.hp > 0);
    for (const b of this.buildings.filter(b => b.hp <= 0)) { b.sprite.destroy(); b.label.destroy(); this.selected = this.selected.filter(id => id !== b.id); }
    this.buildings = this.buildings.filter(b => b.hp > 0);
    this.updateSurvivors(dt);
    if (this.status === 'playing') {
      const progress = this.restorationProgress();
      if (!this.hasBuilding('hq')) { this.status = 'lost'; this.message('Command center destroyed. Operation failed.'); }
      else if (progress.rescued >= SURVIVOR_TARGET && progress.settlementReady && progress.cureReady) {
        this.status = 'won';
        this.message('Humanity restored. All survivors are safe, and the infection cure is ready.');
      }
    }
    if (this.elapsed >= this.nextFog) { this.nextFog = this.elapsed + .6; this.updateVisibility(); }
    if (this.elapsed >= this.lastSnapshot + .5) { this.lastSnapshot = this.elapsed; this.emitSnapshot(); }
  }

  private findSpawnPosition(b: Building): Point {
    const def = STRUCTURES[b.kind];
    const blocked = this.blockedCells();
    for (let d = 1; d < 8; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      const x = b.tx + def.size[0] + dx, y = b.ty + def.size[1] + dy;
      if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
      if (!blocked.has(y * MAP_W + x) && walkable(this.map.tiles[y][x], true)) return center(x, y);
    }
    return center(b.tx, b.ty);
  }
  private updateVisibility() {
    this.visibleTiles = Array.from({ length: MAP_H }, () => Array<boolean>(MAP_W).fill(false));
    const blocked = this.blockedCells();
    const reveal = (observer: Unit | Building, radius: number) => {
      const origin = this.entityPos(observer);
      const cx = Math.floor(origin.x / TILE), cy = Math.floor(origin.y / TILE);
      for (let y = Math.max(0, cy - radius); y <= Math.min(MAP_H - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(MAP_W - 1, cx + radius); x++) {
        if (this.visibleTiles[y][x] || (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        if (hasLineOfSight(origin, center(x, y), (tx, ty) => this.blocksSight(tx, ty, blocked, observer))) {
          this.visibleTiles[y][x] = true;
          this.explored[y][x] = true;
        }
      }
    };
    for (const u of this.units) if (u.faction === 'human' && u.hp > 0) reveal(u, isVehicle(u.kind) ? 8 : 7);
    for (const b of this.buildings) if (b.faction === 'human' && b.hp > 0) {
      reveal(b, b.kind === 'radar' ? 19 : b.kind === 'hq' ? 10 : 6);
    }
    const fog = this.fogOverlay;
    fog.clear();
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (this.visibleTiles[y][x]) continue;
      fog.fillStyle(0x071018, this.explored[y][x] ? .61 : .97);
      fog.fillRect(x * TILE, y * GROUND_TILE_HEIGHT, TILE, GROUND_TILE_HEIGHT);
    }
    for (const u of this.units) if (u.faction !== 'human') {
      const x = Math.floor(u.x / TILE), y = Math.floor(u.y / TILE);
      u.sprite.setVisible(Boolean(this.visibleTiles[y]?.[x]));
    }
    for (const b of this.buildings) if (b.faction !== 'human') {
      const [w, h] = STRUCTURES[b.kind].size;
      const visible = this.visibleTiles.slice(b.ty, b.ty + h).some(row => row.slice(b.tx, b.tx + w).includes(true));
      b.sprite.setVisible(visible); b.label.setVisible(visible);
    }
    for (const group of this.groups) {
      const visible = !group.rescued && Boolean(this.visibleTiles[Math.floor(group.y / TILE)]?.[Math.floor(group.x / TILE)]);
      if (visible) group.discovered = true;
      group.sprite.setVisible(visible);
      group.label.setVisible(visible);
    }
  }
  private drawSelectionAndPreview() {
    const g = this.selectionOverlay;
    const ground = this.groundSelection;
    g.clear();
    ground.clear();
    const selection = this.selected.map(id => this.findEntity(id)).filter(found => found !== null);
    const displayedRanges = new Set<number>();
    ground.lineStyle(1.5, 0xe7cc91, .8);
    for (const entity of selection) {
      const range = 'tx' in entity ? (entity.kind === 'turret' ? GUARD_TURRET_RANGE : 0)
        : isZombie(entity.kind) ? 0 : UNITS[entity.kind].range;
      if (!range || displayedRanges.has(range)) continue;
      displayedRanges.add(range);
      const pos = this.entityPos(entity);
      ground.strokeEllipse(pos.x, pos.y * GROUND_SCALE, 2 * range, 2 * range * GROUND_SCALE);
    }
    for (const found of selection) {
      ground.lineStyle(2, 0xb6eaa4, .9);
      if ('tx' in found) {
        const def = STRUCTURES[found.kind];
        ground.strokeRect(found.tx * TILE - 1, found.ty * GROUND_TILE_HEIGHT - 1, def.size[0] * TILE + 2, def.size[1] * GROUND_TILE_HEIGHT + 2);
      } else {
        ground.strokeEllipse(found.sprite.x, found.sprite.y, isVehicle(found.kind) ? 40 : 25, isVehicle(found.kind) ? 13 : 9);
      }
    }
    for (const entity of [...this.units, ...this.buildings]) {
      if (entity.hp <= 0 || entity.hp >= entity.maxHp || !entity.sprite.visible) continue;
      const x = 'tx' in entity ? entity.sprite.x + entity.sprite.width / 2 : entity.sprite.x;
      const y = entity.sprite.y - ('tx' in entity ? 4 : UNIT_FEET + 6);
      g.fillStyle(0x151f23); g.fillRect(x - 15, y, 30, 5);
      g.fillStyle(entity.faction === 'human' ? 0x9bd080 : 0xef8665);
      g.fillRect(x - 14, y + 1, 28 * Math.max(0, entity.hp / entity.maxHp), 3);
    }
    if (this.dragStart && this.dragEnd && near(this.dragStart, this.dragEnd) > 10) {
      g.lineStyle(1, 0xb5e8ac, .85);
      g.fillStyle(0x6b9f8a, .14);
      const x = Math.min(this.dragStart.x, this.dragEnd.x), y = Math.min(this.dragStart.y, this.dragEnd.y);
      const w = Math.abs(this.dragEnd.x - this.dragStart.x), h = Math.abs(this.dragEnd.y - this.dragStart.y);
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
    const p = this.previewOverlay;
    p.clear();
    if (this.placement) {
      const pointer = this.pointerPosition(this.input.activePointer);
      const tx = Math.floor(pointer.x / TILE), ty = Math.floor(pointer.y / GROUND_TILE_HEIGHT);
      const [w, h] = STRUCTURES[this.placement].size;
      const okay = this.validPlacement(this.placement, tx, ty);
      p.fillStyle(okay ? 0x75c88e : 0xe17065, .3);
      p.lineStyle(2, okay ? 0xb5f0bd : 0xf09483, .9);
      p.fillRect(tx * TILE, ty * GROUND_TILE_HEIGHT, w * TILE, h * GROUND_TILE_HEIGHT);
      p.strokeRect(tx * TILE, ty * GROUND_TILE_HEIGHT, w * TILE, h * GROUND_TILE_HEIGHT);
    }
  }
  update(_time: number, delta: number) {
    const dt = Math.min(.075, delta / 1000);
    const camera = this.cameras.main;
    if (this.keys) {
      const speed = 470 * dt / camera.zoom;
      if (this.keys.W?.isDown || this.keys.UP?.isDown) camera.scrollY -= speed;
      if (this.keys.S?.isDown || this.keys.DOWN?.isDown) camera.scrollY += speed;
      if (this.keys.A?.isDown || this.keys.LEFT?.isDown) camera.scrollX -= speed;
      if (this.keys.D?.isDown || this.keys.RIGHT?.isDown) camera.scrollX += speed;
    }
    if (!this.pausedByPlayer && this.status === 'playing') this.updateSimulation(dt);
    this.drawShots(this.pausedByPlayer ? 0 : dt);
    this.drawSelectionAndPreview();
  }
  private emitSnapshot() {
    if (!this.map) return;
    const p = this.powerStats();
    const selection = this.selected.map(id => this.findEntity(id)).filter((x): x is Unit | Building => Boolean(x));
    let selected = 'Nothing selected';
    if (selection.length > 1) selected = `${selection.length} military units selected`;
    else if (selection.length === 1) {
      const entity = selection[0];
      selected = `${'tx' in entity ? STRUCTURES[entity.kind].label : UNITS[entity.kind].label} · ${Math.ceil(entity.hp)} / ${entity.maxHp} HP`;
      if ('tx' in entity) selected += ` · Level ${entity.level}`;
      else if (entity.kind === 'worker') {
        if (entity.cargo) selected += ` · Carrying ${entity.cargo.amount} ${entity.cargo.kind}`;
        else if (entity.gatherTarget !== undefined) selected += ' · Gathering';
      }
    }
    const data: UiSnapshot = {
      seed: this.seed, map: this.map, explored: this.explored, visible: this.visibleTiles, resources: { ...this.resources },
      powerProduced: p.produced, powerUsed: p.used,
      selected, selectedIds: this.selected.slice(), selectedType: this.selectedType,
      holdingPosition: selection.length > 0 && selection.every(entity => !('tx' in entity) && entity.holdingPosition),
      workerSelected: selection.some(entity => !('tx' in entity) && entity.kind === 'worker'),
      buildings: (Object.keys(STRUCTURES) as BuildingKind[]).map(kind => ({ kind, count: this.buildings.filter(b => b.hp > 0 && b.faction === 'human' && b.kind === kind).length })),
      units: this.units.map(u => ({ id: u.id, faction: u.faction, kind: u.kind, tx: Math.floor(u.x / TILE), ty: Math.floor(u.y / TILE) })),
      structures: this.buildings.map(b => ({ id: b.id, faction: b.faction, kind: b.kind, tx: b.tx, ty: b.ty })),
      restoration: this.restorationProgress(p.produced >= p.used),
      survivorSites: this.groups.filter(group => group.discovered && !group.rescued).map(group => ({
        tx: Math.floor(group.x / TILE), ty: Math.floor(group.y / TILE), escorted: group.escortId !== null,
      })),
      techs: { ...this.techs }, research: this.research && { ...this.research },
      production: this.buildings.flatMap(b => b.faction === 'human' && b.hp > 0 && b.production?.length
        ? [{ buildingId: b.id, building: b.kind, tx: b.tx, ty: b.ty, jobs: b.production.map(job => ({ ...job })) }]
        : []),
      placement: this.placement, raiderBases: this.buildings.filter(b => b.kind === 'hq' && b.faction === 'raider').length,
      totalRaiderBases: this.map.raiderStarts?.length ?? RAIDER_BASE_COUNT, zombieCount: this.units.filter(u => u.faction === 'zombie').length,
      elapsed: this.elapsed, status: this.status, paused: this.pausedByPlayer, messages: this.messages.slice()
    };
    publish(data);
  }
}
