import {Box3, BufferAttribute, Group, Mesh, Quaternion, Vector3} from 'three';

export function workpieceMould(sample) {
  sample.updateWorldMatrix(true,true);
  const bounds = new Box3().setFromObject(sample,true);
  const mould = new Group();
  mould.position.copy(bounds.getCenter(new Vector3())).setY(bounds.min.y);
  mould.updateMatrixWorld(true);
  mould.attach(sample);
  sample.traverse(node=>{delete node.userData.sourcePath;});
  return mould;
}

export function splitMotorShaft(motor, isShaftTriangle) {
  // The STEP export combines casing and shaft. Keep the casing triangles below
  // the shaft shoulder in place and move the original shaft faces as a child.
  const meshes = [];
  motor.traverse(node => { if (node.isMesh) meshes.push(node); });
  const shafts = [];
  const point = new Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true,false);
    const {geometry, material} = mesh;
    const pos = geometry.attributes.position;
    const vertex = index => point.fromBufferAttribute(pos,index).applyMatrix4(mesh.matrixWorld);
    const source = geometry.index.array;
    const housing = [], shaft = [];
    for (let i=0;i<source.length;i+=3) {
      const triangle = [source[i],source[i+1],source[i+2]];
      const exposed = isShaftTriangle(triangle,vertex);
      (exposed ? shaft : housing).push(...triangle);
    }
    if (!shaft.length) continue;
    const rotatingGeometry = geometry.clone();
    rotatingGeometry.setIndex(new BufferAttribute(new source.constructor(shaft),1));
    const rotating = new Mesh(rotatingGeometry,material);
    rotating.name = '电机输出轴';
    mesh.add(rotating);
    shafts.push(rotating);
    // Preserve attributes and replace the index on this installation's housing.
    mesh.geometry = geometry.clone();
    mesh.geometry.setIndex(new BufferAttribute(new source.constructor(housing),1));
    geometry.dispose();
  }
  if (!shafts.length) throw Error('无法从步进电机模型识别输出轴');
  return shafts;
}

export function bindRotation(node, center, worldAxis = new Vector3(0,1,0)) {
  node.parent.updateWorldMatrix(true,false);
  const pivot = node.parent.worldToLocal(center.clone());
  const axis = worldAxis.clone().transformDirection(node.parent.matrixWorld.clone().invert());
  const origin = node.position.clone().sub(pivot);
  const facing = node.quaternion.clone();
  const spin = new Quaternion();
  return radians => {
    spin.setFromAxisAngle(axis,radians);
    node.position.copy(origin).applyQuaternion(spin).add(pivot);
    node.quaternion.copy(facing).premultiply(spin);
  };
}

