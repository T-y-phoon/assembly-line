import {AxesHelper, Group, Quaternion, Vector3} from 'three';

// Pivots are in the STEP IRB120 base frame (millimetres, Z up).
// The cylindrical mating surfaces establish axes 1–6 in the CAD zero pose.
const degrees = Math.PI/180;
const defaultAngles = [0,0,0,0,90*degrees,0];
const vector = values => new Vector3(...values);
const geometry = [
  [[0,0,155], [0,0,1], -165, 165],
  [[0,0,290], [0,1,0], -110, 110],
  [[0,0,560], [0,1,0], -110, 70],
  [[0,0,630], [1,0,0], -160, 160],
  [[302,0,630], [0,1,0], -120, 120],
  [[374,0,630], [1,0,0], -400, 400]
];
export const robots = {S01:'#1828889', S06:'#1828897'};
const joints = geometry.map(([pivot,axis,lo,hi])=>({
  pivot:vector(pivot).multiplyScalar(.001), axis:vector(axis), min:lo*degrees, max:hi*degrees
}));
const links = joints.map(({pivot},i)=>pivot.clone().sub(i ? joints[i-1].pivot : new Vector3()));
// The two cylindrical pads are 10 mm wide along wrist X. The fitted arc
// centers share a plane 70 mm along wrist Z from the J6 pivot.
const arcGripCenter = new Vector3(.4825,0,.700);
const arcGripStroke = .0086;

export function downwardGrip(yaw = 0) {
  return new Quaternion().setFromAxisAngle(new Vector3(0,0,1),yaw)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2));
}

function pose(angles,toolOffset) {
  const position = new Vector3();
  const rotation = new Quaternion();
  const centers = [], directions = [];
  for (const [i,joint] of joints.entries()) {
    position.add(links[i].clone().applyQuaternion(rotation));
    centers.push(position.clone());
    directions.push(joint.axis.clone().applyQuaternion(rotation));
    rotation.multiply(new Quaternion().setFromAxisAngle(joint.axis,angles[i]));
  }
  return {point:position.add(toolOffset.clone().applyQuaternion(rotation)), rotation, centers, directions};
}

function limit(index,value) {
  return Math.max(joints[index].min,Math.min(joints[index].max,value));
}

function rotationError(target,current) {
  const q = target.clone().multiply(current.clone().invert()).normalize();
  const axis = new Vector3(q.x,q.y,q.z);
  const magnitude = axis.length();
  if (magnitude<1.e-12) return axis.set(0,0,0);
  return axis.multiplyScalar((q.w<0?-1:1)*2*Math.atan2(magnitude,Math.abs(q.w))/magnitude);
}

function solveLinear(matrix,rhs) {
  // The damping term keeps this six-by-six normal matrix positive definite.
  for (let i=0;i<6;i++) {
    for (let j=i+1;j<6;j++) {
      const factor = matrix[j][i]/matrix[i][i];
      for (let k=i+1;k<6;k++) matrix[j][k]-=factor*matrix[i][k];
      rhs[j]-=factor*rhs[i];
    }
  }
  for (let i=5;i>=0;i--) {
    for (let j=i+1;j<6;j++) rhs[i]-=matrix[i][j]*rhs[j];
    rhs[i]/=matrix[i][i];
  }
  return rhs;
}

function solvePose(target,orientation,seed,toolOffset) {
  let angles = seed.slice();
  const rotationWeight = .25;
  const damping = .004;
  for (let iteration=0;iteration<60;iteration++) {
    const {point,rotation,centers,directions} = pose(angles,toolOffset);
    const error = target.clone().sub(point);
    const angular = rotationError(orientation,rotation);
    if (error.length()<.000005 && angular.length()<.000025) return angles;
    const columns = directions.map((axis,i)=>[
      ...axis.clone().cross(point.clone().sub(centers[i])).toArray(),
      ...axis.clone().multiplyScalar(rotationWeight).toArray()
    ]);
    const normal = Array.from({length:6},(_,i)=>Array.from({length:6},(_,j)=>i===j?damping*damping:0));
    for (const column of columns) {
      for (let i=0;i<6;i++) for (let j=0;j<6;j++) normal[i][j]+=column[i]*column[j];
    }
    const correction = solveLinear(normal,[...error.toArray(),...angular.multiplyScalar(rotationWeight).toArray()]);
    const next = angles.map((angle,i)=>{
      const change = columns[i].reduce((sum,term,j)=>sum+term*correction[j],0);
      return limit(i,angle+Math.max(-.06,Math.min(.06,change)));
    });
    if (next.every((angle,i)=>Math.abs(angle-angles[i])<1.e-8)) break;
    angles = next;
  }
  return null;
}

export class RobotMotion {
  constructor(viewer,root,report) {
    this.viewer = viewer;
    this.report = report;
    this.frame = null;
    this.angles = defaultAngles.slice();
    this.toolOffset = arcGripCenter.clone().sub(joints.at(-1).pivot);
    const basePath = root+'/#1829298';
    const base = viewer.objects.get(basePath);
    this.base = base;
    const chain = [];
    for (const [i,offset] of links.entries()) {
      const joint = new Group();
      joint.name = 'J'+(i+1);
      joint.position.copy(offset);
      (chain.at(-1) || base).add(joint);
      chain.push(joint);
    }
    // The export gives every link the same base frame. Attaching preserves the
    // installed transforms and moves the tool with the wrist, not the base.
    chain.forEach((joint,i)=>joint.attach(viewer.objects.get(basePath+'/#'+(1829306+i))));
    for (const id of [1829299,1829300,1829301,1829303,1829304]) {
      chain[5].attach(viewer.objects.get(root+'/#'+id));
    }
    this.chain = chain;
    this.fingers = [1829303,1829304].map(id=>{
      const node = viewer.objects.get(root+'/#'+id);
      return {node,open:node.position.y};
    });
    const axes = new AxesHelper(.145);
    axes.name = '机器人基坐标系';
    axes.raycast = ()=>{};
    axes.material.depthTest = false;
    axes.material.depthWrite = false;
    axes.renderOrder = 3;
    base.add(axes);
    this.show('就绪');
  }

  show(message) {
    this.chain.forEach((joint,i)=>joint.quaternion.setFromAxisAngle(joints[i].axis,this.angles[i]));
    this.viewer.draw();
    const point = pose(this.angles,this.toolOffset).point.multiplyScalar(1000);
    this.report(this.angles.map(angle=>angle/degrees),point,message);
  }

  animate(waypoints,duration,done,onDone) {
    this.show('运动中');
    const start = performance.now();
    const tick = now => {
      const progress = Math.min(1,Math.max(0,now-start)/duration);
      const cursor = progress*(waypoints.length-1);
      const from = waypoints[Math.floor(cursor)];
      const to = waypoints[Math.min(Math.floor(cursor)+1,waypoints.length-1)];
      this.angles = from.map((angle,i)=>angle+(to[i]-angle)*(cursor%1));
      this.frame = progress===1 ? null : requestAnimationFrame(tick);
      this.show(progress===1 ? done : '运动中');
      if (progress===1) onDone?.();
    };
    this.frame = requestAnimationFrame(tick);
  }

  setGrip(progress) {
    // Stop when the original R18.5 CAD arcs meet the R19 workpiece.
    this.fingers.forEach(({node,open},i)=>{node.position.y = open+(i===0?-1:1)*arcGripStroke*progress;});
  }

  planLinear(target,orientation,start) {
    const {point,rotation} = pose(start,this.toolOffset);
    const steps = Math.max(1,Math.ceil(point.distanceTo(target)/.012),Math.ceil(rotation.angleTo(orientation)/(.0873)));
    const waypoints = [start];
    for (let step=1;step<=steps;step++) {
      const fraction = step/steps;
      const next = solvePose(point.clone().lerp(target,fraction),rotation.clone().slerp(orientation,fraction),waypoints.at(-1),this.toolOffset);
      if (!next) return null;
      waypoints.push(next);
    }
    return waypoints;
  }

  solveTarget(target,orientation,seedDegrees) {
    return solvePose(target,orientation,seedDegrees.map(angle=>angle*degrees),this.toolOffset);
  }

  jogJoint(index,delta) {
    this.cancel();
    const goal = this.angles.slice();
    goal[index] = limit(index,goal[index]+delta*degrees);
    if (Math.abs(goal[index]-this.angles[index])<1.e-8) {
      this.show('J'+(index+1)+' 已到限位');
      return;
    }
    this.animate([this.angles.slice(),goal],Math.max(180,Math.abs(delta)*26),'J'+(index+1)+' 点动完成');
  }

  jogBase(component,mm) {
    this.cancel();
    const {point:start,rotation:orientation} = pose(this.angles,this.toolOffset);
    const waypoints = [this.angles.slice()];
    const steps = Math.ceil(Math.abs(mm));
    for (let i=1;i<=steps;i++) {
      const target = start.clone();
      target[component] += mm*i/steps/1000;
      const previous = waypoints.at(-1);
      const next = solvePose(target,orientation,previous,this.toolOffset);
      if (!next) {
        this.show('保持工具姿态时不可达。请减小步距或调整关节。');
        return;
      }
      const midpoint = pose(previous.map((angle,j)=>(angle+next[j])/2),this.toolOffset);
      target[component] -= mm/steps/2000;
      if (midpoint.point.distanceTo(target)>.000025 || rotationError(orientation,midpoint.rotation).length()>.000175) {
        this.show('保持工具姿态时不可达。请减小步距或调整关节。');
        return;
      }
      waypoints.push(next);
    }
    this.animate(waypoints,Math.max(240,Math.abs(mm)*28),'末端定位完成');
  }

  cancel() {
    if (this.frame!==null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  stop() {
    this.cancel();
    this.show('已停止');
  }

  reset() {
    this.cancel();
    this.angles = defaultAngles.slice();
    this.show('已恢复默认姿态');
  }
}
