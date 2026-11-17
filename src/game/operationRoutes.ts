import * as THREE from 'three';
import { TILE, UNITS, type UnitKind } from './model';

type Point = { x: number; y: number };
type MovingUnit = Point & { kind: UnitKind; path: readonly Point[] };
const DASH_LENGTH = .29;
const DASH_SPACING = .52;
const TRACE_HEIGHT = .019;

export function createOperationRoutes(world: THREE.Scene) {
  const dashGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringGeometry = new THREE.RingGeometry(.17, .24, 20).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xcce9a1 });
  const transform = new THREE.Object3D();
  const destinations: THREE.Mesh[] = [];
  let capacity = 256;
  let dashes = makeDashes(capacity);

  function makeDashes(size: number) {
    const mesh = new THREE.InstancedMesh(dashGeometry, material, size);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.add(mesh);
    return mesh;
  }

  function writeDash(index: number) {
    if (index === capacity) {
      capacity *= 2;
      const expanded = makeDashes(capacity);
      expanded.instanceMatrix.array.set(dashes.instanceMatrix.array);
      dashes.removeFromParent();
      dashes.dispose();
      dashes = expanded;
    }
    transform.updateMatrix();
    dashes.setMatrixAt(index, transform.matrix);
  }

  return {
    update(units: readonly MovingUnit[]) {
      let dashCount = 0, destinationCount = 0;
      for (const unit of units) {
        const goal = unit.path[unit.path.length - 1];
        if (!goal) continue;
        let from: Point = unit;
        let distanceAlongRoute = 0;
        const clearance = UNITS[unit.kind].vehicle ? .74 : .45;
        for (const to of unit.path) {
          const dx = (to.x - from.x) / TILE, dz = (to.y - from.y) / TILE;
          const length = Math.hypot(dx, dz);
          if (length > .001) {
            transform.rotation.y = Math.atan2(dx, dz);
            const phase = distanceAlongRoute % DASH_SPACING;
            for (let dash = -phase; dash < length; dash += DASH_SPACING) {
              const start = Math.max(0, dash, clearance - distanceAlongRoute);
              const end = Math.min(length, dash + DASH_LENGTH);
              if (end - start < .025) continue;
              const middle = (start + end) / (2 * length);
              transform.position.set(from.x / TILE + dx * middle, TRACE_HEIGHT, from.y / TILE + dz * middle);
              transform.scale.set(.105, 1, end - start);
              writeDash(dashCount++);
            }
          }
          distanceAlongRoute += length;
          from = to;
        }
        let marker = destinations[destinationCount++];
        if (!marker) {
          marker = new THREE.Mesh(ringGeometry, material);
          world.add(marker);
          destinations.push(marker);
        }
        marker.position.set(goal.x / TILE, TRACE_HEIGHT + .003, goal.y / TILE);
        marker.visible = true;
      }
      for (let index = destinationCount; index < destinations.length; index++) destinations[index].visible = false;
      dashes.count = dashCount;
      if (dashCount) {
        dashes.instanceMatrix.clearUpdateRanges();
        dashes.instanceMatrix.addUpdateRange(0, dashCount * dashes.instanceMatrix.itemSize);
        dashes.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      dashes.dispose();
      dashGeometry.dispose();
      ringGeometry.dispose();
      material.dispose();
    },
  };
}
