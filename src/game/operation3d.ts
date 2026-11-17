import * as THREE from 'three';
import { addBattlefieldTerrain } from './battlefieldGeometry';
import { GROUND_TILE_HEIGHT, STRUCTURES, TILE, type Faction } from './model';
import { createOperationModels } from './operationModels';
import { createOperationRoutes } from './operationRoutes';
import type { RtsScene } from './RtsScene';

const PITCH_SINE = GROUND_TILE_HEIGHT / TILE;
const PITCH_COSINE = Math.sqrt(1 - PITCH_SINE ** 2);

export function mountOperation3d(host: HTMLElement, operation: RtsScene) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const canvas = renderer.domElement;
  const events = new AbortController();
  const world = new THREE.Scene();
  world.background = new THREE.Color(0x101a1c);
  addBattlefieldTerrain(world, operation.map);
  const terrain = world.children.slice();
  const templates = createOperationModels();
  const routes = createOperationRoutes(world);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 130);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  world.add(new THREE.HemisphereLight(0xf0ebd5, 0x788d80, 2.2));
  const sun = new THREE.DirectionalLight(0xffddb2, 2.14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
  sun.shadow.camera.right = sun.shadow.camera.top = 30;
  sun.shadow.camera.far = 95;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .037;
  sun.shadow.bias = -.0005;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  world.add(sun, sun.target);

  type Model = { root: THREE.Group; faction: Faction; body?: THREE.Object3D; left?: THREE.Object3D; right?: THREE.Object3D };
  const actors = new Map<number, Model>();
  const survivors = new Map<number, THREE.Mesh>();
  const activeIds = new Set<number>();
  let contextLost = false;
  let width = 0, height = 0, zoom = 0;

  function alignCamera() {
    const source = operation.cameras.main;
    if (source.width <= 0 || source.height <= 0) return false;
    if (width !== source.width || height !== source.height) {
      width = source.width;
      height = source.height;
      const scale = Math.min(.8, 1600 / Math.max(width, height));
      renderer.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), false);
      camera.right = width / (2 * TILE);
      camera.left = -camera.right;
      camera.top = height / (2 * TILE);
      camera.bottom = -camera.top;
      zoom = 0;
    }
    if (zoom !== source.zoom) {
      zoom = camera.zoom = source.zoom;
      camera.updateProjectionMatrix();
    }
    const x = source.midPoint.x / TILE;
    const z = source.midPoint.y / GROUND_TILE_HEIGHT;
    // Match Phaser's ground projection so input, fog, and tactical overlays stay aligned.
    camera.position.set(x, PITCH_SINE * 60, z + PITCH_COSINE * 60);
    camera.lookAt(x, 0, z);
    camera.updateMatrixWorld();
    sun.target.position.set(x, 0, z);
    sun.position.set(x - 15, 29, z - 12);
    return true;
  }

  function pick(x: number, y: number, faction?: Faction) {
    const view = operation.cameras.main;
    pointer.set((x - view.midPoint.x) * 2 * zoom / width, (view.midPoint.y - y) * 2 * zoom / height);
    raycaster.setFromCamera(pointer, camera);
    const candidates = [...actors.values()].filter(model => model.root.visible && (!faction || model.faction === faction));
    let mesh: THREE.Object3D | null | undefined = raycaster.intersectObjects(candidates.map(model => model.root), true)[0]?.object;
    while (mesh) {
      if (typeof mesh.userData.id === 'number') return mesh.userData.id as number;
      mesh = mesh.parent;
    }
    return undefined;
  }

  function syncActors() {
    activeIds.clear();
    for (const unit of operation.units) {
      if (unit.hp <= 0) continue;
      activeIds.add(unit.id);
      let model = actors.get(unit.id);
      const x = unit.x / TILE, z = unit.y / TILE;
      if (!model) {
        if (!unit.sprite.visible) continue;
        const root = templates.unit(unit.kind, unit.faction);
        root.userData.id = unit.id;
        root.position.set(x, 0, z);
        root.rotation.y = unit.sprite.flipX ? -.4 : .4;
        model = { root, faction: unit.faction, body: root.getObjectByName('body'), left: root.getObjectByName('left'), right: root.getObjectByName('right') };
        world.add(root);
        actors.set(unit.id, model);
      }
      const { root, body, left, right } = model;
      const dx = x - root.position.x, dz = z - root.position.z;
      root.visible = unit.sprite.visible;
      if (unit.visual.pose === 'attack') root.rotation.y = unit.visual.facing;
      else if (Math.hypot(dx, dz) > .001) root.rotation.y = Math.atan2(dx, dz);
      root.position.set(x, 0, z);

      if (body && left && right) {
        const phase = operation.elapsed * (unit.visual.gait === 'run' ? 16 : 11) + unit.id;
        const stride = unit.visual.gait === 'idle' ? 0 : Math.sin(phase) * .61;
        left.rotation.x = stride;
        right.rotation.x = -stride;
        body.position.y = unit.visual.gait === 'idle' ? Math.sin(phase / 4) * .013 : Math.abs(stride) * .092;
        body.position.z = unit.visual.pose === 'attack' ? -Math.max(0, 1 - (operation.elapsed - unit.visual.attackAt) * 8) * .10 : 0;
        body.rotation.x = unit.visual.pose === 'work' ? Math.sin(phase) * .25 : 0;
        body.rotation.z = unit.visual.pose === 'flinch' ? .12 : 0;
      }
    }

    for (const building of operation.buildings) {
      if (building.hp <= 0) continue;
      activeIds.add(building.id);
      let model = actors.get(building.id);
      if (!model && building.sprite.visible) {
        const root = templates.building(building.kind, building.faction);
        const [w, d] = STRUCTURES[building.kind].size;
        root.userData.id = building.id;
        root.position.set(building.tx + w / 2, 0, building.ty + d / 2);
        model = { root, faction: building.faction };
        world.add(root);
        actors.set(building.id, model);
      }
      if (model) model.root.visible = building.sprite.visible;
    }
    for (const [id, { root }] of actors) {
      if (activeIds.has(id)) continue;
      root.removeFromParent();
      actors.delete(id);
    }

    for (const group of operation.getSurvivorGroups()) {
      let model = survivors.get(group.id);
      if (!model && group.sprite.visible) {
        model = templates.survivors();
        survivors.set(group.id, model);
        world.add(model);
      }
      if (!model) continue;
      model.visible = group.sprite.visible;
      if (group.rescued) {
        model.removeFromParent();
        survivors.delete(group.id);
      } else model.position.set(group.x / TILE, group.escortId === null ? 0 : .019 * Math.abs(Math.sin(operation.elapsed * 10)), group.y / TILE);
    }
  }

  function render() {
    if (contextLost || !alignCamera()) return;
    syncActors();
    const selected = new Set(operation.selected);
    routes.update(selected.size
      ? operation.units.filter(unit => unit.hp > 0 && unit.faction === 'human' && selected.has(unit.id) && unit.path.length)
      : []);
    renderer.render(world, camera);
  }

  function dispose() {
    events.abort();
    if (operation.sys.isActive()) operation.useOperationModels();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const object of terrain) {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (!(object instanceof THREE.Mesh)) continue;
      geometries.add(object.geometry);
      if (object.material instanceof THREE.Material) materials.add(object.material);
    }
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    templates.dispose();
    routes.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  try {
    canvas.addEventListener('webglcontextlost', () => {
      contextLost = true;
      canvas.hidden = true;
      operation.useOperationModels();
    }, { signal: events.signal });
    canvas.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      render();
      operation.useOperationModels(pick);
      canvas.hidden = false;
    }, { signal: events.signal });
    render();
    host.append(canvas);
    operation.useOperationModels(pick);
    return { render, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
