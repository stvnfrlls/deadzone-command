import * as THREE from 'three';
import { seededRandom } from './map';
import { TERRAIN_COLORS, type Terrain, type TileMap } from './model';

const GROUND_COLORS: Record<Terrain, number> = {
  grass: 0x647954, forest: 0x526647, sand: 0xb3a276, road: 0x79796a,
  water: 0x355d63, bridge: 0x8a8169, ruin: 0x61655d,
};

type Tree = { x: number; z: number; scale: number; turn: number };

export function addBattlefieldTerrain(scene: THREE.Scene, map: TileMap) {
  const random = seededRandom(`${map.seed}-3d-terrain`);
  const foliage: Tree[] = [];
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const tileMaterial = new THREE.MeshLambertMaterial();
  const tiles = new THREE.InstancedMesh(plane, tileMaterial, map.w * map.h);
  const parts = new THREE.Object3D();
  const color = new THREE.Color();
  const details: { x: number; y: number; z: number; w: number; d: number; color: number }[] = [];
  const landBase = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x38595d }));
  landBase.position.set(map.w / 2, -.14, map.h / 2);
  scene.add(landBase);
  const palette = map.environment ? TERRAIN_COLORS[map.environment] : GROUND_COLORS;
  const ruins: { x: number; z: number; height: number; turn: number }[] = [];

  for (let z = 0; z < map.h; z++) {
    for (let x = 0; x < map.w; x++) {
      const tile = map.tiles[z][x];
      const height = tile === 'water' ? -.10 : 0;
      parts.position.set(x + .5, height, z + .5);
      parts.updateMatrix();
      tiles.setMatrixAt(z * map.w + x, parts.matrix);
      tiles.setColorAt(z * map.w + x, color.setHex(palette[tile]).multiplyScalar(.86 + random() * .28));
      if (tile === 'forest') {
        foliage.push({ x: x + .32 + random() * .25, z: z + .2 + random() * .26, scale: .42 + random() * .29, turn: random() * Math.PI });
      } else if (tile === 'ruin') {
        ruins.push({ x: x + .48, z: z + .47, height: .24 + random() * .63, turn: (random() - .5) * .26 });
      }
      if (tile === 'water' && map.tiles[z][x + 1] === 'sand') {
        details.push({ x: x + .84, y: -.096, z: z + .5, w: .26, d: .8, color: 0x8dada1 });
      } else if (tile === 'water' && map.tiles[z][x - 1] === 'sand') {
        details.push({ x: x + .16, y: -.096, z: z + .5, w: .26, d: .8, color: 0x8dada1 });
      } else if ((tile === 'road' || tile === 'bridge') && (x + z) % 2 === 0) {
        const vertical = map.tiles[z - 1]?.[x] === tile || map.tiles[z + 1]?.[x] === tile;
        details.push({ x: x + .5, y: .008, z: z + .5, w: vertical ? .10 : .55, d: vertical ? .55 : .1, color: 0xa69a6d });
      } else if (random() < .54) {
        const isWater = tile === 'water';
        const tint = tile === 'sand' ? 0xc5b588 : isWater ? 0x507d7f : tile === 'road' ? 0x8b8976 : 0x78845b;
        details.push({ x: x + .2 + random() * .58, y: height + .004, z: z + .2 + random() * .58,
          w: (isWater ? .23 : .1) + random() * .26, d: .06 + random() * .11, color: tint });
      }
    }
  }
  tiles.receiveShadow = true;
  const flecks = new THREE.InstancedMesh(plane, tileMaterial, details.length);
  details.forEach((detail, index) => {
    parts.position.set(detail.x, detail.y, detail.z);
    parts.scale.set(detail.w, 1, detail.d);
    parts.updateMatrix();
    flecks.setMatrixAt(index, parts.matrix);
    flecks.setColorAt(index, color.setHex(detail.color));
  });
  flecks.receiveShadow = true;
  scene.add(tiles, flecks);

  const treeParts = [
    { geometry: new THREE.CylinderGeometry(.067, .14, 1.24, 5), color: 0x615b3e, y: .62 },
    { geometry: new THREE.ConeGeometry(.72, 1.50, 5), color: 0x4e6847, y: 1.32 },
    { geometry: new THREE.ConeGeometry(.53, 1.21, 5), color: 0x678257, y: 1.94 },
  ];
  for (const part of treeParts) {
    const meshes = new THREE.InstancedMesh(part.geometry, tileMaterial, foliage.length);
    foliage.forEach((tree, index) => {
      parts.position.set(tree.x, part.y * tree.scale, tree.z);
      parts.scale.setScalar(tree.scale);
      parts.rotation.y = tree.turn;
      parts.updateMatrix();
      meshes.setMatrixAt(index, parts.matrix);
      meshes.setColorAt(index, color.setHex(part.color).multiplyScalar(.83 + random() * .34));
    });
    meshes.castShadow = true;
    scene.add(meshes);
  }
  const rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), tileMaterial, ruins.length);
  ruins.forEach(({ x, z, height, turn }, index) => {
    parts.position.set(x, height / 2, z);
    parts.scale.set(.72, height, .63);
    parts.rotation.y = turn;
    parts.updateMatrix();
    rubble.setMatrixAt(index, parts.matrix);
    rubble.setColorAt(index, color.setHex(0x726e61).multiplyScalar(.77 + random() * .38));
  });
  rubble.castShadow = rubble.receiveShadow = true;
  scene.add(rubble);
}

export function createHeadquartersAndRifleman() {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map<number, THREE.MeshLambertMaterial>();
  function part(parent: THREE.Object3D, color: number, size: [number, number, number], position: [number, number, number], geometry: THREE.BufferGeometry) {
    let material = materials.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color });
      materials.set(color, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...size);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const box = (parent: THREE.Object3D, color: number, size: [number, number, number], position: [number, number, number]) =>
    part(parent, color, size, position, cube);

  const hq = new THREE.Group();
  const concrete = 0x8b8b72;
  const wall = 0x666b53;
  const metal = 0x3b4943;
  const rust = 0x71634d;
  const black = 0x29332f;
  const glass = 0x64a4a2;
  const cream = 0xbbab7a;
  box(hq, concrete, [5.75, .24, 4.55], [0, .12, -.38]);
  const walls = box(hq, wall, [4.9, 1.85, 3.54], [0, 1.14, -.59]);
  box(hq, metal, [5, .19, 3.63], [0, 1.91, -.59]);
  box(hq, black, [1.18, 1.38, .08], [-.45, .87, 1.22]);
  box(hq, metal, [.86, 1.19, .09], [-.45, .77, 1.26]);
  box(hq, concrete, [1.36, .16, .44], [-.45, .21, 1.43]);
  box(hq, cream, [.48, .10, .08], [-.45, 1.57, 1.29]);
  box(hq, cream, [.05, .23, .06], [-.18, .86, 1.33]);
  for (const x of [-2.32, 2.32]) {
    box(hq, concrete, [.14, 1.52, .11], [x, 1.01, 1.19]);
  }
  for (const x of [-1.65, .73, 1.62]) {
    box(hq, black, [.64, .50, .09], [x, 1.30, 1.22]);
    box(hq, glass, [.47, .32, .09], [x, 1.31, 1.27]);
    box(hq, metal, [.052, .32, .042], [x, 1.31, 1.32]);
  }
  for (const z of [-1.76, -.62, .52]) {
    box(hq, black, [.09, .47, .65], [2.47, 1.34, z]);
    box(hq, glass, [.09, .3, .47], [2.52, 1.36, z]);
    box(hq, metal, [.042, .3, .052], [2.57, 1.36, z]);
  }
  box(hq, black, [.10, .47, .78], [2.46, .63, .51]);
  for (const y of [.49, .60, .71, .82]) box(hq, concrete, [.08, .043, .68], [2.53, y, .51]);
  const gableProfile = new THREE.Shape().moveTo(-1.77, 0).lineTo(1.77, 0).lineTo(0, .43).closePath();
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(gableProfile, { depth: 4.9, bevelEnabled: false }), walls.material);
  gable.rotation.y = Math.PI / 2;
  gable.position.set(-2.45, 2, -.59);
  gable.castShadow = gable.receiveShadow = true;
  hq.add(gable);
  for (const sign of [-1, 1]) {
    const roof = new THREE.Group();
    roof.position.set(0, 2.19, -.59 + sign * .89);
    roof.rotation.x = sign * .27;
    hq.add(roof);
    box(roof, rust, [5.28, .16, 2.03], [0, 0, 0]);
    for (const x of [-2.38, -1.59, -.79, 0, .79, 1.59, 2.38]) {
      box(roof, 0x8d7a5e, [.07, .05, 1.97], [x, .102, 0]);
    }
  }
  box(hq, metal, [5.39, .17, .21], [0, 2.49, -.59]);
  box(hq, concrete, [1.35, .36, 1.07], [1.20, 2.55, -.94]);
  box(hq, cream, [.12, 2.7, .12], [1.20, 3.87, -.94]);
  box(hq, cream, [1.43, .074, .075], [1.20, 4.81, -.94]);
  box(hq, cream, [.97, .072, .072], [1.20, 4.49, -.94]);
  box(hq, 0xef875d, [.16, .17, .16], [1.20, 5.29, -.94]);
  for (const x of [-2.35, 2.26]) {
    box(hq, metal, [.56, .5, .56], [x, .37, 1.49]);
    box(hq, cream, [.56, .12, .57], [x, .50, 1.49]);
  }

  const rifleman = new THREE.Group();
  const torso = new THREE.Group();
  const rifle = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  const helmet = new THREE.CylinderGeometry(.78, 1, 1, 8).rotateY(Math.PI / 8);
  const brim = new THREE.CylinderGeometry(1, 1, 1, 8).rotateY(Math.PI / 8);
  const uniform = 0x657653;
  const armor = 0x879168;
  const webbing = 0x4f5941;
  const pouch = 0xb0a773;
  rifleman.add(torso, leftLeg, rightLeg);
  rifle.name = 'rifle';
  torso.add(rifle);
  leftLeg.position.set(-.14, .58, 0);
  rightLeg.position.set(.14, .58, 0);
  for (const leg of [leftLeg, rightLeg]) {
    box(leg, uniform, [.216, .36, .226], [0, -.13, 0]);
    box(leg, webbing, [.175, .14, .075], [0, -.24, .12]);
    box(leg, 0x394135, [.188, .21, .206], [0, -.42, -.015]);
    box(leg, 0x3f493a, [.222, .103, .293], [0, -.493, .048]);
    box(leg, 0x2a322c, [.226, .04, .305], [0, -.56, .052]);
  }
  box(torso, uniform, [.46, .46, .31], [0, .80, 0]);
  box(torso, webbing, [.45, .09, .33], [0, .625, 0]);
  box(torso, armor, [.385, .301, .09], [0, .832, .168]);
  for (const x of [-.118, 0, .118]) box(torso, pouch, [.096, .109, .063], [x, .771, .224]);
  box(torso, webbing, [.285, .345, .16], [0, .855, -.204]);
  box(torso, armor, [.245, .087, .185], [0, .984, -.218]);
  box(torso, 0xc39a76, [.254, .232, .239], [0, 1.141, .032]);
  box(torso, webbing, [.249, .105, .092], [0, 1.095, .134]);
  box(torso, black, [.253, .058, .07], [0, 1.193, .153]);
  box(torso, glass, [.202, .037, .045], [0, 1.198, .185]);
  part(torso, armor, [.212, .202, .199], [0, 1.36, -.013], helmet);
  part(torso, 0xa7a56d, [.214, .046, .207], [0, 1.271, .004], brim);
  box(torso, uniform, [.155, .302, .168], [.299, .853, .053]).rotation.x = -.78;
  box(torso, uniform, [.155, .302, .168], [-.299, .853, .053]).rotation.x = -.90;
  box(torso, armor, [.164, .108, .18], [.291, .966, .005]);
  box(torso, armor, [.164, .108, .18], [-.291, .966, .005]);
  box(torso, 0xc39a76, [.122, .108, .131], [.263, .774, .224]);
  box(torso, uniform, [.425, .116, .118], [-.034, .785, .255]).rotation.y = .52;
  box(torso, 0xc39a76, [.111, .101, .123], [.171, .783, .374]);
  box(rifle, webbing, [.103, .112, .229], [.229, .825, .111]);
  box(rifle, black, [.103, .123, .309], [.229, .827, .366]);
  box(rifle, metal, [.116, .088, .199], [.229, .818, .55]);
  box(rifle, metal, [.071, .092, .09], [.229, .739, .398]).rotation.x = -.24;
  box(rifle, black, [.05, .052, .207], [.229, .822, .733]);
  return { hq, rifleman };
}
