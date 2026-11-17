import Phaser from 'phaser';
import { UNITS, type BuildingKind, type Faction, type UnitKind } from './model';

/**
 * N64-inspired, faceted pseudo-3D art for Phaser's existing 2D RTS renderer.
 * Textures are generated once per faction/type: no runtime geometry or 3D engine.
 * The original selection, pathfinding, hit-testing and save models stay intact.
 */
const poly = (g: Phaser.GameObjects.Graphics, color: number, points: number[], alpha = 1) => {
  const vertices: Phaser.Geom.Point[] = [];
  for (let i = 0; i < points.length; i += 2) vertices.push(new Phaser.Geom.Point(points[i], points[i + 1]));
  g.fillStyle(color, alpha).fillPoints(vertices, true);
};
const rectangle = (g: Phaser.GameObjects.Graphics, color: number, x: number, y: number, w: number, h: number) =>
  g.fillStyle(color).fillRect(x, y, w, h);
const oval = (g: Phaser.GameObjects.Graphics, color: number, x: number, y: number, w: number, h: number, alpha = 1) =>
  g.fillStyle(color, alpha).fillEllipse(x, y, w, h);

export const N64_UNIT_ANIMATIONS = {
  idle: { frames: 4, fps: 4 },
  walk: { frames: 4, fps: 8 },
  run: { frames: 4, fps: 12 },
  attack: { frames: 3, fps: 15 },
  flinch: { frames: 2, fps: 14 },
  death: { frames: 5, fps: 10 },
  work: { frames: 4, fps: 8 },
} as const;

export type N64UnitPose = keyof typeof N64_UNIT_ANIMATIONS;

export function n64UnitFrame(pose: N64UnitPose, age: number) {
  const { frames, fps } = N64_UNIT_ANIMATIONS[pose];
  const frame = Math.floor(age * fps);
  const loop = pose === 'idle' || pose === 'walk' || pose === 'run' || pose === 'work';
  return `${pose}-${loop ? frame % frames : Math.min(frame, frames - 1)}`;
}

export function n64PoseDuration(pose: N64UnitPose) {
  const { frames, fps } = N64_UNIT_ANIMATIONS[pose];
  return frames / fps;
}

function humanoid(g: Phaser.GameObjects.Graphics, kind: UnitKind, faction: Faction, pose: N64UnitPose, frame: number) {
  const undead = faction === 'zombie';
  const worker = kind === 'worker';
  const heavy = kind === 'gunner' || kind === 'brute';
  const runner = kind === 'runner';
  const sniper = kind === 'sniper';
  const scout = kind === 'scout';
  const demolition = kind === 'demolition';
  const enemy = faction === 'raider';
  const torso = undead ? kind === 'runner' ? 0x78595b : 0x677658 : worker ? 0xba9353 : enemy ? 0x8e5945 : scout ? 0x527569 : demolition ? 0x887853 : 0x64836a;
  const lit = undead ? 0x8e9970 : worker ? 0xe2b86b : enemy ? 0xc1815a : scout ? 0x7db29c : demolition ? 0xc9ad69 : 0x99b183;
  const dark = undead ? 0x3d4d3e : enemy ? 0x593d37 : 0x384d43;
  const skin = undead ? 0xa4b189 : enemy ? 0xc18f70 : 0xd6ab82;
  const shade = undead ? 0x687b62 : enemy ? 0x9a6954 : 0xb98764;
  const ox = runner ? 4 : heavy ? -3 : 0;
  const width = heavy ? 20 : 16;
  const stride = pose === 'run' ? 9 : pose === 'walk' ? 5 : 0;
  const swing = [0, 1, 0, -1][frame % 4] * stride;
  const recoil = pose === 'attack' ? [4, 2, 0][frame] : 0;
  const flinch = pose === 'flinch' ? [5, 2][frame] : 0;
  const cx = 34 + ox + (undead ? recoil : -recoil) - flinch + (pose === 'run' ? 3 : 0);
  const feetX = 34 + ox;
  const bob = pose === 'work' ? [0, 1, 4, 2][frame]
    : stride ? [0, 2, 0, 2][frame] : pose === 'idle' ? [0, 1, 2, 1][frame] : flinch / 2;
  const top = (heavy ? 11 : runner ? 16 : 13) + bob;
  const backFoot = feetX - swing;
  const frontFoot = feetX + swing;
  const backLift = swing < 0 ? stride / 2 : 0;
  const frontLift = swing > 0 ? stride / 2 : 0;

  oval(g, 0x101c1b, feetX + 2, 53, 33 + stride, 8, .44);
  // Faceted boots and separate legs, from a fixed three-quarter camera.
  poly(g, 0x26302f, [cx - 10, 41, cx - 1, 41, backFoot - 3, 52 - backLift, backFoot - 13, 52 - backLift]);
  poly(g, 0x1c2626, [cx + 1, 40, cx + 10, 42, frontFoot + 12, 52 - frontLift, frontFoot + 2, 52 - frontLift]);
  poly(g, dark, [cx - 10, 36, cx + 1, 36, backFoot - 1, 45 - backLift, backFoot - 10, 45 - backLift]);
  poly(g, torso, [cx + 1, 36, cx + 11, 37, frontFoot + 9, 45 - frontLift, frontFoot, 44 - frontLift]);
  poly(g, 0x171f22, [backFoot - 13, 49 - backLift, backFoot - 2, 49 - backLift, backFoot - 3, 54 - backLift, backFoot - 16, 54 - backLift]);
  poly(g, 0x171f22, [frontFoot + 1, 49 - frontLift, frontFoot + 12, 48 - frontLift, frontFoot + 16, 53 - frontLift, frontFoot + 2, 54 - frontLift]);
  // Vest/jacket: light, front and shaded side use distinct flat polygon faces.
  poly(g, dark, [cx - width / 2 - 3, top + 11, cx - 5, top + 8, cx - 3, 39, cx - width / 2 - 4, 38]);
  poly(g, torso, [cx - 7, top + 8, cx + width / 2, top + 9, cx + 8, 39, cx - 4, 39]);
  poly(g, lit, [cx - 7, top + 8, cx + 2, top + 9, cx - 4, top + 15, cx - 9, top + 14]);
  poly(g, dark, [cx + width / 2 - 3, top + 9, cx + width / 2 + 3, top + 14, cx + 10, 39, cx + 6, 38]);
  rectangle(g, 0x27352e, cx - 8, 34, 18, 3);
  if (!undead) {
    rectangle(g, 0x26332e, cx - 5, top + 17, 4, 5);
    rectangle(g, lit, cx + 3, top + 17, 4, 4);
  }
  // Head, cheek, chin and a flat-shaded helmet or headband.
  poly(g, shade, [cx - 6, top, cx + 5, top, cx + 9, top + 5, cx + 6, top + 13, cx - 3, top + 13, cx - 8, top + 7]);
  poly(g, skin, [cx - 6, top + 1, cx + 4, top + 1, cx + 6, top + 6, cx + 2, top + 11, cx - 5, top + 10]);
  poly(g, lit, [cx - 9, top + 2, cx - 5, top - 4, cx + 4, top - 5, cx + 9, top + 1, cx + 5, top + 4]);
  if (undead) {
    poly(g, 0x455342, [cx - 9, top + 1, cx - 4, top - 3, cx + 6, top - 2, cx + 9, top + 3, cx - 5, top + 4]);
    rectangle(g, 0x9e3f39, cx + 2, top + 6, 2, 2);
  } else if (enemy) {
    poly(g, 0x9f493c, [cx - 8, top - 1, cx + 5, top - 3, cx + 10, top + 1, cx + 7, top + 3, cx - 8, top + 3]);
    rectangle(g, 0x512825, cx + 5, top + 1, 5, 2);
  } else {
    poly(g, worker ? 0xd3a14c : 0x576953, [cx - 9, top + 1, cx - 6, top - 5, cx + 5, top - 6, cx + 9, top, cx + 8, top + 3, cx - 9, top + 4]);
    rectangle(g, worker ? 0x9e6d32 : 0x33483d, cx - 8, top + 2, 18, 2);
  }
  rectangle(g, 0x242e2b, cx + 2, top + 6, 3, 2);
  poly(g, skin, [cx + 5, top + 8, cx + 8, top + 8, cx + 5, top + 10]);

  if (undead) {
    // Two outstretched arms differentiate infected from armed soldiers.
    poly(g, skin, [cx - 9, top + 16, cx - 17, top + 20, cx - 24, top + 18, cx - 23, top + 14, cx - 10, top + 10]);
    poly(g, shade, [cx + 8, top + 13, cx + 18, top + 16, cx + 24, top + 11, cx + 27, top + 14, cx + 18, top + 22, cx + 8, top + 20]);
    return;
  }
  // Shoulders, hands, and diagonal rifle/tool remain legible at RTS zoom.
  poly(g, shade, [cx - 10, top + 13, cx - 16, top + 18, cx - 12, top + 27, cx - 6, top + 27, cx - 7, top + 17]);
  poly(g, skin, [cx + 9, top + 14, cx + 17, top + 18, cx + 10, top + 28, cx + 6, top + 25]);
  if (worker) {
    const toolX = cx + 14 + (pose === 'work' ? [-5, 0, 12, 5][frame] : 0);
    const toolY = top + 16 + (pose === 'work' ? [-13, -7, 14, 5][frame] : 0);
    g.lineStyle(4, 0x29312e).lineBetween(cx + 10, top + 28, toolX, toolY);
    poly(g, 0xb4b9a6, [toolX - 5, toolY, toolX, toolY - 3, toolX + 5, toolY, toolX + 1, toolY + 4, toolX - 4, toolY + 3]);
  } else {
    const gunLength = sniper ? 22 : heavy || demolition ? 19 : scout ? 11 : 16;
    poly(g, 0x192326, [cx - 4, top + 24, cx + 12, top + 18, cx + 13 + gunLength, top + 20, cx + 13 + gunLength, top + 24, cx + 7, top + 27]);
    rectangle(g, 0x758079, cx + 8, top + 18, gunLength - 3, 2);
    poly(g, 0x343b3b, [cx + 4, top + 24, cx + 12, top + 24, cx + 10, top + 33, cx + 5, top + 32]);
    if (heavy) rectangle(g, 0x8a9168, cx + 17, top + 24, 7, 6);
    if (sniper) rectangle(g, 0x9cae98, cx + 17, top + 16, 7, 2);
    if (scout) g.lineStyle(2, lit).lineBetween(cx - 14, top + 19, cx - 15, top + 6);
    if (demolition) rectangle(g, 0x9d9268, cx + 25, top + 18, 6, 8);
  }
}

function vehicle(g: Phaser.GameObjects.Graphics, kind: UnitKind, faction: Faction, pose: N64UnitPose, frame: number) {
  const allied = faction === 'human';
  const hull = allied ? 0x617f6d : 0x976b55;
  const side = allied ? 0x3c584e : 0x684a40;
  const top = allied ? 0x9db291 : 0xc19a70;
  const large = kind === 'tank' || kind === 'raiderTank' || kind === 'mortarCarrier';
  oval(g, 0x10191b, 36, 53, 55, 9, .5);
  if (kind === 'reconBuggy') {
    for (const x of [17, 52]) {
      oval(g, 0x26312e, x, 46, 16, 18);
      oval(g, 0x7f8c74, x, 46, 8, 9);
    }
    poly(g, side, [7, 37, 18, 30, 49, 29, 63, 36, 57, 44, 13, 45]);
    poly(g, top, [40, 31, 51, 29, 61, 35, 45, 38]);
    g.lineStyle(3, 0x97a890).lineBetween(20, 35, 24, 18).lineBetween(24, 18, 42, 18).lineBetween(42, 18, 47, 33);
    g.lineStyle(2, 0xadb497).lineBetween(16, 31, 14, 13);
    rectangle(g, 0x2c3b34, 38, 17, 17, 4);
    rectangle(g, 0xe0c282, 58, 36, 4, 4);
    return;
  }
  // Tracks/wheels make the vehicle silhouette recognizable at a distance.
  poly(g, 0x202a2a, [7, 38, 63, 38, 66, 49, 58, 53, 11, 53, 5, 48]);
  for (const x of large ? [13, 24, 35, 46, 57] : [14, 34, 54]) {
    oval(g, 0x64716b, x, 47, 7, 8);
    if (pose === 'walk' || pose === 'run') rectangle(g, 0x333e39, x - 2 + frame, 47, 2, 3);
  }
  poly(g, side, [8, 35, 18, 29, 59, 31, 64, 37, 60, 47, 13, 47]);
  poly(g, hull, [10, 33, 19, 24, 52, 24, 64, 32, 58, 40, 17, 41]);
  poly(g, top, [19, 24, 30, 20, 55, 25, 62, 32, 18, 33]);
  rectangle(g, 0x233633, 11, 39, 5, 4);
  rectangle(g, 0xe0b269, 59, 36, 4, 3);
  const recoil = pose === 'attack' ? [6, 3, 0][frame] : 0;
  if (kind === 'mortarCarrier') {
    poly(g, side, [20, 26, 27, 17, 48, 18, 53, 31, 22, 33]);
    poly(g, 0x303e34, [32, 24, 42 - recoil, 4, 50 - recoil, 8, 41, 27]);
    poly(g, top, [41 - recoil, 4, 47 - recoil, 3, 51 - recoil, 9, 46 - recoil, 11]);
    rectangle(g, 0xa09662, 53, 24, 9, 8);
  } else if (large) {
    poly(g, side, [27, 27, 28, 14, 45, 13, 51, 25, 45, 32, 26, 32]);
    poly(g, top, [28, 15, 36, 10, 46, 13, 48, 19, 29, 21]);
    poly(g, 0x293735, [43, 19, 66 - recoil, 16, 69 - recoil, 20, 46, 25]);
    rectangle(g, 0x8b9684, 53, 17, 14 - recoil, 2);
  } else {
    poly(g, 0x344945, [22, 26, 26, 20, 44, 20, 50, 28, 42, 32, 22, 32]);
    poly(g, 0x8aa49a, [27, 22, 41, 22, 43, 26, 24, 26]);
    rectangle(g, 0x202b2a, 35, 14, 6, 8);
    rectangle(g, 0x939a8c, 40, 15, 14 - recoil, 3);
  }
  if (pose === 'flinch') {
    const rise = frame * 4;
    poly(g, 0xeea66f, [47, 31, 50, 24 - rise, 53, 26 - rise, 50, 31]);
    rectangle(g, 0xffd699, 55 + frame * 4, 28 - rise, 3, 2);
  }
}

/** Generated at 2x, displayed by the scene at the original 36x30 world size. */
export function createN64UnitTexture(scene: Phaser.Scene, kind: UnitKind, faction: Faction) {
  const key = `unit-${faction}-${kind}`;
  if (scene.textures.exists(key)) return;
  const width = 72, height = 60;
  const poses = (Object.keys(N64_UNIT_ANIMATIONS) as N64UnitPose[])
    .filter(pose => pose !== 'work' || kind === 'worker');
  const columns = Math.max(...poses.map(pose => N64_UNIT_ANIMATIONS[pose].frames));
  const atlas = scene.textures.createCanvas(key, width * columns, height * poses.length)!;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const g = scene.make.graphics({ x: 0, y: 0 });
  atlas.context.imageSmoothingEnabled = false;
  for (const [row, pose] of poses.entries()) {
    for (let frame = 0; frame < N64_UNIT_ANIMATIONS[pose].frames; frame++) {
      const x = frame * width, y = row * height;
      ctx.clearRect(0, 0, width, height);
      g.clear();
      if (UNITS[kind].vehicle) vehicle(g, kind, faction, pose, frame);
      else humanoid(g, kind, faction, pose, frame);
      g.generateTexture(canvas, width, height);
      if (pose === 'death') {
        const progress = frame / (N64_UNIT_ANIMATIONS.death.frames - 1);
        const collapse = 1 - progress * (UNITS[kind].vehicle ? .38 : .8);
        const lean = progress * (UNITS[kind].vehicle ? .08 : .45);
        atlas.context.save();
        atlas.context.beginPath();
        atlas.context.rect(x, y, width, height);
        atlas.context.clip();
        atlas.context.translate(x + 54 * lean, y + 54 * (1 - collapse));
        atlas.context.transform(1, 0, -lean, collapse, 0, 0);
        atlas.context.drawImage(canvas, 0, 0);
        atlas.context.restore();
      } else {
        atlas.context.drawImage(canvas, x, y);
      }
      atlas.add(`${pose}-${frame}`, 0, x, y, width, height);
    }
  }
  g.destroy();
  atlas.refresh();
}

function baseBuilding(g: Phaser.GameObjects.Graphics, kind: BuildingKind, faction: 'human' | 'raider', w: number, h: number) {
  const allied = faction === 'human';
  const wall = allied ? 0x6c7a71 : 0x8d7063;
  const lightWall = allied ? 0xa0a89a : 0xb4a08c;
  const darkWall = allied ? 0x3b4e49 : 0x6a4942;
  const roof = allied ? 0x536d57 : 0x854c3f;
  const roofLit = allied ? 0x809574 : 0xb77d59;
  const trim = allied ? 0xa7c29b : 0xc9a07b;
  const signal = allied ? 0x94dcc1 : 0xf0a56d;
  const foot = h - 4;
  const top = Math.max(6, h - 43);
  const eave = top + 15;
  const l = 6, r = w - 6;
  const middle = Math.floor(w * .47);
  oval(g, 0x101b19, w / 2, foot - 1, w - 5, 9, .43);
  // Front and side are separate facets, with a wide sloped roof above.
  poly(g, darkWall, [l, eave + 1, middle, eave + 8, middle, foot, l, foot - 6]);
  poly(g, wall, [middle, eave + 8, r, eave + 2, r, foot - 6, middle, foot]);
  poly(g, lightWall, [middle + 2, eave + 10, r - 2, eave + 4, r - 2, eave + 9, middle + 2, eave + 15]);
  poly(g, 0x2a3535, [l - 2, foot - 6, middle, foot - 1, middle, foot + 1, l - 2, foot - 4]);
  poly(g, roof, [l - 1, eave - 1, middle, top + 2, middle + 2, eave + 6, l - 2, eave + 5]);
  poly(g, roofLit, [middle, top + 2, r - 1, top + 9, r + 2, eave + 3, middle + 2, eave + 6]);
  poly(g, trim, [l - 1, eave + 4, middle + 2, eave + 10, middle + 2, eave + 12, l - 1, eave + 6]);
  poly(g, trim, [middle + 2, eave + 10, r + 1, eave + 4, r + 1, eave + 6, middle + 2, eave + 12]);
  // Recessed front entrance, glowing windows and a raised roofline.
  const doorW = Math.max(8, Math.min(21, w * .18));
  const doorX = Math.round(w * .62);
  rectangle(g, 0x1e302e, doorX, foot - 17, doorW, 15);
  rectangle(g, 0x46534b, doorX + 2, foot - 15, doorW - 4, 10);
  rectangle(g, 0xe3b56e, Math.max(middle + 2, doorX - 16), eave + 14, 10, 4);
  rectangle(g, 0x263b39, Math.max(middle + 2, doorX - 16) - 1, eave + 13, 12, 6);
  rectangle(g, 0xf0c579, Math.max(middle + 2, doorX - 16), eave + 14, 10, 3);
  rectangle(g, 0x2b3e38, l + 4, eave + 9, 11, 5);
  rectangle(g, signal, l + 5, eave + 10, 9, 2);
  const roofX = Math.floor(w * .52);
  // Unique silhouettes for each building type, using the same N64 palette.
  switch (kind) {
    case 'hq':
      poly(g, darkWall, [roofX - 12, top + 4, roofX - 7, top - 10, roofX + 12, top - 10, roofX + 17, top + 5]);
      poly(g, lightWall, [roofX - 7, top - 10, roofX + 9, top - 10, roofX + 13, top - 5, roofX - 9, top - 4]);
      rectangle(g, signal, roofX + 2, top - 6, 7, 3);
      rectangle(g, 0x293833, roofX + 15, top - 13, 2, 19);
      rectangle(g, allied ? 0x77cbb1 : 0xc87962, roofX + 16, top - 15, 7, 4);
      break;
    case 'barracks':
      rectangle(g, 0x39493e, doorX + 2, foot - 14, doorW - 4, 8);
      for (let y = foot - 13; y < foot - 4; y += 4) rectangle(g, lightWall, doorX + 2, y, doorW - 4, 1);
      break;
    case 'warFactory':
    case 'garage':
    case 'workshop':
      rectangle(g, 0x273431, doorX - 5, foot - 18, doorW + 5, 17);
      for (let y = foot - 16; y < foot - 4; y += 4) rectangle(g, wall, doorX - 3, y, doorW + 1, 2);
      rectangle(g, 0xc9aa58, doorX - 5, foot - 3, doorW + 5, 2);
      rectangle(g, 0x53645a, roofX - 10, top + 2, 19, 4);
      break;
    case 'power':
    case 'refinery':
    case 'depot':
      for (const x of [roofX - 19, roofX + 4]) {
        poly(g, darkWall, [x, top + 7, x + 3, top - 12, x + 16, top - 12, x + 18, top + 8]);
        poly(g, lightWall, [x + 3, top - 12, x + 15, top - 12, x + 18, top - 7, x + 1, top - 7]);
        rectangle(g, 0x9f6552, x + 2, top - 4, 15, 4);
      }
      break;
    case 'farm':
      rectangle(g, 0x3f6344, l + 3, foot - 17, Math.max(10, middle - l - 4), 11);
      for (let x = l + 5; x < middle - 1; x += 6) rectangle(g, 0x94ac69, x, foot - 14, 3, 7);
      break;
    case 'research':
    case 'hospital':
    case 'academy':
      rectangle(g, kind === 'hospital' ? 0xc8d4c6 : 0x7fb7a4, roofX - 8, top - 4, 17, 9);
      rectangle(g, kind === 'hospital' ? 0xa44842 : 0x3b635b, roofX - 1, top - 3, 3, 8);
      rectangle(g, kind === 'hospital' ? 0xa44842 : 0x3b635b, roofX - 4, top, 9, 3);
      break;
    case 'radar':
      rectangle(g, darkWall, roofX, top - 10, 4, 14);
      oval(g, lightWall, roofX + 2, top - 13, 26, 10);
      oval(g, 0x3d5450, roofX + 2, top - 15, 18, 6);
      break;
    case 'turret':
      rectangle(g, darkWall, roofX - 8, top - 6, 18, 12);
      poly(g, trim, [roofX - 8, top - 6, roofX + 5, top - 10, roofX + 12, top - 5, roofX, top]);
      rectangle(g, 0x293331, roofX + 7, top - 4, 20, 5);
      rectangle(g, 0x9da79a, roofX + 10, top - 3, 17, 1);
      break;
    case 'scrapyard':
      rectangle(g, 0x50534b, l + 3, top - 2, 16, 12);
      poly(g, 0xa87a53, [l + 5, top + 1, l + 15, top + 4, l + 12, top + 8, l + 3, top + 6]);
      rectangle(g, 0x798678, r - 8, top - 11, 4, 15);
      break;
    case 'wall':
      poly(g, lightWall, [l, eave + 5, middle, eave + 9, r, eave + 4, r, foot - 8, middle, foot - 2, l, foot - 8]);
      rectangle(g, darkWall, middle - 2, eave + 8, 3, foot - eave - 9);
      break;
    case 'armory':
      rectangle(g, 0x293e39, roofX - 9, top - 3, 19, 8);
      rectangle(g, trim, roofX - 6, top, 13, 2);
      break;
  }
}

export function createN64BuildingTexture(
  scene: Phaser.Scene, kind: BuildingKind, faction: 'human' | 'raider', width: number, height: number
) {
  const g = scene.make.graphics({ x: 0, y: 0 });
  baseBuilding(g, kind, faction, width, height);
  g.generateTexture(`building-${faction}-${kind}`, width, height);
  g.destroy();
}

/** Four survivors with the same faceted palette as the military units. */
export function createN64SurvivorTexture(scene: Phaser.Scene) {
  const g = scene.make.graphics({ x: 0, y: 0 });
  const people = [
    { x: 12, y: 10, coat: 0x9a7957, hair: 0x55463c },
    { x: 29, y: 8, coat: 0x618779, hair: 0x394743 },
    { x: 18, y: 18, coat: 0x9c795c, hair: 0x60453e },
    { x: 43, y: 18, coat: 0x71838a, hair: 0x524a3e },
  ];
  oval(g, 0x121b1b, 31, 45, 50, 9, .42);
  for (const { x, y, coat, hair } of people) {
    poly(g, 0x283333, [x - 4, y + 18, x, y + 18, x - 2, y + 31, x - 6, y + 31]);
    poly(g, 0x293535, [x + 1, y + 18, x + 5, y + 18, x + 6, y + 31, x + 2, y + 31]);
    poly(g, coat, [x - 6, y + 8, x + 5, y + 7, x + 8, y + 20, x - 7, y + 21]);
    poly(g, 0xa8b3a1, [x - 5, y + 8, x, y + 9, x - 3, y + 17, x - 6, y + 15]);
    poly(g, 0xb48d71, [x - 4, y + 1, x + 4, y + 1, x + 5, y + 8, x - 3, y + 10]);
    poly(g, hair, [x - 5, y + 3, x - 3, y - 2, x + 3, y - 2, x + 6, y + 3]);
  }
  g.generateTexture('survivor-group', 64, 52);
  g.destroy();
}
