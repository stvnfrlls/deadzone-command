import { ENVIRONMENT_LABELS, MAP_H, MAP_W, TILE, RESOURCE_DEPOSITS, type Environment, type MapSite, type ResourceKey, type ResourceNode, type Terrain, type TileMap } from './model';
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seededRandom(seed: string) {
  let a = hashSeed(seed);
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const legacyPlayerStart = { tx: 12, ty: 28 };
export const RAIDER_BASE_COUNT = 2;
const environments = Object.keys(ENVIRONMENT_LABELS) as Environment[];

export function environmentForSeed(seed: string): Environment {
  const random = seededRandom(seed + '-environment');
  return environments[Math.floor(random() * environments.length)];
}

type Random = () => number;
const between = (rand: Random, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

function terrainGrid(tileAt: (x: number, y: number) => Terrain): Terrain[][] {
  return Array.from({ length: MAP_H }, (_, y) => Array.from({ length: MAP_W }, (_, x) => tileAt(x, y)));
}

function coastalTerrain(rand: Random): Terrain[][] {
  const riverMiddle = between(rand, 37, 43), riverWidth = between(rand, 1, 2), riverBend = between(rand, 2, 4);
  const riverShift = rand() * Math.PI * 2, coastShift = rand() * Math.PI * 2;
  const coastMiddle = between(rand, 73, 78), coastBend = between(rand, 2, 3);
  return terrainGrid((x, y) => {
    const riverX = Math.floor(riverMiddle + riverBend * Math.sin(y * .19 + riverShift) + 1.3 * Math.sin(y * .41));
    const coastX = Math.floor(coastMiddle + coastBend * Math.sin(y * .15 + coastShift) + .7 * Math.sin(y * .36));
    const r = rand();
    if (x >= coastX || Math.abs(x - riverX) <= riverWidth) return 'water';
    if (x >= coastX - 3) return r < .72 ? 'sand' : 'grass';
    if (r < .12) return 'forest';
    if (r < .132) return 'ruin';
    return Math.abs(x - riverX) === riverWidth + 1 ? 'sand' : 'grass';
  });
}

function forestTerrain(rand: Random): Terrain[][] {
  const groveX = rand() * Math.PI * 2, groveY = rand() * Math.PI * 2, canopy = rand() * Math.PI * 2;
  return terrainGrid((x, y) => {
    const density = Math.sin(x * .24 + groveX) + Math.cos(y * .28 + groveY) + .65 * Math.sin((x + y) * .36 + canopy);
    return density > .06 + rand() * .45 ? 'forest' : 'grass';
  });
}

function islandTerrain(rand: Random): Terrain[][] {
  const islands = [[3, 29], [36, 48], [54, 77]].map(([left, right]) => ({
    left, right, phase: rand() * Math.PI * 2, bend: 1.2 + rand() * .4,
  }));
  return terrainGrid((x, y) => {
    const edgeY = Math.min(y, MAP_H - 1 - y);
    if (edgeY < 3) return 'water';
    const inset = Math.max(0, 10 - edgeY) * .72;
    for (const { left, right, phase, bend } of islands) {
      const west = left + inset + Math.sin(y * .18 + phase) * bend;
      const east = right - inset + Math.sin(y * .21 + phase + .9) * bend;
      if (x < west || x > east) continue;
      if (Math.min(x - west, east - x, edgeY - 3) < 2.25) return 'sand';
      return rand() < .11 ? 'forest' : 'grass';
    }
    return 'water';
  });
}

function downtownTerrain(seed: string, rand: Random): Terrain[][] {
  const width = between(rand, 8, 10), height = between(rand, 7, 9);
  const offsetX = between(rand, 0, width - 1), offsetY = between(rand, 0, height - 1);
  return terrainGrid((x, y) => {
    const blockX = (x + offsetX) % width, blockY = (y + offsetY) % height;
    if (blockX === 0 || blockY === 0) return 'road';
    const block = Math.floor((x + offsetX) / width) + ',' + Math.floor((y + offsetY) / height);
    if (blockX >= 2 && blockX < width - 1 && blockY >= 2 && blockY < height - 1 &&
      hashSeed(seed + '-block-' + block) % 10 < 8) return 'ruin';
    return 'grass';
  });
}

export function createMap(seed: string): TileMap & { environment: Environment; playerStart: MapSite; raiderStarts: MapSite[] } {
  const rand = seededRandom(seed);
  const environment = environmentForSeed(seed);
  const pick = (min: number, max: number) => between(rand, min, max);
  const playerStart = { tx: pick(10, environment === 'islands' ? 22 : 26), ty: pick(19, 40) };
  const raiderX = () => environment === 'islands' ? pick(61, 66) : pick(57, 65);
  const raiderStarts = [{ tx: raiderX(), ty: pick(17, 24) }, { tx: raiderX(), ty: pick(34, 41) }];
  let tiles: Terrain[][];
  switch (environment) {
    case 'coastal': tiles = coastalTerrain(rand); break;
    case 'forest': tiles = forestTerrain(rand); break;
    case 'islands': tiles = islandTerrain(rand); break;
    case 'downtown': tiles = downtownTerrain(seed, rand); break;
  }

  if (environment !== 'downtown') {
    for (const [minX, maxX] of [[12, 28], [53, 67]]) {
      for (let district = 0; district < 6; district++) {
        const x = pick(minX, maxX), y = pick(10, 48), width = pick(1, 2), height = pick(1, 3);
        for (let ty = y; ty < y + height; ty++) for (let tx = x; tx < x + width; tx++) {
          if (tiles[ty][tx] !== 'water') tiles[ty][tx] = 'ruin';
        }
      }
    }
  }
  for (const site of [playerStart, ...raiderStarts]) {
    for (let y = site.ty - 5; y <= site.ty + 5; y++) for (let x = site.tx - 5; x <= site.tx + 5; x++) {
      if (tiles[y][x] !== 'water') tiles[y][x] = 'grass';
    }
  }

  // Connect the three camps by parallel roads, paving bridges only wherever the route crosses water.
  const northRoad = pick(9, 14), southRoad = pick(45, 51);
  const westLane = playerStart.tx - 6, eastLane = Math.min(...raiderStarts.map(site => site.tx)) - 7;
  const road = (x: number, y: number) => { tiles[y][x] = tiles[y][x] === 'water' || tiles[y][x] === 'bridge' ? 'bridge' : 'road'; };
  for (const y of [northRoad, southRoad]) {
    let end = MAP_W - 1;
    while (end > eastLane && tiles[y][end] === 'water') end--;
    for (let x = 3; x <= end; x++) road(x, y);
  }
  for (let y = northRoad; y <= southRoad; y++) {
    road(westLane, y);
    road(eastLane, y);
  }
  for (const site of [playerStart, ...raiderStarts]) {
    const lane = site === playerStart ? westLane : eastLane;
    for (let x = lane + 1; x <= site.tx - 4; x++) road(x, site.ty);
  }
  return { seed, environment, tiles, w: MAP_W, h: MAP_H, playerStart, raiderStarts };
}

export function createResourceNodes(map: TileMap, home: MapSite, occupied: Pick<ReadonlySet<number>, 'has'>): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  const rand = seededRandom(`${map.seed}-deposits`);
  const add = (kind: ResourceKey, tx: number, ty: number) => {
    const land = map.tiles[ty]?.[tx];
    if ((land !== 'grass' && land !== 'sand') || occupied.has(ty * map.w + tx) ||
      nodes.some(node => node.tx === tx && node.ty === ty)) return false;
    nodes.push({ kind, tx, ty, remaining: RESOURCE_DEPOSITS[kind].amount });
    return true;
  };
  const nearHome: [ResourceKey, number, number][] = [['scrap', 5, 0], ['oil', 4, 1], ['food', 1, 5]];
  for (const [kind, dx, dy] of nearHome) {
    const x = home.tx + dx, y = home.ty + dy;
    let placed = false;
    for (let radius = 0; radius <= 4 && !placed; radius++) {
      for (let ty = y - radius; ty <= y + radius && !placed; ty++) {
        for (let tx = x - radius; tx <= x + radius && !placed; tx++) placed = add(kind, tx, ty);
      }
    }
  }
  for (const kind of ['scrap', 'oil', 'food'] as const) {
    for (const [left, right] of [[6, 28], [54, 68]]) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const tx = left + Math.floor(rand() * (right - left + 1)), ty = 5 + Math.floor(rand() * (map.h - 10));
        if (nodes.some(node => Math.hypot(tx - node.tx, ty - node.ty) < 5)) continue;
        if (add(kind, tx, ty)) break;
      }
    }
  }
  return nodes;
}
export function walkable(tile: Terrain, vehicle = false): boolean {
  return tile !== 'water' && tile !== 'ruin' && (!vehicle || tile !== 'forest');
}
export function tileAt(map: TileMap, x: number, y: number): Terrain {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 'water';
  return map.tiles[ty][tx];
}
export function center(tx: number, ty: number) { return { x: (tx + .5) * TILE, y: (ty + .5) * TILE }; }
export function createSurvivorSites(map: TileMap, home: MapSite, occupied: Pick<ReadonlySet<number>, 'has'>): MapSite[] {
  const rand = seededRandom(`${map.seed}-survivors`);
  const seen = new Set([home.ty * map.w + home.tx]);
  const reachable = [home];
  for (let index = 0; index < reachable.length; index++) {
    const { tx, ty } = reachable[index];
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const x = tx + dx, y = ty + dy;
      if (x < 0 || x >= map.w || y < 0 || y >= map.h) continue;
      const key = y * map.w + x;
      if (seen.has(key) || occupied.has(key) || !walkable(map.tiles[y][x])) continue;
      seen.add(key);
      reachable.push({ tx: x, ty: y });
    }
  }
  const candidates = reachable.filter(({ tx, ty }) =>
    tx >= 3 && tx < map.w - 3 && ty >= 3 && ty < map.h - 3 &&
    Math.hypot(tx - home.tx, ty - home.ty) >= 7 &&
    (map.tiles[ty][tx] === 'grass' || map.tiles[ty][tx] === 'sand' || map.tiles[ty][tx] === 'forest') &&
    !map.resourceNodes?.some(node => node.tx === tx && node.ty === ty));
  const anchors: [number, number][] = [
    [home.tx + 4, home.ty - 7], [16, home.ty < map.h / 2 ? 47 : 10],
    [32, 15], [49, 42], [64, 11], [67, 47],
  ];
  const sites: MapSite[] = [];
  for (const [x, y] of anchors) {
    const targetX = x + (rand() - .5) * 12;
    const targetY = y + (rand() - .5) * 12;
    let best: MapSite | undefined;
    let distance = Infinity;
    for (const site of candidates) {
      if (sites.some(p => Math.hypot(p.tx - site.tx, p.ty - site.ty) < 7)) continue;
      const d = Math.hypot(site.tx - targetX, site.ty - targetY);
      if (d < distance) { best = site; distance = d; }
    }
    if (best) sites.push(best);
  }
  return sites;
}
export function hasLineOfSight(from: { x: number; y: number }, to: { x: number; y: number }, blocks: (tx: number, ty: number) => boolean): boolean {
  let x = Math.floor(from.x / TILE), y = Math.floor(from.y / TILE);
  const endX = Math.floor(to.x / TILE), endY = Math.floor(to.y / TILE);
  const dx = to.x - from.x, dy = to.y - from.y;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = TILE / Math.abs(dx), deltaY = TILE / Math.abs(dy);
  let boundaryX = dx === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) * TILE - from.x) / dx;
  let boundaryY = dy === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) * TILE - from.y) / dy;
  while (x !== endX || y !== endY) {
    const nextX = x === endX ? Infinity : boundaryX;
    const nextY = y === endY ? Infinity : boundaryY;
    if (Math.abs(nextX - nextY) < 1e-9) {
      if (blocks(x + stepX, y) || blocks(x, y + stepY)) return false;
      x += stepX; y += stepY;
      boundaryX += deltaX; boundaryY += deltaY;
    } else if (nextX < nextY) {
      x += stepX;
      boundaryX += deltaX;
    } else {
      y += stepY;
      boundaryY += deltaY;
    }
    // The destination itself can be a visible wall or a targeted building.
    if ((x !== endX || y !== endY) && blocks(x, y)) return false;
  }
  return true;
}
export function findPath(map: TileMap, fromX: number, fromY: number, toX: number, toY: number, vehicle: boolean, blocked?: Pick<ReadonlySet<number>, 'has'>): { x: number; y: number }[] {
  const sx = Math.min(map.w - 1, Math.max(0, Math.floor(fromX / TILE)));
  const sy = Math.min(map.h - 1, Math.max(0, Math.floor(fromY / TILE)));
  const gx = Math.min(map.w - 1, Math.max(0, Math.floor(toX / TILE)));
  const gy = Math.min(map.h - 1, Math.max(0, Math.floor(toY / TILE)));
  const total = map.w * map.h;
  const start = sy * map.w + sx;
  let target = gy * map.w + gx;
  const allowed = (id: number) => {
    const x = id % map.w, y = Math.floor(id / map.w);
    return walkable(map.tiles[y][x], vehicle) && !(blocked?.has(id));
  };
  if (!allowed(target)) {
    let best = Infinity, replacement = -1;
    for (let d = 1; d <= 8 && replacement === -1; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const id = y * map.w + x, distance = Math.abs(x - sx) + Math.abs(y - sy);
      if (allowed(id) && distance < best) { best = distance; replacement = id; }
    }
    if (replacement === -1) return [];
    target = replacement;
  }
  if (start === target) return [];
  const g = new Float32Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open: number[] = [start];
  g[start] = 0;
  const heuristic = (id: number) => Math.abs(id % map.w - target % map.w) + Math.abs(Math.floor(id / map.w) - Math.floor(target / map.w));
  for (let count = 0; open.length && count < 4200; count++) {
    let bestIdx = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i++) { const score = g[open[i]] + heuristic(open[i]); if (score < bestF) { bestF = score; bestIdx = i; } }
    const current = open.splice(bestIdx, 1)[0];
    if (current === target) {
      const result: { x: number; y: number }[] = [];
      let at = target;
      while (at !== start && at !== -1) { result.push(center(at % map.w, Math.floor(at / map.w))); at = came[at]; }
      return result.reverse();
    }
    closed[current] = 1;
    const cx = current % map.w, cy = Math.floor(current / map.w);
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const next = y * map.w + x;
      if (closed[next] || (next !== start && !allowed(next))) continue;
      const v = g[current] + (map.tiles[y][x] === 'road' || map.tiles[y][x] === 'bridge' ? .7 : 1);
      if (v < g[next]) { came[next] = current; g[next] = v; if (!open.includes(next)) open.push(next); }
    }
  }
  return [];
}
