import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createHeadquartersAndRifleman } from './battlefieldGeometry';
import { STRUCTURES, UNITS, type BuildingKind, type Faction, type UnitKind } from './model';

export function createOperationModels() {
  const { hq: headquarters, rifleman } = createHeadquartersAndRifleman();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(.5, .5, 1, 8);
  const chamfered = new THREE.CylinderGeometry(.44, .5, 1, 8).rotateY(Math.PI / 8);
  const gableProfile = new THREE.Shape().moveTo(-.5, 0).lineTo(.5, 0).lineTo(0, 1).closePath();
  const gable = new THREE.ExtrudeGeometry(gableProfile, { depth: 1, bevelEnabled: false }).translate(0, 0, -.5).rotateY(Math.PI / 2);
  const surface = new THREE.MeshLambertMaterial({ vertexColors: true });
  const geometries = new Set<THREE.BufferGeometry>([cube, cylinder, chamfered, gable]);
  const materials = new Map<number, THREE.MeshLambertMaterial>();
  const originalMaterials = new Set<THREE.Material>();
  for (const model of [headquarters, rifleman]) {
    model.traverse(part => {
      if (part instanceof THREE.Mesh) {
        geometries.add(part.geometry);
        if (part.material instanceof THREE.Material) originalMaterials.add(part.material);
      }
    });
  }

  function add(parent: THREE.Group, color: number, size: [number, number, number], position: [number, number, number], shape: THREE.BufferGeometry = cube) {
    let material = materials.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color });
      materials.set(color, material);
    }
    const part = new THREE.Mesh(shape, material);
    part.scale.set(...size);
    part.position.set(...position);
    parent.add(part);
    return part;
  }

  // Bake each rigid piece into one mesh so units only need three draws for their animated poses.
  function bake(root: THREE.Object3D, palette: Readonly<Record<number, number>> = {}) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const parts: THREE.BufferGeometry[] = [];
    root.traverse(part => {
      if (!(part instanceof THREE.Mesh) || !(part.material instanceof THREE.MeshLambertMaterial) || !part.visible) return;
      const meshGeometry: THREE.BufferGeometry = part.geometry;
      const geometry = meshGeometry.index ? meshGeometry.toNonIndexed() : meshGeometry.clone();
      geometry.applyMatrix4(inverse.clone().multiply(part.matrixWorld));
      const positions = geometry.getAttribute('position');
      const sourceColor: THREE.Color = part.material.color;
      const replacement = palette[sourceColor.getHex()];
      const color = replacement === undefined ? sourceColor : new THREE.Color(replacement);
      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(geometry);
    });
    const geometry = mergeGeometries(parts)!;
    parts.forEach(part => part.dispose());
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  function infantry(kind: UnitKind, faction: Faction) {
    const source = rifleman.clone();
    const [torso, leftLeg, rightLeg] = source.children as THREE.Group[];
    const rifle = source.getObjectByName('rifle')!;
    let palette: Record<number, number> = {};
    if (kind === 'worker') {
      palette = { 0x657653: 0x807050, 0x879168: 0xc5a159, 0xa7a56d: 0xe3bb59, 0x64a4a2: 0x503e2e };
      rifle.removeFromParent();
      add(torso, 0x6c4a32, [.075, .10, .53], [.24, .82, .40]);
      add(torso, 0xabb8a7, [.36, .1, .10], [.24, .83, .65]);
    } else if (kind === 'scout') {
      palette = { 0x657653: 0x506e63, 0x879168: 0x73a18a, 0xa7a56d: 0x91b89d, 0xb0a773: 0x8b9b82 };
      rifle.scale.z = .78;
      add(torso, 0x49665d, [.16, .19, .13], [-.17, .88, .22]);
      add(torso, 0xabb89b, [.03, .41, .03], [-.21, 1.095, .19]);
    } else if (kind === 'demolition') {
      palette = { 0x657653: 0x655e43, 0x879168: 0x9c8c5a, 0xa7a56d: 0xcbb774, 0xb0a773: 0xc39459 };
      rifle.removeFromParent();
      add(torso, 0x41483c, [.18, .78, .18], [.27, .99, .27], cylinder).rotation.x = Math.PI / 2;
      add(torso, 0xa29762, [.20, .12, .20], [.27, .99, .56], cylinder).rotation.x = Math.PI / 2;
      add(torso, 0x31382e, [.13, .02, .13], [.27, .99, .665], cylinder).rotation.x = Math.PI / 2;
      add(torso, 0xb79a60, [.16, .23, .13], [-.21, .91, .21]);
    } else if (faction === 'zombie') {
      palette = { 0x657653: kind === 'runner' ? 0x795253 : 0x777b52, 0x879168: 0x747852,
        0xc39a76: 0x9dad79, 0x64a4a2: 0xad533d, 0xa7a56d: 0x686844, 0xb0a773: 0x706b4c };
      rifle.removeFromParent();
      for (const x of [-.245, .245]) {
        add(torso, 0x919e73, [.115, .11, .40], [x, .81, .31]);
        add(torso, 0xb0af83, [.11, .10, .12], [x, .8, .52]);
      }
    } else if (faction === 'raider') {
      palette = { 0x657653: 0x825649, 0x879168: 0xa87156, 0xb0a773: 0xb98a64, 0xa7a56d: 0xc36e4d, 0x64a4a2: 0x4c362c };
    }
    if (kind === 'sniper') {
      rifle.scale.z = 1.32;
      add(torso, 0x7a8b73, [.071, .06, .19], [.229, .925, .38]);
    }
    if (kind === 'gunner') rifle.scale.set(1.23, 1.08, 1.13);

    const result = new THREE.Group();
    const body = bake(torso, palette);
    body.name = 'body';
    result.add(body);
    for (const [name, limb] of [['left', leftLeg], ['right', rightLeg]] as const) {
      const foot = bake(limb, palette);
      foot.name = name;
      foot.position.copy(limb.position);
      result.add(foot);
    }
    const width = kind === 'gunner' || kind === 'brute' ? 1.23 : kind === 'runner' || kind === 'scout' ? .91 : 1;
    result.scale.set(width, kind === 'brute' ? 1.14 : .9, width);
    return result;
  }

  function vehicle(kind: UnitKind, faction: Faction) {
    const root = new THREE.Group();
    const armored = kind !== 'raiderTank';
    const paint = faction === 'human' ? 0x718272 : 0x9b654d;
    if (kind === 'reconBuggy') {
      for (const x of [-.44, .44]) {
        for (const z of [-.40, .40]) {
          add(root, 0x2b3734, [.34, .19, .34], [x, .18, z], cylinder).rotation.z = Math.PI / 2;
          add(root, 0x888c71, [.15, .20, .15], [x, .18, z], cylinder).rotation.z = Math.PI / 2;
        }
        add(root, 0x4c6054, [.065, .49, .065], [x * .65, .47, -.26]).rotation.x = -.25;
        add(root, 0x4c6054, [.065, .43, .065], [x * .65, .46, .14]).rotation.x = .24;
      }
      add(root, 0x799b80, [.71, .17, 1.10], [0, .28, 0]);
      add(root, paint, [.67, .14, .53], [0, .40, .29]);
      add(root, 0x8b9c83, [.62, .083, .40], [0, .72, -.06]);
      add(root, 0x313c37, [.074, .084, .39], [.03, .79, .13]);
      add(root, 0x41534a, [.037, .82, .037], [-.28, .75, -.40]);
      for (const x of [-.24, .24]) add(root, 0xd4d1a5, [.13, .10, .07], [x, .42, .553]);
      const result = new THREE.Group();
      result.add(bake(root));
      return result;
    }
    for (const x of [-.44, .44]) {
      add(root, 0x343f37, [.25, .245, 1.29], [x, .16, 0]);
      for (const z of [-.39, 0, .39]) add(root, 0x566056, [.16, .165, .18], [Math.sign(x) * .57, .16, z]);
    }
    add(root, paint, [.96, .32, 1.25], [0, .335, 0]);
    if (kind === 'mortarCarrier') {
      add(root, 0x87917c, [.77, .18, .47], [0, .57, .33]);
      add(root, 0x49564e, [.64, .22, .68], [0, .56, -.25], chamfered);
      add(root, 0x394940, [.22, .77, .22], [0, .87, -.14], cylinder).rotation.x = .62;
      add(root, 0x929478, [.24, .13, .24], [0, 1.15, .062], cylinder).rotation.x = .62;
      add(root, 0x344238, [.17, .018, .17], [0, 1.207, .10], cylinder).rotation.x = .62;
      for (const x of [-.27, .27]) {
        add(root, 0xafa171, [.15, .16, .56], [x, .61, -.26]);
        add(root, 0x58665e, [.17, .025, .08], [x, .70, -.21]);
      }
    } else {
      add(root, kind === 'tank' ? paint : 0x576962, [.70, .31, .61], [0, .625, -.07]);
      add(root, 0x2c3937, kind === 'tank' ? [.115, .114, .93] : [.088, .085, .51], [0, .74, .46]);
    }
    if (!armored) add(root, 0x709297, [.53, .16, .07], [0, .614, .32]);
    for (const x of [-.33, .33]) add(root, 0xd2c487, [.12, .08, .07], [x, .40, .64]);
    const result = new THREE.Group();
    result.add(bake(root));
    return result;
  }

  function structure(kind: BuildingKind, faction: Faction) {
    const hostile = faction !== 'human';
    const tint = hostile ? 0xa3644c : 0x718275;
    if (kind === 'hq') {
      const hq = bake(headquarters, hostile ? { 0x666b53: tint, 0x71634d: 0x864e3e, 0xbbab7a: 0xd79762 } : {});
      hq.scale.set(.49, .56, .61);
      hq.position.z = .23;
      return hq;
    }
    const root = new THREE.Group();
    const [w, d] = STRUCTURES[kind].size;
    const frame = 0x495950;
    const slab = 0x858478;
    const dark = 0x35443e;
    const trim = hostile ? 0xc18a65 : 0xa3ad94;
    add(root, slab, [w - .14, .14, d - .14], [0, .07, 0]);
    if (kind === 'wall') {
      add(root, dark, [.96, .17, .47], [0, .19, 0]);
      add(root, slab, [.87, .54, .34], [0, .47, 0]);
      for (const x of [-.35, 0, .35]) add(root, frame, [.10, .58, .41], [x, .45, 0]);
      add(root, trim, [.96, .09, .38], [0, .77, 0]);
    } else if (kind === 'turret') {
      add(root, dark, [.77, .16, .77], [0, .21, 0], cylinder);
      add(root, frame, [.58, .38, .58], [0, .39, 0], chamfered);
      add(root, tint, [.62, .24, .54], [0, .65, -.02], chamfered);
      add(root, trim, [.30, .075, .26], [0, .796, -.02], cylinder);
      add(root, dark, [.17, .17, .30], [0, .65, .25]);
      add(root, 0x50645a, [.10, .10, .44], [0, .65, .49]);
      add(root, dark, [.145, .135, .095], [0, .65, .68]);
      add(root, 0x83bbb0, [.12, .075, .072], [.22, .69, .21]);
    } else if (kind === 'farm') {
      for (const x of [-.56, 0, .56]) {
        add(root, 0x67533c, [.45, .07, 1.52], [x, .17, .08]);
        add(root, 0x907053, [.35, .035, 1.42], [x, .221, .09]);
        for (const z of [-.48, -.13, .23, .58]) {
          add(root, 0x537345, [.26, .16, .27], [x, .28, z], chamfered);
          add(root, z < 0 ? 0x879a53 : 0xa2aa58, [.18, .13, .19], [x + .023, .37, z], chamfered);
        }
      }
      add(root, 0x537a77, [1.54, .025, .17], [0, .16, -.76]);
      add(root, 0x7a9689, [.35, .37, .35], [.64, .32, -.66], cylinder);
      add(root, 0xb0b59c, [.38, .07, .38], [.64, .51, -.66], chamfered);
    } else if (kind === 'refinery') {
      for (const x of [-.47, .42]) {
        const height = x < 0 ? .83 : .67;
        add(root, dark, [.73, .10, .73], [x, .19, .23], cylinder);
        add(root, 0x869387, [.64, height, .64], [x, .24 + height / 2, .23], cylinder);
        add(root, 0xbd9b69, [.68, .11, .68], [x, height * .64, .23], cylinder);
        add(root, trim, [.66, .15, .66], [x, height + .308, .23], chamfered);
        add(root, dark, [.21, .07, .21], [x, height + .415, .23], cylinder);
      }
      add(root, 0x9d7154, [1.42, .10, .10], [0, .66, -.25]);
      add(root, 0x9d7154, [.10, .10, .52], [-.47, .66, -.04]);
      add(root, 0x9d7154, [.10, .10, .52], [.42, .66, -.04]);
      add(root, frame, [.26, 1.13, .26], [.60, .70, -.62], cylinder);
      add(root, 0xbbb29a, [.29, .17, .29], [.60, 1.23, -.62], cylinder);
    } else if (kind === 'power') {
      for (const x of [-.45, .45]) {
        add(root, dark, [.76, .18, 1.13], [x, .22, .14]);
        add(root, 0x648080, [.64, .47, .95], [x, .45, .16]);
        add(root, 0xc1a356, [.66, .12, .97], [x, .725, .16]);
        add(root, 0x354b47, [.51, .30, .04], [x, .46, .65]);
        for (const y of [.37, .45, .53]) add(root, trim, [.42, .029, .055], [x, y, .672]);
        add(root, dark, [.15, .49, .15], [x + .15, .91, -.23], cylinder);
        add(root, 0x95775d, [.19, .07, .19], [x + .15, 1.13, -.23], cylinder);
      }
      add(root, frame, [1.47, .12, .14], [0, .50, -.51]);
    } else if (kind === 'scrapyard') {
      add(root, dark, [1.48, .24, .12], [0, .27, -.66]);
      for (const [x, z, angle] of [[-.54, -.25, .23], [-.30, .16, -.30], [.19, .43, .46], [.56, .20, -.38]]) {
        add(root, 0x7b6758, [.50, .19, .39], [x, .25, z]).rotation.y = angle;
        add(root, 0x87958b, [.37, .11, .30], [x + .02, .40, z]).rotation.y = -angle;
      }
      add(root, 0xa58b52, [.45, .17, .44], [.47, .23, -.48]);
      add(root, 0xc5a95f, [.14, .90, .16], [.47, .70, -.48]);
      add(root, 0xc5a95f, [.96, .11, .13], [.06, 1.11, -.48]);
      add(root, dark, [.042, .36, .042], [-.36, .94, -.48]);
      add(root, 0x849183, [.21, .11, .095], [-.36, .76, -.48]);
    } else if (kind === 'depot') {
      for (const x of [-.43, .43]) {
        const paint = x < 0 ? 0x6f8986 : 0x9e8062;
        add(root, paint, [.69, .58, 1.26], [x, .43, -.11]);
        add(root, trim, [.72, .07, 1.30], [x, .735, -.11]);
        add(root, dark, [.62, .49, .04], [x, .43, .531]);
        for (const offset of [-.22, 0, .22]) {
          add(root, paint, [.041, .49, .071], [x + offset, .43, .55]);
          add(root, frame, [.043, .031, 1.17], [x + offset, .782, -.11]);
        }
      }
      for (const x of [-.43, .43]) add(root, 0x80684d, [.36, .19, .23], [x, .236, .73]);
    } else {
      const width = w - .29, depth = d - .32;
      const roof = { barracks: 0x718269, warFactory: 0x666e71, research: 0x789494, garage: 0x747565,
        armory: 0x7d8665, radar: 0x63918d, hospital: 0xbdb79c, workshop: 0x9a815c, academy: 0x657d83 }[kind];
      const bay = kind === 'garage' || kind === 'warFactory' || kind === 'workshop';
      const gabled = kind === 'barracks' || kind === 'armory' || kind === 'academy';
      const wallHeight = bay ? .89 : .74;
      const roofY = .12 + wallHeight;
      const front = depth / 2;
      const doorWidth = bay ? width * .66 : .42;
      add(root, tint, [width, wallHeight, depth], [0, .12 + wallHeight / 2, 0]);
      add(root, frame, [width + .025, .13, depth + .024], [0, .20, 0]);
      add(root, trim, [doorWidth + .12, .66, .085], [0, .484, front]);
      add(root, dark, [doorWidth, .55, .063], [0, .42, front + .048]);
      if (bay) {
        for (const y of [.25, .34, .43, .52, .61]) add(root, 0x74857b, [doorWidth - .08, .027, .061], [0, y, front + .075]);
        add(root, roof, [doorWidth + .19, .093, .29], [0, .78, front + .03]);
        for (const x of [-doorWidth * .44, doorWidth * .44]) add(root, 0xc3a464, [.10, .06, .06], [x, .73, front + .15]);
      } else {
        add(root, 0xb5a875, [.05, .14, .023], [.12, .44, front + .085]);
        add(root, slab, [.58, .06, .23], [0, .14, front + .06]);
      }
      for (const x of [-width * .39, width * .39]) {
        add(root, trim, [.11, wallHeight - .14, .08], [x, .50, front]);
        add(root, dark, [.255, .205, .064], [x, .62, front + .049]);
        add(root, 0x80b0a8, [.187, .135, .062], [x, .642, front + .066]);
      }
      for (const z of [-depth * .31, depth * .26]) {
        add(root, frame, [.053, .35, .32], [width / 2, .52, z]);
        add(root, 0x668f8b, [.053, .16, .23], [width / 2 + .027, .56, z]);
      }
      if (gabled) {
        add(root, tint, [width, .26, depth], [0, roofY - .012, 0], gable);
        for (const sign of [-1, 1]) {
          const panel = new THREE.Group();
          panel.position.set(0, roofY + .13, sign * depth / 4);
          panel.rotation.x = sign * .30;
          root.add(panel);
          add(panel, roof, [width + .09, .10, depth / 2 + .14], [0, 0, 0]);
          for (const x of [-width * .36, -width * .12, width * .12, width * .36]) {
            add(panel, trim, [.028, .033, depth / 2 + .09], [x, .055, 0]);
          }
        }
        add(root, frame, [width + .12, .11, .13], [0, roofY + .28, 0]);
      } else {
        add(root, roof, [width + .07, .13, depth + .09], [0, roofY + .04, 0]);
        for (const x of [-width / 2, width / 2]) add(root, trim, [.075, .13, depth + .079], [x, roofY + .11, 0]);
        if (bay) for (const x of [-width * .29, width * .29]) {
          add(root, frame, [.34, .18, .52], [x, roofY + .17, -.22]);
          add(root, trim, [.27, .07, .38], [x, roofY + .29, -.22]);
        }
      }
      if (kind === 'radar') {
        add(root, dark, [.54, .16, .54], [0, 1.02, 0], cylinder);
        add(root, frame, [.15, .63, .15], [0, 1.35, 0]);
        add(root, 0x7fa39c, [.98, .13, .80], [0, 1.65, 0], chamfered).rotation.x = .71;
        add(root, 0xb8c4ad, [.67, .06, .56], [0, 1.73, .047], cylinder).rotation.x = .71;
        add(root, frame, [.07, .26, .075], [0, 1.84, .16]).rotation.x = .61;
        add(root, 0xe2a672, [.11, .07, .09], [0, 1.96, .23]);
      } else if (kind === 'hospital') {
        add(root, 0xded7bc, [.63, .036, .63], [0, .985, 0]);
        add(root, 0xa84e43, [.49, .028, .125], [0, 1.012, 0]);
        add(root, 0xa84e43, [.125, .028, .49], [0, 1.014, 0]);
        add(root, roof, [.80, .105, .32], [0, .80, front + .037]);
      } else if (kind === 'research') {
        add(root, frame, [1.03, .19, .62], [0, 1.04, -.22]);
        add(root, 0x6fa19c, [.80, .09, .47], [0, 1.17, -.22]);
        add(root, trim, [.072, .65, .072], [.40, 1.39, -.31]);
        add(root, 0x89c5bc, [.14, .09, .14], [.40, 1.72, -.31]);
      } else if (kind === 'academy' || kind === 'barracks') {
        add(root, frame, [.055, .72, .055], [-width * .33, .52, front]);
        add(root, kind === 'academy' ? 0xa2bcbb : 0xb5a572, [.29, .16, .035], [-width * .33 + .15, .80, front + .012]);
      } else if (kind === 'armory') {
        for (const x of [-.39, .39]) add(root, 0xa69773, [.25, .19, .22], [x, .233, front + .03]);
      } else if (kind === 'workshop') {
        add(root, 0x938361, [.29, .48, .29], [width * .35, .39, front + .016], cylinder);
      }
    }
    return bake(root);
  }

  const units = new Map<string, THREE.Group>();
  const buildings = new Map<string, THREE.Mesh>();
  let survivorModel: THREE.Mesh | undefined;
  return {
    unit(kind: UnitKind, faction: Faction) {
      const key = `${faction}:${kind}`;
      let model = units.get(key);
      if (!model) {
        model = UNITS[kind].vehicle ? vehicle(kind, faction) : infantry(kind, faction);
        units.set(key, model);
      }
      return model.clone();
    },
    building(kind: BuildingKind, faction: Faction) {
      const key = `${faction}:${kind}`;
      let model = buildings.get(key);
      if (!model) {
        model = structure(kind, faction);
        buildings.set(key, model);
      }
      const root = new THREE.Group();
      root.add(model.clone());
      return root;
    },
    survivors() {
      if (!survivorModel) {
        const group = new THREE.Group();
        const clothes = [0xb19464, 0x6a8b87, 0x7f715e];
        clothes.forEach((color, index) => {
          const x = (index - 1) * .31, z = index === 1 ? -.20 : .11;
          add(group, 0x4d5346, [.20, .29, .17], [x, .145, z]);
          add(group, color, [.24, .30, .22], [x, .43, z]);
          add(group, 0xbc9872, [.16, .17, .15], [x, .65, z]);
          add(group, 0x665840, [.17, .06, .161], [x, .74, z]);
        });
        survivorModel = bake(group);
      }
      return survivorModel.clone();
    },
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      originalMaterials.forEach(material => material.dispose());
      materials.forEach(material => material.dispose());
      surface.dispose();
    },
  };
}
