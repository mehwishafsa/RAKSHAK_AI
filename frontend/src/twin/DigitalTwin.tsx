import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ContactShadows, Environment, Grid, Lightformer, OrbitControls } from "@react-three/drei";
import type { ComponentId, TelemetryFrame } from "../types";
import { ConveyorDrive, type LiveState } from "./ConveyorDrive";
import { componentTones, shakeAmplitude } from "./health";

interface Props {
  frame: TelemetryFrame | null;
  reducedMotion: boolean;
  theme: "dark" | "light";
}

const TARGET = new THREE.Vector3(0.4, 0.8, -0.6);
const VIEW_DIR = new THREE.Vector3(5.4, 3.4, 7.2);

/** Back the camera off on narrow viewports so the whole drive stays in frame. Runs on resize only. */
function CameraRig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const scale = THREE.MathUtils.clamp(1.55 / aspect, 0.9, 1.9);
    camera.position.copy(TARGET).add(VIEW_DIR.clone().multiplyScalar(scale));
    camera.lookAt(TARGET);
  }, [camera, size.width, size.height]);
  return null;
}

export default function DigitalTwin({ frame, reducedMotion, theme }: Props) {
  const tones = useMemo(() => componentTones(frame), [frame]);
  const labels = useMemo(() => {
    const out: Partial<Record<ComponentId, string>> = {};
    (Object.keys(tones) as ComponentId[]).forEach((id) => {
      if (tones[id] === "crit") out[id] = "CRITICAL";
      else if (tones[id] === "warn") out[id] = "WARNING";
      else if (tones[id] === "maint") out[id] = "LOTO · REPAIR";
    });
    return out;
  }, [tones]);

  const live = useRef<LiveState>({
    rpm: 1480,
    pressure: 3,
    oilQuality: 92,
    shake: 0,
    tones,
    reducedMotion,
  });

  useEffect(() => {
    live.current = {
      rpm: frame?.machine.rpm ?? 0,
      pressure: frame?.readings.pressure ?? 0,
      oilQuality: frame?.readings.oil_quality ?? 92,
      shake: shakeAmplitude(frame, reducedMotion),
      tones,
      reducedMotion,
    };
  }, [frame, tones, reducedMotion]);

  const dark = theme === "dark";

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [5.8, 4.2, 6.6], fov: 36 }}
      gl={{ antialias: true, alpha: true }}
      aria-label="3D digital twin of conveyor drive CD-07"
      role="img"
    >
      <hemisphereLight args={[dark ? "#9fc6ff" : "#ffffff", dark ? "#0b0f14" : "#c9d2dc", dark ? 0.55 : 0.9]} />
      <directionalLight
        position={[6, 9, 5]}
        intensity={dark ? 1.6 : 2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
      />
      <directionalLight position={[-6, 3, -4]} intensity={0.7} color={dark ? "#2dd4bf" : "#9cc"} />

      {/* Procedural studio environment for metal reflections — no HDR download needed. */}
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2.2} position={[0, 5, -4]} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-5, 2, 2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} color="#8ecfff" />
        <Lightformer form="rect" intensity={0.8} position={[5, 1, 3]} rotation-y={-Math.PI / 2} scale={[6, 1, 1]} />
      </Environment>

      <CameraRig />
      <ConveyorDrive live={live} tones={tones} labels={labels} />

      <ContactShadows position={[0, 0.005, 0]} opacity={dark ? 0.6 : 0.35} scale={16} blur={2.2} far={3} />
      <Grid
        position={[0, 0, 0]}
        args={[30, 30]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor={dark ? "#1b2633" : "#c3ccd6"}
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor={dark ? "#24506a" : "#93a6b8"}
        fadeDistance={22}
        fadeStrength={1.4}
        infiniteGrid
      />
      <OrbitControls
        makeDefault
        target={TARGET.toArray()}
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={16}
        maxPolarAngle={Math.PI * 0.47}
        enablePan={false}
      />
    </Canvas>
  );
}
