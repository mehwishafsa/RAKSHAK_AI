import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { ComponentId } from "../types";
import { COMPONENT_TAGS, GEAR_RATIO, type Tone } from "./health";

export interface LiveState {
  rpm: number;
  pressure: number;
  oilQuality: number;
  shake: number;
  tones: Record<ComponentId, Tone>;
  reducedMotion: boolean;
}

const TONE_COLOR: Record<Exclude<Tone, "none">, THREE.Color> = {
  warn: new THREE.Color("#fab219"),
  crit: new THREE.Color("#ff3b3b"),
  maint: new THREE.Color("#60a5fa"),
};

const SHAFT_Y = 0.95;
const MOTOR_SPEED_SCALE = Math.PI * 1.6; // rad/s at nominal rpm (visually slowed)

const LABEL_OFFSET: Record<ComponentId, [number, number, number]> = {
  motor: [-0.2, 1.0, 0],
  gearbox: [0, 1.05, -0.3],
  bearing_3: [0.15, 0.75, 0.2],
  lube_system: [0.1, 1.05, 0.35],
};

export const ANCHORS: Record<ComponentId, [number, number, number]> = {
  motor: [-2.7, SHAFT_Y, 0],
  gearbox: [-0.45, SHAFT_Y, 0],
  bearing_3: [0.75, SHAFT_Y, 0],
  lube_system: [-0.3, 0.9, 1.05],
};

function paint(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55, ...opts });
}

/** Procedural conveyor drive: motor -> coupling -> gearbox -> bearing #3 -> drive pulley -> bearing #4. */
export function ConveyorDrive({
  live,
  tones,
  labels,
}: {
  live: MutableRefObject<LiveState>;
  tones: Record<ComponentId, Tone>;
  labels: Partial<Record<ComponentId, string>>;
}) {
  const root = useRef<THREE.Group>(null);
  const motorRotor = useRef<THREE.Group>(null);
  const outputShaft = useRef<THREE.Group>(null);
  const needle = useRef<THREE.Mesh>(null);
  const cleats = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const alertLight = useRef<THREE.PointLight>(null);
  const t = useRef(0);
  const beltTravel = useRef(0);

  const mats = useMemo(
    () => ({
      motor: [paint("#2c6a9a", { metalness: 0.45, roughness: 0.42 }), paint("#24577f")],
      gearbox: [paint("#46525f", { roughness: 0.5 }), paint("#3a4552")],
      bearing_3: [paint("#5b6774", { metalness: 0.6, roughness: 0.35 })],
      lube_system: [paint("#9a7a26", { roughness: 0.45 }), paint("#b8743a", { metalness: 0.8, roughness: 0.3 })],
      steel: paint("#9aa5b1", { metalness: 0.9, roughness: 0.25 }),
      darkSteel: paint("#30373f", { metalness: 0.7, roughness: 0.45 }),
      skid: paint("#1f262e", { metalness: 0.5, roughness: 0.7 }),
      hazard: paint("#e0a100", { roughness: 0.6 }),
      rubber: paint("#16191d", { metalness: 0.05, roughness: 0.9 }),
      guard: paint("#f59e0b", { transparent: true, opacity: 0.32, metalness: 0.2, roughness: 0.6, side: THREE.DoubleSide }),
      gaugeFace: paint("#eef2f5", { metalness: 0, roughness: 0.4 }),
      needle: paint("#d22", { metalness: 0, roughness: 0.4 }),
      sightGlass: new THREE.MeshStandardMaterial({ color: "#d4a017", emissive: "#d4a017", emissiveIntensity: 0.35, roughness: 0.15 }),
      ore: paint("#6b5b4b", { metalness: 0.05, roughness: 0.95 }),
      bearing4: paint("#5b6774", { metalness: 0.6, roughness: 0.35 }),
    }),
    [],
  );

  const pipeGeometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.3, 1.1, 1.05),
      new THREE.Vector3(-0.3, 1.32, 1.02),
      new THREE.Vector3(-0.3, 1.36, 0.8),
      new THREE.Vector3(-0.3, 1.3, 0.62),
    ]);
    return new THREE.TubeGeometry(curve, 32, 0.035, 10, false);
  }, []);

  const oreLumps = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        x: (((i * 37) % 9) / 9 - 0.5) * 0.8,
        z0: (i / 18) * 6,
        s: 0.07 + ((i * 13) % 5) * 0.015,
        r: i * 1.7,
      })),
    [],
  );

  useFrame((_, delta) => {
    const L = live.current;
    const dt = Math.min(delta, 0.1);
    t.current += dt;
    const omega = (L.rpm / 1480) * MOTOR_SPEED_SCALE;
    if (motorRotor.current) motorRotor.current.rotation.x += omega * dt;
    if (outputShaft.current) outputShaft.current.rotation.x += (omega / GEAR_RATIO) * dt;
    // Belt travel = drum surface speed (r = 0.6).
    beltTravel.current = (beltTravel.current + (omega / GEAR_RATIO) * 0.6 * dt) % 6;
    if (cleats.current) {
      cleats.current.children.forEach((c, i) => {
        // Material travels toward the head (drive) pulley at z = 0.
        const z = -(6 - ((Number(c.userData.z0 ?? i * 0.6) + beltTravel.current) % 6));
        c.position.z = z;
        c.visible = z < -0.45 && z > -5.9;
      });
    }

    // Lube-oil pressure gauge: 0..4 bar over 270 degrees.
    if (needle.current) {
      const target = Math.PI * 0.75 - (Math.min(4, Math.max(0, L.pressure)) / 4) * Math.PI * 1.5;
      needle.current.rotation.z = THREE.MathUtils.lerp(needle.current.rotation.z, target, 0.2);
    }
    // Oil sight glass darkens as oil quality drops.
    const q = Math.min(1, Math.max(0, (L.oilQuality - 40) / 55));
    mats.sightGlass.color.setRGB(0.35 + 0.48 * q, 0.2 + 0.43 * q, 0.05 + 0.04 * q);
    mats.sightGlass.emissive.copy(mats.sightGlass.color);

    // Fault highlight: emissive glow on the affected component's materials.
    const pulse = L.reducedMotion ? 0.75 : 0.5 + 0.5 * Math.sin(t.current * 6.5);
    let alertAnchor: [number, number, number] | null = null;
    let alertTone = "none" as Tone;
    for (const id of Object.keys(L.tones) as ComponentId[]) {
      const tone = L.tones[id];
      const target = tone === "crit" ? 0.35 + 0.75 * pulse : tone === "warn" ? 0.55 : tone === "maint" ? 0.45 : 0;
      for (const m of mats[id]) {
        if (tone !== "none") m.emissive.copy(TONE_COLOR[tone]);
        m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, target, 0.18);
        if (tone === "none" && m.emissiveIntensity < 0.01) m.emissive.setRGB(0, 0, 0);
      }
      if (tone !== "none" && (alertTone === "none" || tone === "crit")) {
        alertAnchor = ANCHORS[id];
        alertTone = tone;
      }
    }

    if (alertLight.current && halo.current) {
      const on = alertAnchor !== null;
      const anchor = alertAnchor ?? ANCHORS.bearing_3;
      alertLight.current.position.set(anchor[0], anchor[1] + 0.9, anchor[2] + 0.6);
      halo.current.position.set(anchor[0], 0.012, anchor[2]);
      if (on) {
        const color = TONE_COLOR[alertTone as Exclude<Tone, "none">];
        alertLight.current.color.copy(color);
        (halo.current.material as THREE.MeshBasicMaterial).color.copy(color);
      }
      const li = on ? (alertTone === "crit" ? 3 + 5 * pulse : 3) : 0;
      alertLight.current.intensity = THREE.MathUtils.lerp(alertLight.current.intensity, li, 0.2);
      const hm = halo.current.material as THREE.MeshBasicMaterial;
      hm.opacity = THREE.MathUtils.lerp(hm.opacity, on ? (alertTone === "crit" ? 0.25 + 0.35 * pulse : 0.35) : 0, 0.2);
      const s = on && alertTone === "crit" && !L.reducedMotion ? 1 + 0.12 * pulse : 1;
      halo.current.scale.setScalar(s);
    }

    // Vibration shake (amplitude computed from measured vibration + risk).
    if (root.current) {
      const a = L.shake;
      root.current.position.x = a ? (Math.random() - 0.5) * a : 0;
      root.current.position.y = a ? (Math.random() - 0.5) * a * 0.6 : 0;
      root.current.position.z = a ? (Math.random() - 0.5) * a : 0;
    }
  });

  const label = (id: ComponentId) => {
    const tone = tones[id];
    const extra = labels[id];
    return (
      <Html
        position={[ANCHORS[id][0] + LABEL_OFFSET[id][0], ANCHORS[id][1] + LABEL_OFFSET[id][1], ANCHORS[id][2] + LABEL_OFFSET[id][2]]}
        center
        distanceFactor={6}
        zIndexRange={[10, 0]}
      >
        <div
          data-tone={tone}
          className={`pointer-events-none whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold shadow-lg backdrop-blur ${
            tone === "crit"
              ? "border-crit/80 bg-crit/25 text-white"
              : tone === "warn"
                ? "border-warn/80 bg-warn/20 text-white"
                : tone === "maint"
                  ? "border-info/80 bg-info/25 text-white"
                  : "border-white/15 bg-black/45 text-white/80"
          }`}
        >
          {COMPONENT_TAGS[id]}
          {extra ? <span className="ml-1.5 font-bold">· {extra}</span> : null}
        </div>
      </Html>
    );
  };

  return (
    <group>
      <group ref={root}>
        {/* Base skid */}
        <mesh position={[0, 0.15, 0]} material={mats.skid} castShadow receiveShadow>
          <boxGeometry args={[7.6, 0.3, 2.6]} />
        </mesh>
        {[-1.32, 1.32].map((z) => (
          <mesh key={z} position={[0, 0.27, z]} material={mats.hazard}>
            <boxGeometry args={[7.6, 0.06, 0.04]} />
          </mesh>
        ))}

        {/* ---------------- Motor ---------------- */}
        <group position={ANCHORS.motor}>
          <mesh rotation={[0, 0, Math.PI / 2]} material={mats.motor[0]} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 1.6, 48]} />
          </mesh>
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return (
              <mesh key={i} position={[0, Math.sin(a) * 0.58, Math.cos(a) * 0.58]} rotation={[-a, 0, 0]} material={mats.motor[1]} castShadow>
                <boxGeometry args={[1.45, 0.025, 0.11]} />
              </mesh>
            );
          })}
          {/* fan cowl + grille */}
          <mesh position={[-0.98, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.motor[1]} castShadow>
            <cylinderGeometry args={[0.53, 0.56, 0.36, 40]} />
          </mesh>
          {[0.15, 0.28, 0.41].map((r) => (
            <mesh key={r} position={[-1.17, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.darkSteel}>
              <torusGeometry args={[r, 0.018, 8, 40]} />
            </mesh>
          ))}
          {/* end shield, terminal box, feet */}
          <mesh position={[0.85, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.motor[1]}>
            <cylinderGeometry args={[0.5, 0.55, 0.12, 40]} />
          </mesh>
          <mesh position={[0.1, 0.66, 0]} material={mats.motor[1]} castShadow>
            <boxGeometry args={[0.5, 0.26, 0.42]} />
          </mesh>
          {[-0.5, 0.5].map((x) => (
            <mesh key={x} position={[x, -0.48, 0]} material={mats.motor[1]} castShadow>
              <boxGeometry args={[0.28, 0.36, 1.05]} />
            </mesh>
          ))}
          {/* rotating motor shaft + coupling */}
          <group ref={motorRotor} position={[1.25, 0, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={mats.steel}>
              <cylinderGeometry args={[0.07, 0.07, 0.75, 20]} />
            </mesh>
            <mesh position={[0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.darkSteel} castShadow>
              <cylinderGeometry args={[0.17, 0.17, 0.26, 6]} />
            </mesh>
            {Array.from({ length: 6 }, (_, i) => {
              const a = (i / 6) * Math.PI * 2;
              return (
                <mesh key={i} position={[0.1, Math.sin(a) * 0.13, Math.cos(a) * 0.13]} rotation={[0, 0, Math.PI / 2]} material={mats.hazard}>
                  <cylinderGeometry args={[0.022, 0.022, 0.3, 8]} />
                </mesh>
              );
            })}
          </group>
          {/* coupling guard */}
          <mesh position={[1.35, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.guard}>
            <cylinderGeometry args={[0.3, 0.3, 0.55, 24, 1, true, 0, Math.PI]} />
          </mesh>
        </group>

        {/* ---------------- Gearbox ---------------- */}
        <group position={ANCHORS.gearbox}>
          <mesh material={mats.gearbox[0]} castShadow receiveShadow>
            <boxGeometry args={[1.3, 1.25, 1.2]} />
          </mesh>
          <mesh position={[0, 0.66, 0]} material={mats.gearbox[1]} castShadow>
            <boxGeometry args={[1.1, 0.08, 1.0]} />
          </mesh>
          <mesh position={[0.3, 0.78, 0]} material={mats.darkSteel}>
            <cylinderGeometry args={[0.06, 0.06, 0.16, 12]} />
          </mesh>
          {[-0.45, -0.15, 0.15, 0.45].map((x) => (
            <mesh key={x} position={[x, 0, 0.62]} material={mats.gearbox[1]} castShadow>
              <boxGeometry args={[0.05, 1.1, 0.06]} />
            </mesh>
          ))}
          {[-0.45, -0.15, 0.15, 0.45].map((x) => (
            <mesh key={`b${x}`} position={[x, 0, -0.62]} material={mats.gearbox[1]}>
              <boxGeometry args={[0.05, 1.1, 0.06]} />
            </mesh>
          ))}
          {/* oil sight glass (colour tracks oil-quality reading) */}
          <mesh position={[0.32, -0.32, 0.61]} rotation={[Math.PI / 2, 0, 0]} material={mats.sightGlass}>
            <cylinderGeometry args={[0.09, 0.09, 0.04, 24]} />
          </mesh>
          <mesh position={[0.32, -0.32, 0.6]} rotation={[0, 0, 0]} material={mats.darkSteel}>
            <torusGeometry args={[0.1, 0.018, 8, 24]} />
          </mesh>
        </group>

        {/* ---------------- Output shaft, pulley, bearings ---------------- */}
        <group ref={outputShaft} position={[0, SHAFT_Y, 0]}>
          <mesh position={[1.75, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.steel}>
            <cylinderGeometry args={[0.09, 0.09, 3.3, 20]} />
          </mesh>
          {/* drive pulley drum with lagging grooves */}
          <mesh position={[1.85, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.rubber} castShadow>
            <cylinderGeometry args={[0.6, 0.6, 1.2, 48]} />
          </mesh>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <mesh key={i} position={[1.85, Math.sin(a) * 0.605, Math.cos(a) * 0.605]} rotation={[-a, 0, 0]} material={mats.darkSteel}>
                <boxGeometry args={[1.18, 0.012, 0.05]} />
              </mesh>
            );
          })}
          {[1.24, 2.46].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.steel}>
              <cylinderGeometry args={[0.63, 0.63, 0.04, 48]} />
            </mesh>
          ))}
        </group>

        <PillowBlock x={ANCHORS.bearing_3[0]} material={mats.bearing_3[0]} bolts={mats.darkSteel} />
        <PillowBlock x={3.0} material={mats.bearing4} bolts={mats.darkSteel} />

        {/* ---------------- Lubrication system ---------------- */}
        <group>
          <mesh position={[-0.3, 0.72, 1.05]} material={mats.lube_system[0]} castShadow>
            <cylinderGeometry args={[0.24, 0.24, 0.8, 32]} />
          </mesh>
          <mesh position={[-0.3, 1.13, 1.05]} material={mats.darkSteel}>
            <cylinderGeometry args={[0.1, 0.12, 0.05, 20]} />
          </mesh>
          <mesh geometry={pipeGeometry} material={mats.lube_system[1]} />
          {/* pump */}
          <mesh position={[-0.85, 0.48, 1.0]} material={mats.lube_system[0]} castShadow>
            <boxGeometry args={[0.32, 0.3, 0.32]} />
          </mesh>
          <mesh position={[-0.85, 0.48, 1.0]} rotation={[0, 0, Math.PI / 2]} material={mats.darkSteel}>
            <cylinderGeometry args={[0.1, 0.1, 0.5, 16]} />
          </mesh>
          {/* pressure gauge: needle angle = live lube-oil pressure */}
          <group position={[-0.3, 1.5, 1.1]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.darkSteel}>
              <cylinderGeometry args={[0.15, 0.15, 0.06, 32]} />
            </mesh>
            <mesh position={[0, 0, 0.032]} rotation={[Math.PI / 2, 0, 0]} material={mats.gaugeFace}>
              <cylinderGeometry args={[0.13, 0.13, 0.005, 32]} />
            </mesh>
            <mesh ref={needle} position={[0, 0, 0.04]} material={mats.needle}>
              <boxGeometry args={[0.012, 0.22, 0.008]} />
            </mesh>
            <mesh position={[0, -0.16, 0]} material={mats.darkSteel}>
              <cylinderGeometry args={[0.02, 0.02, 0.15, 8]} />
            </mesh>
          </group>
        </group>

        {/* Alert light + floor halo under the faulted component */}
        <pointLight ref={alertLight} intensity={0} distance={4.5} decay={1.6} />
        <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <ringGeometry args={[0.9, 1.15, 64]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>

      {/* ---------------- Conveyor (not shaken: separate structure) ---------------- */}
      <group position={[1.85, 0, 0]}>
        <mesh position={[0, 1.575, -3.3]} material={mats.rubber} receiveShadow castShadow>
          <boxGeometry args={[1.12, 0.035, 5.4]} />
        </mesh>
        <mesh position={[0, 0.42, -3.6]} material={mats.rubber}>
          <boxGeometry args={[1.12, 0.03, 4.8]} />
        </mesh>
        {Array.from({ length: 5 }, (_, i) => (
          <group key={i} position={[0, 0, -1.4 - i * 1.1]}>
            <mesh position={[0, 1.49, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.steel}>
              <cylinderGeometry args={[0.07, 0.07, 1.2, 16]} />
            </mesh>
            {[-0.68, 0.68].map((x) => (
              <mesh key={x} position={[x, 0.74, 0]} material={mats.darkSteel} castShadow>
                <boxGeometry args={[0.07, 1.5, 0.07]} />
              </mesh>
            ))}
          </group>
        ))}
        <group ref={cleats} position={[0, 1.6, 0]}>
          {oreLumps.map((o, i) => (
            <mesh key={i} userData={{ z0: o.z0 }} position={[o.x, o.s * 0.6, -o.z0]} rotation={[o.r, o.r * 0.7, 0]} material={mats.ore} castShadow>
              <dodecahedronGeometry args={[o.s, 0]} />
            </mesh>
          ))}
        </group>
      </group>

      {label("motor")}
      {label("gearbox")}
      {label("bearing_3")}
      {label("lube_system")}
    </group>
  );
}

function PillowBlock({ x, material, bolts }: { x: number; material: THREE.Material; bolts: THREE.Material }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.36, 0]} material={material} castShadow>
        <boxGeometry args={[0.34, 0.12, 0.95]} />
      </mesh>
      <mesh position={[0, 0.62, 0]} material={material} castShadow>
        <boxGeometry args={[0.3, 0.42, 0.5]} />
      </mesh>
      <mesh position={[0, SHAFT_Y, 0]} rotation={[0, 0, Math.PI / 2]} material={material} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.32, 32]} />
      </mesh>
      <mesh position={[0, SHAFT_Y, 0]} rotation={[0, Math.PI / 2, 0]} material={bolts}>
        <torusGeometry args={[0.24, 0.02, 8, 32]} />
      </mesh>
      {[-0.36, 0.36].map((z) => (
        <mesh key={z} position={[0, 0.45, z]} material={bolts}>
          <cylinderGeometry args={[0.035, 0.035, 0.08, 10]} />
        </mesh>
      ))}
    </group>
  );
}
