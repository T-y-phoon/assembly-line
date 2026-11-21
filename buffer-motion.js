import {Box3, Matrix3, Vector3} from 'three';
import {PusherDemo} from './pusher-demo.js';
import {bindRotation, splitMotorShaft} from './motion-geometry.js';

const buffer = '#1828892';
const gantry = buffer+'/#1829105';
const longAxis = gantry+'/#1829197';
const crossAxis = gantry+'/#1829200';
const part = (parent, number) => parent+'/#182'+number;
const parts = (parent, numbers) => numbers.map(number=>part(parent,number));
const leadMm = 4;
const TAU = 2*Math.PI;
const gripperSensor = part(buffer,9104);

export const rails = [
  {
    id:'x', name:'X 轴 · 横向丝杆', axis:new Vector3(1,0,0), center:new Vector3(-.44730702,.68753670,-.91728770),
    motor:part(crossAxis,9234), rotating:parts(crossAxis,[9218,9224]),
    flag:part(crossAxis,9227), sensors:parts(crossAxis,[9228,9231,9232]),
    carried:[gripperSensor,...parts(crossAxis,[9219,9220,9227]), part(crossAxis,9216)+'/#1829236',
      ...parts(gantry,[9201,9202,9203,9204,9207,9210,9211,9212,9213,9214])],
    speed:36
  },
  {
    id:'y', name:'Y 轴 · 纵向丝杆', axis:new Vector3(0,0,1), center:new Vector3(-.38830702,.61003670,-1.24601482),
    motor:part(longAxis,9258), rotating:parts(longAxis,[9240,9247]),
    flag:part(longAxis,9250), sensors:parts(longAxis,[9251,9254,9255]),
    carried:[gripperSensor,...parts(longAxis,[9241,9242,9250]),part(longAxis,9238)+'/#1829260',
      ...parts(gantry,[9188,9189,9190,9191,9198,9200,9201,9202,9203,9204,9205,9206,9207,9210,9211,9212,9213,9214])],
    speed:55
  }
];

const zPaths = [gripperSensor,...parts(gantry,[9202,9203,9204,9207,9211,9212,9213,9214])];
const jawAxis = new Vector3(.99917467,0,.040619927);
const jawLeft = parts(gantry,[9203,9213]);
const jawRight = parts(gantry,[9204,9212]);

export const bufferPush = {
  paths:parts(buffer,[9111,9110]), rodZ:-1, home:.016, initial:0, travel:.016, speed:.012
};

function get(viewer,path) {
  const node = viewer.objects.get(path);
  if (!node) throw Error('缓冲与移载单元缺少组件 '+path);
  return node;
}

function locateSwitches(viewer,rail) {
  const flag = new Box3().setFromObject(get(viewer,rail.flag),true);
  const flagCenter = flag.getCenter(new Vector3()).dot(rail.axis);
  const flagWidth = flag.getSize(new Vector3()).dot(rail.axis)*1000;
  // In each reused detector mesh, the upright sensing head spans local X
  // -7.421 to -0.471 mm. Use its center as the modeled trip reference.
  const activeHead = new Vector3(-.003946,0,0);
  const [lower,home,upper] = rail.sensors.map(path=>{
    const sensorCenter = get(viewer,path).localToWorld(activeHead.clone()).dot(rail.axis);
    return (sensorCenter-flagCenter)*1000;
  });
  return {offset:home,min:Math.round((lower-home)*10)/10,max:Math.round((upper-home)*10)/10,
    window:flagWidth/2};
}

export class BufferMotion {
  constructor(viewer,report) {
    this.viewer = viewer;
    this.report = report;
    this.frame = null;
    this.poses = new Map();
    this.axes = new Map();
    for (const rail of rails) {
      const limits = locateSwitches(viewer,rail);
      const motor = get(viewer,rail.motor);
      const point = new Vector3();
      const shafts = splitMotorShaft(motor,(triangle,vertex)=>{
        let forward = false;
        for (const index of triangle) {
          point.copy(vertex(index)).sub(rail.center);
          const axial = point.dot(rail.axis);
          const radial = point.addScaledVector(rail.axis,-axial).lengthSq();
          if (radial > .007**2) return false;
          if (axial > .002) forward = true;
        }
        return forward;
      });
      const rotation = [...shafts,...rail.rotating.map(path=>get(viewer,path))]
        .map(node=>bindRotation(node,rail.center,rail.axis));
      this.axes.set(rail.id,{...rail,...limits,rotation,turns:0,value:0,target:0,ends:['负向限位','正向限位']});
      this.bind(rail.id,rail.carried,rail.axis,-limits.offset);
    }
    this.axes.set('z',{min:0,max:50,value:0,target:0,speed:30,ends:['上升到位','下降到位']});
    this.bind('z',zPaths,new Vector3(0,-1,0),50);
    this.axes.set('jaw',{min:0,max:6,value:0,target:0,speed:8,ends:['张开到位','合拢到位']});
    this.bind('jaw',jawLeft,jawAxis);
    this.bind('jaw',jawRight,jawAxis.clone().negate());
    this.push = new PusherDemo(viewer,(mm,status)=>this.report('push',mm,status),bufferPush);
    this.apply();
  }

  bind(id,paths,worldAxis,origin=0) {
    for (const path of paths) {
      const node = get(this.viewer,path);
      if (!this.poses.has(node)) this.poses.set(node,{position:node.position.clone(),moves:[]});
      node.parent.updateWorldMatrix(true,false);
      const inverse = new Matrix3().setFromMatrix4(node.parent.matrixWorld).invert();
      this.poses.get(node).moves.push({id, direction:worldAxis.clone().applyMatrix3(inverse),origin});
    }
  }

  apply() {
    for (const {rotation,turns} of this.axes.values()) {
      if (rotation) for (const rotate of rotation) rotate(turns*TAU);
    }
    for (const [node,{position,moves}] of this.poses) {
      node.position.copy(position);
      for (const {id,direction,origin} of moves) {
        node.position.addScaledVector(direction,(this.axes.get(id).value-origin)/1000);
      }
    }
    this.viewer.draw();
    for (const [id,state] of this.axes) {
      const status = state.value!==state.target ? '运动中' :
        state.value===state.min ? state.ends[0] : state.value===state.max ? state.ends[1] :
        state.rotation && state.value===0 ? '原点位置' : '已停止';
      this.emit(id,status);
    }
  }

  emit(id,status) {
    const {value,turns,min,max,window} = this.axes.get(id);
    const signals = window===undefined ? undefined : {
      lower:Math.abs(value-min)<=window,
      upper:Math.abs(value-max)<=window,
      home:Math.abs(value)<=window
    };
    this.report(id,value,status,turns,signals);
  }

  move(id,direction) {
    if (id==='push') {
      this.push.move(direction);
      return;
    }
    const state = this.axes.get(id);
    this.moveTo(id,direction>0 ? state.max : state.min);
  }

  moveTo(id,target) {
    const state = this.axes.get(id);
    if (!state || !Number.isFinite(target) || target<state.min || target>state.max) return false;
    state.target = target;
    if (this.frame===null) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(now=>this.step(now));
    }
    return true;
  }

  step(now) {
    const dt = Math.max(0,now-this.last)/1000;
    this.last = now;
    for (const state of this.axes.values()) {
      const delta = state.target-state.value;
      const linear = Math.sign(delta)*Math.min(state.speed*dt,Math.abs(delta));
      if (state.rotation) {
        // A right-hand screw rotates relative to its guided nut.
        state.turns = linear===delta ? -state.target/leadMm : state.turns-linear/leadMm;
        state.value = -state.turns*leadMm;
      } else {
        state.value = linear===delta ? state.target : state.value+linear;
      }
    }
    this.apply();
    this.frame = [...this.axes.values()].some(axis=>axis.value!==axis.target) ?
      requestAnimationFrame(time=>this.step(time)) : null;
  }

  stop(id) {
    if (id==='push') {
      this.push.stop();
      this.report(id,this.push.distance*1000,'已停止');
      return;
    }
    const state = this.axes.get(id);
    state.target = state.value;
    this.emit(id,'已停止');
  }

  dispose() {
    if (this.frame!==null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.push.stop();
  }

  reset() {
    this.dispose();
    for (const state of this.axes.values()) {
      state.value = state.target = state.home??0;
      if (state.rotation) state.turns = 0;
    }
    this.push.reset();
    this.apply();
  }
}
