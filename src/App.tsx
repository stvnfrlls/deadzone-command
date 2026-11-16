import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Phaser from 'phaser';
import { version } from '../package.json';
import { RtsScene } from './game/RtsScene';
import { action, clearSnapshot, getSnapshot, subscribe } from './game/bridge';
import { environmentForSeed } from './game/map';
import { ENVIRONMENT_LABELS, STORAGE_KEY, RESOURCE_DEPOSITS, STRUCTURES, SURVIVOR_TARGET, TERRAIN_COLORS, TECH, UNITS, fmtCost, type BuildingKind, type GameSave, type TechId, type UiSnapshot, type UnitKind } from './game/model';
import './styles.css';

type Tab = 'build' | 'units' | 'research';
type Session = { id: number; seed: string; save?: GameSave };
const COMMAND_LABELS: Record<Tab, string> = { build: 'Construct', units: 'Produce', research: 'Research' };
const GROUPS: { title: string; kinds: BuildingKind[] }[] = [
  { title: 'Command & infrastructure', kinds: ['power', 'depot', 'scrapyard', 'refinery', 'farm', 'radar'] },
  { title: 'Military production', kinds: ['barracks', 'warFactory', 'armory', 'academy'] },
  { title: 'Research & maintenance', kinds: ['research', 'garage', 'hospital', 'workshop'] },
  { title: 'Defensive fortifications', kinds: ['turret', 'wall'] }
];
function getSave(): GameSave | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as GameSave;
    return parsed?.version === 1 && typeof parsed.seed === 'string' && Array.isArray(parsed?.map?.tiles) && Array.isArray(parsed?.units) && Array.isArray(parsed?.buildings) ? parsed : null;
  } catch { return null; }
}
function hhmm(seconds: number) {
  const mm = Math.floor(seconds / 60), ss = Math.floor(seconds % 60);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function canBuy(snapshot: UiSnapshot, cost: Partial<Record<'scrap' | 'oil' | 'food', number>>) {
  return Object.entries(cost).every(([k, v]) => snapshot.resources[k as keyof typeof snapshot.resources] >= (v ?? 0));
}

function GameCanvas({ session }: { session: Session }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const scene = new RtsScene(session.seed, session.save);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: '#101a1c',
      render: { pixelArt: true, antialias: false },
      scale: { mode: Phaser.Scale.RESIZE, width: 1024, height: 700, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [scene],
      fps: { target: 60, forceSetTimeOut: false }
    });
    return () => { game.destroy(true); clearSnapshot(); };
  }, [session]);
  return <div className="game-canvas" ref={host} role="application" aria-label="Deadzone Command battlefield" />;
}

function Minimap({ snapshot }: { snapshot: UiSnapshot }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const map = snapshot.map;
    const colors = Object.fromEntries(Object.entries(TERRAIN_COLORS[map.environment ?? 'coastal'])
      .map(([terrain, color]) => [terrain, `#${color.toString(16).padStart(6, '0')}`]));
    const sx = 224 / map.w, sy = 158 / map.h;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      ctx.fillStyle = !snapshot.explored[y]?.[x] ? '#0a1419' : snapshot.visible[y]?.[x] ? colors[map.tiles[y][x]] : '#283335';
      ctx.fillRect(x * sx, y * sy, sx + .5, sy + .5);
    }
    for (const node of map.resourceNodes ?? []) {
      if (node.remaining <= 0 || !snapshot.explored[node.ty]?.[node.tx]) continue;
      ctx.fillStyle = `#${RESOURCE_DEPOSITS[node.kind].color.toString(16)}`;
      ctx.fillRect(node.tx * sx, node.ty * sy, 3, 3);
    }
    for (const b of snapshot.structures) {
      if (b.faction !== 'human' && !snapshot.visible[b.ty]?.[b.tx]) continue;
      ctx.fillStyle = b.faction === 'human' ? '#8de1ac' : '#fc796c';
      ctx.fillRect(b.tx * sx, b.ty * sy, 3.5, 3.5);
    }
    for (const u of snapshot.units) {
      if (u.faction !== 'human' && !snapshot.visible[u.ty]?.[u.tx]) continue;
      ctx.fillStyle = u.faction === 'human' ? '#c6f0b3' : u.faction === 'raider' ? '#f4a271' : '#adcc8b';
      ctx.fillRect(u.tx * sx, u.ty * sy, 2, 2);
    }
    for (const survivor of snapshot.survivorSites) {
      ctx.fillStyle = survivor.escorted ? '#fff1be' : '#e2bd78';
      ctx.fillRect(survivor.tx * sx - 1, survivor.ty * sy - 1, 4, 4);
    }
  }, [snapshot]);
  return <canvas ref={canvas} width="224" height="158" className="minimap-canvas" aria-label="Battlefield minimap" onClick={event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const tx = Math.floor((event.clientX - rect.left) / rect.width * snapshot.map.w);
    const ty = Math.floor((event.clientY - rect.top) / rect.height * snapshot.map.h);
    action()?.focusAt(tx, ty);
  }} title="Click to move battlefield camera" />;
}

function Menu({ onStart, onContinue }: { onStart: (seed: string) => void; onContinue: () => void }) {
  const [seed, setSeed] = useState(`DZ-${Math.floor(Date.now() / 1000).toString(36).toUpperCase()}`);
  const [saved] = useState(() => getSave());
  const operationSeed = seed.trim() || 'OUTBREAK-001';
  const environment = environmentForSeed(operationSeed);
  return (
    <main className="menu-screen">
      <div className="menu-grid-overlay" />
      <div className="menu-shell">
        <div className="menu-header"><span className="tiny-mark">D / C</span><span>POST-COLLAPSE COMMAND SIMULATOR</span><span>BUILD {version}</span></div>
        <div className="menu-layout">
          <section className="menu-main">
            <div className="eyebrow"><span className="pulse" /> COMMAND ONLINE · SINGLE PLAYER RTS</div>
            <h1>DEADZONE<span>COMMAND</span></h1>
            <p>Reclaim hostile territory. Raise a military outpost, develop new technology, and march against raider strongholds through a world overrun by the infected.</p>
            <div className="menu-divider" />
            <label className="input-label" htmlFor="seed">BATTLEFIELD SEED</label>
            <div className="seed-row"><input id="seed" maxLength={40} value={seed} onChange={e => setSeed(e.target.value.toUpperCase())} spellCheck={false} /><button className="button-secondary" onClick={() => setSeed(`DZ-${Math.random().toString(36).slice(2, 9).toUpperCase()}`)}>RANDOMIZE</button></div>
            <button className="button-primary start-button" onClick={() => onStart(operationSeed)}>START NEW OPERATION <span>↗</span></button>
            {saved && <button className="continue-button" onClick={onContinue}>CONTINUE SAVED OPERATION · {saved.seed}</button>}
            <div className="menu-footnote">SINGLE PLAYER · PROCEDURAL MAPS · LOCAL BROWSER SAVES · VERCEL READY</div>
          </section>
          <aside className="mission-intel">
            <div className="intel-heading"><span>MISSION BRIEFING</span><span className="live-dot" /></div>
            <div className="world-preview" data-environment={environment}><div className="preview-water" /><div className="preview-road r1" /><div className="preview-road r2" /><div className="preview-river" /><div className="preview-base player" /><div className="preview-base enemy one" /><div className="preview-base enemy two" /><span className="world-caption">OPERATION: RECLAMATION</span></div>
            <div className="mission-line"><span>PRIMARY DIRECTIVE</span><strong>RESTORE HUMANITY</strong></div>
            <div className="mission-line"><span>ENVIRONMENT</span><strong>{ENVIRONMENT_LABELS[environment]}</strong></div>
            <div className="mission-line"><span>AVAILABLE SYSTEMS</span><strong>BASE CONSTRUCTION · R&D · VEHICLES</strong></div>
            <div className="mission-warning">THREAT ALERT <p>Hostile raiders operate fortified compounds. Undead hordes wander independently and may engage either faction.</p></div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function MissionObjective({ snapshot }: { snapshot: UiSnapshot }) {
  const { rescued, settlementReady, cureReady } = snapshot.restoration;
  const researchingCure = snapshot.research?.id === 'cure';
  const canResearch = snapshot.powerProduced >= snapshot.powerUsed && snapshot.buildings.some(b => b.kind === 'research' && b.count > 0);
  return <section className="battlefield-objective" aria-labelledby="restoration-title">
    <h2 id="restoration-title">Restore Humanity</h2>
    <dl>
      <dt>Survivors rescued</dt><dd>{rescued}/{SURVIVOR_TARGET}</dd>
      <dt title="Keep the command center, Food Farm, and Field Hospital powered.">Powered farm + hospital</dt>
      <dd>{settlementReady ? 'Ready' : 'Needed'}</dd>
      <dt>Infection cure</dt><dd>{cureReady ? 'Ready' : researchingCure ? (canResearch && !snapshot.paused ? 'Researching' : 'Paused') : 'Needed'}</dd>
    </dl>
  </section>;
}

function ProductionQueue({ snapshot }: { snapshot: UiSnapshot }) {
  if (!snapshot.production.length) return null;
  const total = snapshot.production.reduce((count, facility) => count + facility.jobs.length, 0);
  const state = snapshot.paused || snapshot.status !== 'playing' ? 'Paused'
    : snapshot.powerUsed > snapshot.powerProduced ? 'Low power' : 'Training';
  return <section className="production-queue" aria-labelledby="production-title">
    <header>
      <h2 id="production-title">Production queue</h2>
      <span>{total} {total === 1 ? 'unit' : 'units'}</span>
    </header>
    <div className="production-list">
      {snapshot.production.map(({ buildingId, building, tx, ty, jobs: [active, ...waiting] }) => {
        const unit = UNITS[active.kind];
        return <div className="production-facility" key={buildingId}>
          <h3><span>{STRUCTURES[building].label}</span><small>X{tx} Y{ty}</small></h3>
          <div className="production-item">
            <strong>{unit.label}</strong>
            <span>{Math.ceil(active.remaining)}s</span>
          </div>
          <progress max={unit.buildTime} value={Math.max(0, unit.buildTime - active.remaining)}
            aria-label={`${unit.label} training progress`} />
          <span className="production-status">{state}</span>
          {waiting.length > 0 && <div className="production-waiting">
            <h4>Waiting</h4>
            <ol>{waiting.map((job, index) => <li key={index}>{UNITS[job.kind].label}</li>)}</ol>
          </div>}
        </div>;
      })}
    </div>
  </section>;
}

function CommandMenu({ snapshot, tab, onClose, onPlace }: { snapshot: UiSnapshot; tab: Tab; onClose: () => void; onPlace: (kind: BuildingKind) => void }) {
  const buildingCounts = Object.fromEntries(snapshot.buildings.map(x => [x.kind, x.count]));
  return (
    <section id="command-menu" className="command-panel" aria-labelledby="command-title">
      <header className="command-panel-header">
        <h2 id="command-title">{COMMAND_LABELS[tab]}</h2>
        <button className="command-close" aria-label={`Close ${COMMAND_LABELS[tab]} menu`} onClick={onClose}>×</button>
      </header>
      <div className="panel-scroll">
        {tab === 'build' && GROUPS.map(group => <div className="action-group" key={group.title}>
          <h3>{group.title}</h3>
          {group.kinds.map(kind => {
            const def = STRUCTURES[kind]; const locked = !!def.requires && !buildingCounts[def.requires];
            const disabled = locked || !canBuy(snapshot, def.cost) || snapshot.status !== 'playing';
            return <button className={`action-item ${snapshot.placement === kind ? 'chosen' : ''}`} key={kind} onClick={() => onPlace(kind)} disabled={disabled} title={def.description}>
              <span className="action-icon">{def.short}</span><span className="action-text"><strong>{def.label}</strong><small>{locked ? `Requires ${STRUCTURES[def.requires!].label}` : def.description}</small><em>{fmtCost(def.cost)}</em></span><span className="action-count">{buildingCounts[kind] || '+'}</span>
            </button>;
          })}
        </div>)}
        {tab === 'units' && <div className="action-group"><h3>Available units</h3>
          {(['worker', 'rifleman', 'gunner', 'sniper', 'apc', 'tank'] as UnitKind[]).map(kind => {
            const def = UNITS[kind]; const locked = !def.building || !buildingCounts[def.building];
            return <button className="action-item" key={kind} disabled={locked || !canBuy(snapshot, def.cost) || snapshot.powerProduced < snapshot.powerUsed || snapshot.status !== 'playing'} onClick={() => action()?.train(kind)}>
              <span className="action-icon">{kind === 'worker' ? 'WRK' : def.vehicle ? 'VHC' : 'INF'}</span><span className="action-text"><strong>{def.label}</strong><small>{locked ? `Requires ${STRUCTURES[def.building!].label}` : def.description}</small><em>{fmtCost(def.cost)} · {def.buildTime}s</em></span><span className="action-count">+</span>
            </button>;
          })}
        </div>}
        {tab === 'research' && <div className="action-group"><h3>Technology development</h3>
          {Object.entries(TECH).map(([key, def]) => {
            const id = key as TechId, level = snapshot.techs[id];
            const cost = Object.fromEntries(Object.entries(def.cost).map(([k, v]) => [k, Math.ceil((v ?? 0) * (1 + level * .6))]));
            const locked = !buildingCounts[def.requires];
            return <button className="action-item" key={id} disabled={locked || !!snapshot.research || level >= def.max || !canBuy(snapshot, cost) || snapshot.status !== 'playing'} onClick={() => action()?.researchTechnology(id)}>
              <span className="action-icon tech-icon">{level}/{def.max}</span><span className="action-text"><strong>{def.label}</strong><small>{locked ? `Requires ${STRUCTURES[def.requires].label}` : def.description}</small><em>{level >= def.max ? 'MAXIMUM LEVEL' : fmtCost(cost)}</em></span><span className="action-count">{level === def.max ? '✓' : '→'}</span>
            </button>;
          })}
          <h3>Active project</h3>
          {snapshot.research ? <div className="research-status"><strong>{TECH[snapshot.research.id].label}</strong><span>{Math.ceil(snapshot.research.remaining)}s remaining</span></div> : <p className="muted">No active research project.</p>}
          <h3>Vehicle garage</h3><button className="garage-button" disabled={!buildingCounts.garage || snapshot.resources.scrap < 25} onClick={() => action()?.repairVehicles()}>REPAIR NEARBY VEHICLES <span>25 SCRAP</span></button>
        </div>}
      </div>
    </section>
  );
}

function Battlefield({ session, exit }: { session: Session; exit: () => void }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const headquarters = snapshot?.structures.find(b => b.kind === 'hq' && b.faction === 'human');
  const [tab, setTab] = useState<Tab | null>(null);
  const commandButtons = useRef<HTMLDivElement>(null);
  const [help, setHelp] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  function closeCommandMenu() {
    commandButtons.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus();
    setTab(null);
  }
  function chooseStructure(kind: BuildingKind) {
    action()?.place(kind);
    if (getSnapshot()?.placement === kind) closeCommandMenu();
  }
  return <div className="app-layout">
    <header className="top-bar">
      <div className="brand-small"><span className="brand-emblem">D/C</span><span>DEADZONE <strong>COMMAND</strong></span><span className="build-marker">V{version}</span></div>
      <div className="resource-bar">
        <div className="resource"><span className="resource-symbol metal">◈</span><span>SCRAP</span><strong>{Math.floor(snapshot?.resources.scrap ?? 0)}</strong></div>
        <div className="resource"><span className="resource-symbol oil">●</span><span>OIL</span><strong>{Math.floor(snapshot?.resources.oil ?? 0)}</strong></div>
        <div className="resource"><span className="resource-symbol food">◆</span><span>FOOD</span><strong>{Math.floor(snapshot?.resources.food ?? 0)}</strong></div>
        <div className={`resource power ${snapshot && snapshot.powerProduced < snapshot.powerUsed ? 'power-low' : ''}`}><span className="resource-symbol">⚡</span><span>POWER</span><strong>{snapshot?.powerUsed ?? 0}/{snapshot?.powerProduced ?? 0}</strong></div>
      </div>
      <div className="header-buttons"><span className="timer">{hhmm(snapshot?.elapsed ?? 0)}</span><button onClick={() => setHelp(v => !v)} title="Controls and help">?</button><button onClick={() => action()?.saveGame()} title="Save operation">SAVE</button><button onClick={() => action()?.togglePause()}>{snapshot?.paused ? 'RESUME' : 'PAUSE'}</button><button onClick={() => setConfirmExit(true)} title="Return to main menu">MENU</button></div>
    </header>
    <div className="main-area">
      <section className="battlefield-area">
        <GameCanvas session={session} />
        <div className="battlefield-reports">
          <div className="map-top-left"><span className="map-coordinate">{headquarters ? `HQ / X${headquarters.tx} Y${headquarters.ty}` : 'BATTLEFIELD'}</span>{snapshot && <span className="map-subtext">{ENVIRONMENT_LABELS[snapshot.map.environment ?? 'coastal']} <b>● ACTIVE</b></span>}</div>
          {snapshot && snapshot.messages.length > 0 && <div className="battle-log"><span className="log-heading">FIELD TRANSMISSIONS <i /></span>{snapshot.messages.slice(-3).reverse().map(m => <div className="log-line" key={m.id}><span>›</span>{m.text}</div>)}</div>}
          {snapshot?.placement && <div className="placement-prompt">POSITION {STRUCTURES[snapshot.placement].label.toUpperCase()} ON CLEAR GROUND <span>RIGHT CLICK / ESC TO CANCEL</span></div>}
        </div>
        {snapshot && <div className="battlefield-intel">
          <MissionObjective snapshot={snapshot} />
          <ProductionQueue snapshot={snapshot} />
        </div>}
        <div className="battlefield-hud">
          {snapshot && <aside className="minimap-box" aria-label="Map and faction legend">
            <div className="minimap-heading"><span>MINIMAP</span><span title={snapshot.seed}>{snapshot.seed}</span></div>
            <Minimap snapshot={snapshot} />
            <div className="minimap-legend"><span><i className="pin friendly" /> ALLIED</span><span><i className="pin hostile" /> RAIDER</span><span><i className="pin infected" /> INFECTED</span><span><i className="pin survivors" /> SURVIVORS</span></div>
          </aside>}
          <div className="command-dock">
            <div className="command-buttons" ref={commandButtons} role="group" aria-label="Battlefield commands">
              {(Object.keys(COMMAND_LABELS) as Tab[]).map(command => <button
                key={command}
                disabled={!snapshot}
                aria-expanded={tab === command}
                aria-controls={tab === command ? 'command-menu' : undefined}
                onClick={() => setTab(current => current === command ? null : command)}
              >{COMMAND_LABELS[command]}</button>)}
            </div>
            {snapshot && tab && <CommandMenu key={tab} snapshot={snapshot} tab={tab} onClose={closeCommandMenu} onPlace={chooseStructure} />}
          </div>
          <div className="selection-bar">
            <span className="selected-label">CURRENT SELECTION</span>
            <strong>{snapshot?.selected ?? 'Establishing command link...'}</strong>
            {snapshot?.workerSelected && <span className="selection-note">Right-click a deposit to gather.</span>}
            {snapshot?.selectedType === 'unit' && snapshot.selectedIds.length > 0 && <button
              aria-pressed={snapshot.holdingPosition}
              title="Hold here. Combat units fire at visible enemies in range."
              onClick={() => action()?.toggleHoldPosition()}
            >HOLD POSITION</button>}
            {snapshot?.selectedType === 'building' && <button onClick={() => action()?.upgradeSelected()}>UPGRADE STRUCTURE</button>}
          </div>
        </div>
        {snapshot?.paused && <div className="status-overlay"><strong>OPERATION PAUSED</strong><button onClick={() => action()?.togglePause()}>RESUME OPERATION</button></div>}
        {snapshot && snapshot.status !== 'playing' && <div className="status-overlay end-screen">
          <strong>{snapshot.status === 'lost' ? 'COMMAND CENTER LOST' : snapshot.restoration.cureReady ? 'HUMANITY RESTORED' : 'MISSION COMPLETE'}</strong>
          <p>{snapshot.status === 'lost' ? 'Your command center was destroyed.' : snapshot.restoration.cureReady
            ? `All ${SURVIVOR_TARGET} survivors reached your settlement, and the infection cure is ready.` : 'Your operation is complete.'}</p>
          <button onClick={exit}>RETURN TO MAIN MENU</button>
        </div>}
        {help && <div className="help-overlay"><button className="close-help" onClick={() => setHelp(false)}>✕</button><h2>TACTICAL FIELD GUIDE</h2><p><b>Left click:</b> select unit or structure. Drag to select an army. Selected ranged units show their firing range.</p><p><b>Right click:</b> move selected units. Right-click an enemy to attack it.</p><p><b>WASD / arrow keys:</b> pan camera. <b>Mouse wheel:</b> zoom.</p><p><b>Construct:</b> open the bottom-center Construct menu, choose a building, then click a clear tile near your base.</p><p><b>Produce:</b> train workers at HQ, infantry at Barracks, and armor at the War Factory.</p><p><b>Gather:</b> select a worker and right-click metal, oil, or food. Workers haul resources back automatically.</p><p><b>Hold Position:</b> keep troops in cover to fire when enemies come into view.</p><p><b>Research:</b> build Research Institute or Vehicle Garage to unlock technology.</p><p><b>Minimap:</b> click to jump to another sector.</p><p><b>P:</b> pause. <b>ESC:</b> cancel placement. <b>Space:</b> center home.</p><p className="muted"><b>Survivors:</b> move an armed unit near a group, then lead them back to your command center. Build a powered farm and hospital and complete the infection cure to win.</p></div>}
        {confirmExit && <div className="dialog-backdrop"><div className="exit-dialog"><h3>RETURN TO MAIN MENU?</h3><p>Unsaved progress will be lost. Use SAVE before leaving if you want to continue this operation later.</p><div><button onClick={() => setConfirmExit(false)}>CANCEL</button><button onClick={exit}>LEAVE OPERATION</button></div></div></div>}
      </section>
    </div>
    <footer className="bottom-bar"><span>COMMAND LINK: <b>CONNECTED</b></span><span>ENEMY BASES: <strong>{snapshot?.raiderBases ?? 2}</strong> · INFECTED DETECTED: <strong>{snapshot?.zombieCount ?? 0}</strong></span><span>LEFT CLICK SELECT / DRAG GROUP · RIGHT CLICK COMMAND · WASD CAMERA · SCROLL ZOOM</span></footer>
  </div>;
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const newGame = (seed: string, save?: GameSave) => setSession({ id: Date.now(), seed, save });
  return session ? <Battlefield key={session.id} session={session} exit={() => setSession(null)} /> : <Menu onStart={seed => newGame(seed)} onContinue={() => { const save = getSave(); if (save) newGame(save.seed, save); }} />;
}
