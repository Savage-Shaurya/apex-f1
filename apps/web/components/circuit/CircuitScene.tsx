'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { gsap } from 'gsap';
import * as THREE from 'three';
import { circuitPoints, getCircuit } from '@/lib/circuits';

export interface SceneProgress {
  /** 0..1 lap-draw progress, written by the owning ScrollTrigger. */
  current: number;
}

const TUBE_SEGMENTS = 900;

function Track({ circuitId, progress, active, onReady, scale }: { circuitId: string; progress: SceneProgress; active: boolean; onReady?: (invalidate: () => void) => void; scale: number }) {
  const { advance, size } = useThree();
  const dirty = useRef(true);
  const elapsed = useRef(0);
  const invalidate = useCallback(() => { dirty.current = true; }, []);
  const group = useRef<THREE.Group>(null);
  const car = useRef<THREE.Group>(null);
  const lap = useRef(0);

  const built = useMemo(() => {
    const c = getCircuit(circuitId);
    if (!c) return null;
    const pts = circuitPoints(c, scale).map(([x, y]) => new THREE.Vector3(x, 0, y));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const base = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, 0.03, 6, true);
    const lit = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, 0.05, 8, true);
    const glow = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, 0.16, 8, true);
    return { curve, base, lit, glow };
  }, [circuitId, scale]);

  useEffect(() => {
    onReady?.(invalidate);
    invalidate();
    return () => onReady?.(() => {});
  }, [onReady, invalidate]);

  // Share ScrollTrigger's clock (GSAP's ticker); never start an independent R3F loop.
  useEffect(() => {
    if (!active || !built) return;
    dirty.current = true;
    let previous: number | null = null;
    const draw = (time: number) => {
      if (document.hidden) { previous = null; return; }
      const delta = previous === null ? 0 : Math.min(Math.max(time - previous, 0), 0.05);
      previous = time;
      if (!dirty.current && progress.current < 0.999) return;
      dirty.current = false;
      elapsed.current += delta;
      advance(elapsed.current, false);
    };
    gsap.ticker.add(draw);
    return () => { gsap.ticker.remove(draw); };
  }, [active, advance, built, progress, size.width, size.height]);

  useEffect(() => () => {
    built?.base.dispose();
    built?.lit.dispose();
    built?.glow.dispose();
  }, [built]);

  useFrame((_state, delta) => {
    if (!built || !group.current || !car.current) return;
    const p = Math.max(0, Math.min(1, progress.current));
    const count = (n: THREE.BufferGeometry) => Math.floor((n.index?.count ?? 0) * p);
    built.lit.setDrawRange(0, count(built.lit));
    built.glow.setDrawRange(0, count(built.glow));
    group.current.rotation.y = -0.55 + p * 0.9;
    group.current.rotation.x = 0.1 - p * 0.08;

    // Once the lap is drawn, the light keeps circulating while in view.
    let t = p;
    if (p >= 0.999) {
      lap.current = (lap.current + delta / 11) % 1;
      t = lap.current;
    } else {
      lap.current = 0;
    }
    const pos = built.curve.getPointAt(t);
    car.current.position.copy(pos);
    car.current.visible = p > 0.002;
  });

  if (!built) return null;
  return (
    <group ref={group}>
      <mesh geometry={built.base}>
        <meshBasicMaterial color="#3a3a42" />
      </mesh>
      <mesh geometry={built.glow}>
        <meshBasicMaterial color="#e10600" transparent opacity={0.13} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh geometry={built.lit}>
        <meshBasicMaterial color="#ff2418" toneMapped={false} />
      </mesh>
      <group ref={car}>
        <mesh>
          <sphereGeometry args={[0.09, 20, 20]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.3, 20, 20]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <gridHelper args={[20, 40, '#232328', '#161619']} position={[0, -0.1, 0]} />
    </group>
  );
}

/**
 * The next-race circuit as a lit 3D ribbon. Geometry is the real outline
 * (bacinger/f1-circuits). GSAP advances frames only when the
 * scroll progress changes, continuously only for the lap light while in
 * view, and never while off screen.
 */
export default function CircuitScene({ circuitId, progress, onReady, className, scale = 6.4 }: { circuitId: string; progress: SceneProgress; onReady?: (invalidate: () => void) => void; className?: string; /** Track size in scene units (default 6.4 fits a square stage). */ scale?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      setInView(Boolean(e?.isIntersecting && e.intersectionRect.width > 0 && e.intersectionRect.height > 0));
      setPageVisible(!document.hidden);
    });
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    io.observe(el);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  return (
    <div ref={host} className={className} aria-hidden="true">
      <Canvas
        frameloop="never"
        dpr={[1, 2]}
        camera={{ position: [0, 9.5, 9.5], fov: 34, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ camera }) => camera.lookAt(0, -0.4, 0)}
      >
        <Track circuitId={circuitId} progress={progress} active={inView && pageVisible} onReady={onReady} scale={scale} />
      </Canvas>
    </div>
  );
}
