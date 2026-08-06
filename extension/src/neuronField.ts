import * as THREE from 'three';

/**
 * Ultron-orb-style loading animation: several tilted rings of "neurons" tumbling
 * around a glowing core, with synapse lines that flash between neurons —
 * both within a ring (cheap: inherits the ring's own rotation via the scene
 * graph) and jumping across rings (computed per-frame from world matrices,
 * kept to a small pool since that's the only per-frame CPU work).
 */

interface RingSynapseCandidate {
  ringA: THREE.Group;
  idxA: number;
  ringB: THREE.Group;
  idxB: number;
}

interface ActiveFire {
  candidate: RingSynapseCandidate;
  start: number;
  duration: number;
}

const CYAN = new THREE.Color(0x35e2ff);
const WHITE = new THREE.Color(0xf3fbff);
const AMBER = new THREE.Color(0xffb454);

function makeGlowSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(120,235,255,0.9)');
  gradient.addColorStop(1, 'rgba(53,226,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class NeuronField {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rings: THREE.Group[] = [];
  private ringLocalPositions: THREE.Vector3[][] = [];
  private synapseCandidates: RingSynapseCandidate[] = [];
  private fires: ActiveFire[] = [];
  private fireLines: THREE.LineSegments;
  private core!: THREE.Mesh;
  private root = new THREE.Group();
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private clock = new THREE.Clock();
  private readonly maxFires = 28;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.set(0, 30, 260);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.root);

    this.buildRings();
    this.buildCore();
    this.fireLines = this.buildFireLinePool();
    this.scene.add(this.fireLines);

    container.appendChild(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();
  }

  private buildRings() {
    const ringConfigs = [
      { count: 46, radius: 150, tiltX: 0.15, tiltZ: 0.05, speed: 0.09 },
      { count: 38, radius: 118, tiltX: 1.05, tiltZ: 0.3, speed: -0.14 },
      { count: 34, radius: 92, tiltX: 0.55, tiltZ: 1.4, speed: 0.2 },
      { count: 26, radius: 62, tiltX: 1.4, tiltZ: 0.9, speed: -0.27 }
    ];

    const sprite = makeGlowSprite();

    for (const cfg of ringConfigs) {
      const group = new THREE.Group();
      group.rotation.x = cfg.tiltX;
      group.rotation.z = cfg.tiltZ;
      (group as any).userData.speed = cfg.speed;

      const positions = new Float32Array(cfg.count * 3);
      const localPositions: THREE.Vector3[] = [];
      for (let i = 0; i < cfg.count; i++) {
        const angle = (i / cfg.count) * Math.PI * 2;
        const jitter = (Math.random() - 0.5) * cfg.radius * 0.06;
        const x = Math.cos(angle) * (cfg.radius + jitter);
        const y = Math.sin(angle) * (cfg.radius + jitter);
        const z = (Math.random() - 0.5) * cfg.radius * 0.08;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        localPositions.push(new THREE.Vector3(x, y, z));
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 5.5,
        map: sprite,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: CYAN
      });
      const points = new THREE.Points(geometry, material);
      group.add(points);

      // Faint static ring-neighbor connections — inherit the ring's rotation for free.
      const lineSegs: number[] = [];
      for (let i = 0; i < cfg.count; i++) {
        const a = localPositions[i];
        const b = localPositions[(i + 1) % cfg.count];
        lineSegs.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineSegs), 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending
      });
      group.add(new THREE.LineSegments(lineGeo, lineMat));

      this.root.add(group);
      this.rings.push(group);
      this.ringLocalPositions.push(localPositions);
    }

    // Precompute candidate cross-ring synapse pairs for the flashing effect.
    for (let r = 0; r < this.rings.length - 1; r++) {
      const a = this.ringLocalPositions[r];
      const b = this.ringLocalPositions[r + 1];
      for (let i = 0; i < 14; i++) {
        this.synapseCandidates.push({
          ringA: this.rings[r],
          idxA: Math.floor(Math.random() * a.length),
          ringB: this.rings[r + 1],
          idxB: Math.floor(Math.random() * b.length)
        });
      }
    }
  }

  private buildCore() {
    const geometry = new THREE.IcosahedronGeometry(20, 1);
    const material = new THREE.MeshBasicMaterial({
      color: WHITE,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });
    this.core = new THREE.Mesh(geometry, material);
    this.root.add(this.core);

    const glowGeo = new THREE.IcosahedronGeometry(14, 1);
    const glowMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending
    });
    this.root.add(new THREE.Mesh(glowGeo, glowMat));
  }

  private buildFireLinePool(): THREE.LineSegments {
    const positions = new Float32Array(this.maxFires * 2 * 3);
    const colors = new Float32Array(this.maxFires * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    return new THREE.LineSegments(geometry, material);
  }

  private maybeSpawnFire(now: number) {
    if (this.fires.length >= this.maxFires) return;
    if (Math.random() > 0.55) return;
    const candidate = this.synapseCandidates[Math.floor(Math.random() * this.synapseCandidates.length)];
    this.fires.push({ candidate, start: now, duration: 380 + Math.random() * 420 });
  }

  private updateFireLines(now: number) {
    this.fires = this.fires.filter((f) => now - f.start < f.duration);
    this.maybeSpawnFire(now);

    const posAttr = this.fireLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = this.fireLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const flash = new THREE.Color();

    this.fires.forEach((fire, i) => {
      const { ringA, idxA, ringB, idxB } = fire.candidate;
      tmpA.copy(this.ringLocalPositions[this.rings.indexOf(ringA)][idxA]);
      tmpB.copy(this.ringLocalPositions[this.rings.indexOf(ringB)][idxB]);
      ringA.localToWorld(tmpA);
      ringB.localToWorld(tmpB);
      this.root.worldToLocal(tmpA);
      this.root.worldToLocal(tmpB);

      const t = (now - fire.start) / fire.duration;
      const brightness = Math.sin(Math.min(t, 1) * Math.PI); // ease in/out flash
      flash.copy(t < 0.5 ? WHITE : CYAN).lerp(AMBER, 0.15).multiplyScalar(brightness);

      posAttr.setXYZ(i * 2, tmpA.x, tmpA.y, tmpA.z);
      posAttr.setXYZ(i * 2 + 1, tmpB.x, tmpB.y, tmpB.z);
      colorAttr.setXYZ(i * 2, flash.r, flash.g, flash.b);
      colorAttr.setXYZ(i * 2 + 1, flash.r, flash.g, flash.b);
    });

    this.fireLines.geometry.setDrawRange(0, this.fires.length * 2);
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  private handleResize() {
    const { clientWidth, clientHeight } = this.container;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private animate = () => {
    this.rafId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    for (const ring of this.rings) {
      ring.rotation.z += (ring as any).userData.speed * delta;
    }
    this.root.rotation.y += delta * 0.06;
    this.core.rotation.y += delta * 0.4;
    this.core.rotation.x += delta * 0.15;
    const pulse = 1 + Math.sin(elapsed * 2.4) * 0.06;
    this.core.scale.setScalar(pulse);

    this.updateFireLines(performance.now());
    this.renderer.render(this.scene, this.camera);
  };

  start() {
    if (this.rafId === null) {
      this.clock.start();
      this.animate();
    }
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      const material = (obj as THREE.Mesh).material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) (material as THREE.Material).dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
