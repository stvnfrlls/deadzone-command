import type { BuildingKind, TechId, UiSnapshot, UnitKind } from './model';
export interface GameController {
  place(kind: BuildingKind): void;
  train(kind: UnitKind): void;
  researchTechnology(id: TechId): void;
  repairVehicles(): void;
  upgradeSelected(): void;
  saveGame(): void;
  togglePause(): void;
  toggleHoldPosition(): void;
  focusAt(tx: number, ty: number): void;
}
let controller: GameController | null = null;
let snapshot: UiSnapshot | null = null;
const listeners = new Set<() => void>();
export function registerController(value: GameController | null) { controller = value; }
export function action() { return controller; }
export function publish(value: UiSnapshot) { snapshot = value; for (const fn of listeners) fn(); }
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getSnapshot() { return snapshot; }
export function clearSnapshot() { snapshot = null; for (const fn of listeners) fn(); }
