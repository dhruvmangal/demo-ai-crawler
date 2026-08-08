import * as THREE from 'three';

/**
 * Wireframe-globe loading animation: a slowly spinning latitude/longitude
 * wireframe planet wrapped in a faint atmosphere glow, with glowing surface
 * nodes and arced "network" links between them that pulse in and out, plus a
 * couple of satellites tracing tilted orbits around it.
 *
 * The nodes and arcs are parented to the globe group so they inherit its spin
 * for free — the only per-frame work is rotation and opacity pulsing, no
 * per-frame world-matrix math.
 *
 * Public API (used by sidepanel.ts) is unchanged: `new NeuronField(mount)`,
 * `.start()`, `.stop()`, `.dispose()`.
 */

const CYAN = new THREE.Color(0x35e2ff);
const WHITE = new THREE.Color(0xf3fbff);
const AMBER = new THREE.Color(0xffb454);

const GLOBE_RADIUS = 88;

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

interface PulseArc {
  material: THREE.LineBasicMaterial;
  phase: number;
  speed: number;
}

export class NeuronField {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private globe = new THREE.Group();
  private orbits: THREE.Group[] = [];
  private arcs: PulseArc[] = [];
  private atmosphere!: THREE.Mesh;
  private glowTexture: THREE.Texture;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.set(0, 24, 300);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.root);

    this.glowTexture = makeGlowSprite();
    this.buildGlobe();
    this.buildOrbits();

    container.appendChild(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();
  }

  /** Evenly-distributed points on the globe surface via a Fibonacci sphere. */
  private surfacePoints(count: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      pts.push(
        new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(GLOBE_RADIUS)
      );
    }
    return pts;
  }

  private buildGlobe() {
    // Latitude/longitude wireframe shell — the "planet".
    const wireGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 24, 16);
    const wireMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.globe.add(new THREE.Mesh(wireGeo, wireMat));

    // Faint back-side atmosphere shell, gently pulsed in animate().
    const atmoGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.05, 24, 16);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    });
    this.atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
    this.globe.add(this.atmosphere);

    // Glowing surface nodes.
    const nodes = this.surfacePoints(64);
    const nodePositions = new Float32Array(nodes.length * 3);
    nodes.forEach((p, i) => {
      nodePositions[i * 3] = p.x;
      nodePositions[i * 3 + 1] = p.y;
      nodePositions[i * 3 + 2] = p.z;
    });
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    const nodeMat = new THREE.PointsMaterial({
      size: 5,
      map: this.glowTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: CYAN
    });
    this.globe.add(new THREE.Points(nodeGeo, nodeMat));

    // Arced network links between random node pairs, lifted off the surface so
    // they read as great-circle connections rather than chords through the globe.
    const arcCount = 24;
    for (let k = 0; k < arcCount; k++) {
      const a = nodes[Math.floor(Math.random() * nodes.length)];
      const b = nodes[Math.floor(Math.random() * nodes.length)];
      if (a === b) continue;
      const mid = a
        .clone()
        .add(b)
        .multiplyScalar(0.5)
        .normalize()
        .multiplyScalar(GLOBE_RADIUS * (1.16 + Math.random() * 0.24));
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
      const arcGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
      const arcMat = new THREE.LineBasicMaterial({
        color: Math.random() < 0.28 ? AMBER : CYAN,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      this.globe.add(new THREE.Line(arcGeo, arcMat));
      this.arcs.push({ material: arcMat, phase: Math.random() * Math.PI * 2, speed: 0.8 + Math.random() * 1.6 });
    }

    this.root.add(this.globe);
  }

  private buildOrbits() {
    const configs = [
      { radius: 132, tiltX: 1.2, tiltZ: 0.2, speed: 0.35, sats: 2, color: WHITE },
      { radius: 158, tiltX: 0.4, tiltZ: 1.1, speed: -0.24, sats: 1, color: AMBER }
    ];

    for (const cfg of configs) {
      const group = new THREE.Group();
      group.rotation.x = cfg.tiltX;
      group.rotation.z = cfg.tiltZ;
      (group as any).userData.speed = cfg.speed;

      // Faint orbit ring.
      const segs = 96;
      const ringPos = new Float32Array((segs + 1) * 3);
      for (let i = 0; i <= segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        ringPos[i * 3] = Math.cos(ang) * cfg.radius;
        ringPos[i * 3 + 1] = Math.sin(ang) * cfg.radius;
        ringPos[i * 3 + 2] = 0;
      }
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
      const ringMat = new THREE.LineBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      group.add(new THREE.Line(ringGeo, ringMat));

      // Satellite glow nodes riding the ring.
      const satPos = new Float32Array(cfg.sats * 3);
      for (let i = 0; i < cfg.sats; i++) {
        const ang = Math.random() * Math.PI * 2;
        satPos[i * 3] = Math.cos(ang) * cfg.radius;
        satPos[i * 3 + 1] = Math.sin(ang) * cfg.radius;
        satPos[i * 3 + 2] = 0;
      }
      const satGeo = new THREE.BufferGeometry();
      satGeo.setAttribute('position', new THREE.BufferAttribute(satPos, 3));
      const satMat = new THREE.PointsMaterial({
        size: 7.5,
        map: this.glowTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: cfg.color
      });
      group.add(new THREE.Points(satGeo, satMat));

      this.root.add(group);
      this.orbits.push(group);
    }
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

    this.globe.rotation.y += delta * 0.18;
    this.root.rotation.x = Math.sin(elapsed * 0.15) * 0.08; // gentle bob

    for (const orbit of this.orbits) {
      orbit.rotation.z += (orbit as any).userData.speed * delta;
    }

    const pulse = 1 + Math.sin(elapsed * 1.6) * 0.03;
    this.atmosphere.scale.setScalar(pulse);

    for (const arc of this.arcs) {
      const v = Math.sin(elapsed * arc.speed + arc.phase);
      arc.material.opacity = 0.08 + Math.max(0, v) * 0.5;
    }

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
    this.glowTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
