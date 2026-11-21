import * as T from 'three';
import {GLTFLoader} from './s02/vendor/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from './s02/vendor/examples/jsm/controls/OrbitControls.js';

function disposeModel(model) {
  const geometries = new Set();
  const materials = new Set();
  model.traverse(mesh => {
    if (!mesh.isMesh && !mesh.isLine) return;
    geometries.add(mesh.geometry);
    for (const material of [mesh.material].flat()) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export class LineViewer {
  constructor(host, onPick) {
    this.host = host;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0xe8eee6);
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, .001, 30);
    this.renderer = new T.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.surface = this.renderer.domElement;
    this.surface.setAttribute('aria-label', '工作站三维模型');
    host.append(this.surface);
    this.controls = new OrbitControls(this.camera, this.surface);
    this.controls.minZoom = .3;
    this.controls.maxZoom = 24;
    this.controls.addEventListener('change', () => this.draw());
    this.scene.add(new T.HemisphereLight(0xfffbeb, 0xb5c5c5, 1.9));
    for (const [position, intensity] of [[[2, 4, 1], 2.15], [[-3, 1, -2], 1.05]]) {
      const light = new T.DirectionalLight(0xffffff, intensity);
      light.position.set(...position);
      this.scene.add(light);
    }
    this.objects = new Map();
    this.original = new Map();
    this.loader = new GLTFLoader();
    this.highlightMaterial = new T.MeshStandardMaterial({
      color:0xff972e, emissive:0x65370d, roughness:.72, side:T.DoubleSide
    });
    this.baseSize = new T.Vector2(2, 2);
    this.bindPicking(onPick);
    new ResizeObserver(() => this.resize()).observe(host);
  }

  draw() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const {clientWidth:width, clientHeight:height} = this.host;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    const ratio = width/height;
    const frame = Math.max(this.baseSize.y, this.baseSize.x/ratio);
    this.camera.left = -frame*ratio/2;
    this.camera.right = -this.camera.left;
    this.camera.top = frame/2;
    this.camera.bottom = -this.camera.top;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  async readModel(url, signal) {
    const response = await fetch(url, {signal});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (signal.aborted) return false;
    const gltf = await this.loader.parseAsync(bytes, new URL('.', url).href);
    if (signal.aborted) {
      disposeModel(gltf.scene);
      return false;
    }
    return gltf.scene;
  }

  register(group) {
    group.traverse(node => {
      const key = node.userData.stationId || node.userData.sourcePath;
      if (key) this.objects.set(key, node);
      if (node.isMesh) for (const material of [node.material].flat()) {
        if (material.isMeshStandardMaterial) material.metalness = Math.min(material.metalness, .22);
      }
    });
  }

  async load(url, signal) {
    const model = await this.readModel(url,signal);
    if (!model || signal.aborted) return false;
    this.model = model;
    this.register(model);
    this.scene.add(this.model);
    return true;
  }

  async loadContext(url,signal,paths) {
    const model = await this.readModel(url,signal);
    if (!model || signal.aborted) return null;
    const parts = new Map();
    model.traverse(node=>{
      if (paths.includes(node.userData.sourcePath)) parts.set(node.userData.sourcePath,node);
    });
    if (parts.size!==paths.length) {
      disposeModel(model);
      throw Error('相邻工位模型缺少搬运部件');
    }
    const context = new T.Group();
    for (const part of parts.values()) context.attach(part);
    this.model.add(context);
    this.register(context);
    return context;
  }

  clear() {
    if (!this.model) return;
    this.highlight();
    this.scene.remove(this.model);
    disposeModel(this.model);
    this.model = null;
    this.objects.clear();
    this.draw();
  }

  highlight(key) {
    for (const [mesh, material] of this.original) mesh.material = material;
    this.original.clear();
    this.objects.get(key)?.traverse(node => {
      if (!node.isMesh) return;
      this.original.set(node, node.material);
      node.material = this.highlightMaterial;
    });
    this.draw();
  }

  setVisibility({visible, isolated, hidden}) {
    const allowed = isolated && new Set();
    function include(node, set) {
      node.traverse(child => set.add(child));
      for (let parent = node.parent; parent; parent = parent.parent) set.add(parent);
    }
    if (isolated) include(isolated, allowed);
    for (const root of this.model.children) {
      root.traverse(node => {
        node.visible = !node.userData.stationHidden && (!allowed || allowed.has(node)) && !hidden?.has(node.userData.sourcePath);
      });
      root.visible &&= !visible || visible.has(root);
    }
    this.draw();
  }

  frame({visible, isolated, hidden, target, direction, padding}) {
    this.setVisibility({visible, isolated, hidden});
    const bounds = new T.Box3();
    for (const node of this.model.children) {
      if (node.visible) bounds.expandByObject(node);
    }
    const box = target || bounds;
    const center = box.getCenter(new T.Vector3());
    this.camera.position.copy(center).addScaledVector(new T.Vector3(...direction).normalize(), 7);
    this.camera.zoom = 1;
    this.controls.target.copy(center);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    const projected = new T.Box3();
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z])
          projected.expandByPoint(new T.Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse));
    const size = projected.getSize(new T.Vector3());
    this.baseSize.set(size.x*padding, size.y*padding);
    this.controls.update();
    this.resize();
  }

  bindPicking(onPick) {
    const ray = new T.Raycaster();
    const pointers = new Set();
    let start;
    this.surface.addEventListener('pointerdown', event => {
      pointers.add(event.pointerId);
      start = pointers.size===1 && event.button===0 ? [event.clientX, event.clientY] : null;
    });
    this.surface.addEventListener('pointercancel', event => {
      pointers.delete(event.pointerId);
      start = null;
    });
    this.surface.addEventListener('pointerup', event => {
      pointers.delete(event.pointerId);
      const from = start;
      start = null;
      if (!this.model || !from || Math.hypot(event.clientX-from[0], event.clientY-from[1])>5) return;
      const rect = this.surface.getBoundingClientRect();
      const point = new T.Vector2((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2);
      ray.setFromCamera(point, this.camera);
      const visible = this.model.children.filter(node => node.visible);
      const node = ray.intersectObjects(visible, true).find(hit => {
        for (let object = hit.object; object; object = object.parent) {
          if (!object.visible) return false;
        }
        return true;
      })?.object;
      onPick(node);
    });
  }
}
