import {BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3} from 'three';
import {bindRotation, splitMotorShaft} from './motion-geometry.js';

const y = .30752, driveZ = .02924, drivenZ = -.08535, radius = .012, side = driveZ-drivenZ;
const length = 2*side+2*Math.PI*radius;
const modulo = (a,b) => ((a%b)+b)%b;
const forward = new Vector3(1,0,0);
export const conveyorRadius = .010;
export const motorSpeed = 2*Math.PI; // 60 rpm from the CAD motor designation.

export function worldGroup(parent) {
  parent.updateWorldMatrix(true,false);
  const group = new Group();
  group.matrix.copy(parent.matrixWorld).invert();
  group.matrixAutoUpdate = false;
  parent.add(group);
  return group;
}

function beltPoint(offset) {
  let s = modulo(offset,length);
  if (s<side) return [y+radius, driveZ-s, 0];
  s-=side;
  if (s<Math.PI*radius) {
    const a=s/radius;
    return [y+radius*Math.cos(a),drivenZ-radius*Math.sin(a),a];
  }
  s-=Math.PI*radius;
  if (s<side) return [y-radius,drivenZ+s,Math.PI];
  const a=Math.PI+(s-side)/radius;
  return [y+radius*Math.cos(a),driveZ-radius*Math.sin(a),a];
}

function timingBelt(parent) {
  const vertices = [], indices = [];
  const count=80;
  for (let i=0;i<count;i++) {
    const [height,z] = beltPoint(i*length/count);
    vertices.push(-.258,height,z,-.251,height,z);
    const a=i*2, b=((i+1)%count)*2;
    indices.push(a,b,a+1,b,b+1,a+1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);
  const belt = new Mesh(geometry,new MeshBasicMaterial({color:0x272d35,side:DoubleSide}));
  belt.name = '同步带';
  parent.add(belt);
  const markers = [];
  const tooth = new BoxGeometry(.0074,.0012,.0015);
  const material = new MeshBasicMaterial({color:0xa48655});
  for (let i=0;i<42;i++) {
    const marker = new Mesh(tooth,material);
    parent.add(marker);
    markers.push(marker);
  }
  return phase => markers.forEach((marker,i)=>{
    const [height,z,angle]=beltPoint(phase+i*length/markers.length);
    marker.position.set(-.2545,height,z);
    marker.rotation.x=-angle;
  });
}

export function createDetectionDrive(get) {
  const module = '#1828894/#1828985';
  const node = id => get(module+'/#182'+id);
  const pivot = new Vector3(-.25,y,driveZ);
  const rotations = splitMotorShaft(node(9168),(triangle,vertex)=>{
    let exposed=false;
    for (const index of triangle) {
      const point=vertex(index);
      if (Math.hypot(point.y-y,point.z-driveZ)>.007) return false;
      if (point.x<-.241) exposed=true;
    }
    return exposed;
  }).map(shaft=>bindRotation(shaft,pivot,forward));
  for (const [id,height,z] of [[9169,y,driveZ],[9170,y,drivenZ],[9167,y,drivenZ],[9162,.37952,.44068],[9163,.37952,-.08931]]) {
    rotations.push(bindRotation(node(id),new Vector3(-.21,height,z),forward));
  }
  const group = worldGroup(get(module));
  const runSync = timingBelt(group);
  const markerMaterial = new MeshBasicMaterial({color:0x737c81});
  const markerGeometry = new BoxGeometry(.021,.00038,.0012);
  const marks = Array.from({length:25},()=>{
    const mark=new Mesh(markerGeometry,markerMaterial);
    group.add(mark);
    return mark;
  });
  const start=.431, run=.51;
  return motorRadians => {
    // Both modeled timing pulleys are the same part, so the drive is 1:1.
    rotations.forEach((rotate,i)=>rotate(i>=rotations.length-2 ? -motorRadians*conveyorRadius/.0075 : -motorRadians));
    runSync(motorRadians*radius);
    marks.forEach((mark,i)=>mark.position.set(-.210,.38732,start-modulo(i*run/marks.length+motorRadians*conveyorRadius,run)));
  };
}
