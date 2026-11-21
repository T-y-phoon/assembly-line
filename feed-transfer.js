import {
  Box3, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3
} from 'three';
import {detectionInput} from './detection-demo.js?v=s01-transfer';
import {worldGroup} from './detection-drive.js';
import {downwardGrip} from './robot-motion.js?v=s06-rack';
import {workpieceMould} from './motion-geometry.js?v=s06-rack';

const assembly = '#1828888/#1829316/#';
const stockY = .38604;
const stockZ = 1.09416;
const pickX = -.14926;
const pickZ = 1.03088;
const tableY = .38704;
const gripHeight = .010;
const pitch = .020;
const contact = .0157;
const palette = {yellow:0xf2ba24,blue:0x2065d7};
const colorName = {yellow:'黄色',blue:'蓝色'};
const capacity = 4;
const positionTolerance = .0005;
const sensorParts = {left:1829341,right:1829343,yellow:1829335,blue:1829336};
const wellData = [
  {color:'yellow',path:assembly+'1829332',x:pickX},
  {color:'blue',path:assembly+'1829331',x:pickX+.125}
];
export const transferAssets = ['#1828894/#1828985','#1828894/#1828968'];
const destination = new Vector3(detectionInput.x,detectionInput.y,detectionInput.z);
const steps = ['safe','pickAbove','pick','grip','pickAbove','safe','placeAbove','place','release','placeAbove','safe'];
const eased = t => t*t*(3-2*t);
const confirmedColor = signals => signals.left?'blue':signals.right?'yellow':null;

export function fitFeedRod(viewer,travel) {
  const rod = viewer.objects.get(assembly+'1829346');
  rod.updateWorldMatrix(true,true);
  const bounds = new Box3().setFromObject(rod,true);
  const shaft = new Mesh(new CylinderGeometry(.0038,.0038,travel,20),
    new MeshStandardMaterial({color:0xaeb8c3,metalness:.58,roughness:.31}));
  shaft.rotation.x = Math.PI/2;
  shaft.position.copy(bounds.getCenter(new Vector3())).setZ(bounds.max.z+travel/2);
  worldGroup(rod).add(shaft);
}

export class FeedTransfer {
  constructor(viewer,context,robot,[carriage,pusher],report,onDeliver,delivered,stock) {
    this.viewer = viewer;
    this.context = context;
    this.robot = robot;
    this.carriage = carriage;
    this.pusher = pusher;
    this.report = report;
    this.onDeliver = onDeliver;
    this.busy = false;
    this.index = 0;
    this.delivered = delivered;
    this.part = null;
    this.activePoint = null;
    const mould = workpieceMould(viewer.objects.get(transferAssets[1]));
    const root = viewer.objects.get('#1828888');
    this.work = worldGroup(root);
    this.stacks = Object.fromEntries(wellData.map(data=>{
      const count = stock?.[data.color] ?? capacity-Number(data.color===delivered);
      const mount = worldGroup(viewer.objects.get(data.path));
      const material = new MeshStandardMaterial({color:palette[data.color],roughness:.48});
      const pieces = Array.from({length:capacity},(_,i)=>{
        const part = mould.clone();
        part.traverse(node=>{if (node.isMesh) node.material = material;});
        part.position.set(data.x,stockY+i*pitch,stockZ);
        part.userData.stationHidden = i>=count;
        part.visible = i<count;
        mount.add(part);
        return part;
      });
      return [data.color,{...data,mount,pieces,count}];
    }));
    if (delivered) {
      const well = this.stacks[delivered];
      const part = well.pieces[well.count];
      this.context.attach(part);
      part.position.copy(destination);
      part.userData.stationHidden = false;
      part.visible = true;
      this.part = part;
      this.index = steps.length;
    }
    const lamp = new SphereGeometry(.004,12,8);
    this.lights = Object.fromEntries(Object.entries(sensorParts).map(([id,part])=>{
      const sensor = viewer.objects.get(assembly+part);
      sensor.updateWorldMatrix(true,true);
      const bounds = new Box3().setFromObject(sensor,true);
      const light = new Mesh(lamp,new MeshBasicMaterial({depthTest:false,depthWrite:false}));
      light.position.copy(bounds.getCenter(new Vector3())).setY(bounds.max.y+.005);
      light.renderOrder = 4;
      light.raycast = ()=>{};
      this.work.add(light);
      return [id,light];
    }));
    const pointInfo = [
      ['pick','取料点',[pickX,tableY+gripHeight,pickZ],0xc13954],
      ['pickAbove','取料点上方',[pickX,.530,pickZ],0x9646bf],
      ['safe','安全点',[.020,.590,.712],0x007b5e],
      ['place','放料点',[destination.x,destination.y+gripHeight,destination.z],0x0760ca],
      ['placeAbove','放料点上方',[destination.x,.530,destination.z],0x9b5b13]
    ];
    const dot = new SphereGeometry(.006,12,8);
    this.points = Object.fromEntries(pointInfo.map(([id,label,world,color])=>{
      const location = new Vector3(...world);
      const marker = new Mesh(dot,new MeshBasicMaterial({color,depthTest:false,depthWrite:false}));
      marker.position.copy(location);
      marker.renderOrder = 4;
      marker.raycast = ()=>{};
      context.add(marker);
      return [id,{label,color,marker,base:robot.base.worldToLocal(location)}];
    }));
    // The contact arcs run perpendicular to wrist X. Point that axis down
    // along base -Z so each pad's arc lies in the workpiece's radial plane.
    this.orientations = {pick:downwardGrip(-Math.PI/2),pickAbove:downwardGrip(-Math.PI/2),
      safe:downwardGrip(),place:downwardGrip(Math.PI/2),placeAbove:downwardGrip(Math.PI/2)};
    const safe = robot.solveTarget(this.points.safe.base,this.orientations.safe,[0,0,0,0,90,0]);
    if (!safe) throw Error('S01 安全点超出机器人运动范围');
    this.route = steps.map(action=>{
      if (action==='grip' || action==='release') return {action};
      const plan = this.linearPlan(action,safe);
      safe.splice(0,safe.length,...plan.at(-1));
      return {action,plan};
    });
    this.refresh(delivered?'料块已放在 S02 传送带入口':'请选择料仓，推出一个料块');
  }

  linearPlan(action,from) {
    const plan = this.robot.planLinear(this.points[action].base,this.orientations[action],from.slice());
    if (!plan) throw Error('S01 机器人无法到达'+this.points[action].label);
    return plan;
  }

  get signals() {
    return {
      left:this.carriage.distance<=positionTolerance,
      right:this.carriage.travel-this.carriage.distance<=positionTolerance,
      yellow:this.stacks.yellow.count>0,
      blue:this.stacks.blue.count>0
    };
  }

  updateReadout(message) {
    if (message) this.message = message;
    const signals = this.signals;
    for (const [id,light] of Object.entries(this.lights)) {
      light.material.color.setHex(signals[id]?0x08e479:0x536369);
    }
    for (const [id,{marker}] of Object.entries(this.points)) {
      marker.scale.setScalar(id===this.activePoint?1.55:1);
    }
    this.report({
      canFeed:!this.busy && !this.part && !this.delivered,
      signals,
      stock:{yellow:this.stacks.yellow.count,blue:this.stacks.blue.count},
      color:confirmedColor(signals),
      canMove:!this.busy && Boolean(this.part) && this.index<steps.length,
      locked:this.busy || Boolean(this.part) && this.index<steps.length,
      delivered:this.delivered,
      next:this.points[steps[this.index]]?.label ||
        ({grip:'夹紧料块',release:'松开放料'})[steps[this.index]],
      active:this.activePoint,
      status:this.message
    });
  }

  refresh(message) {
    this.updateReadout(message);
    this.viewer.draw();
  }

  setStock(color,count) {
    if (this.busy || this.part) return;
    const well = this.stacks[color];
    well.count = count;
    well.pieces.forEach((part,i)=>{
      part.userData.stationHidden = i>=count;
      part.visible = i<count;
    });
    this.refresh();
  }

  tween(seconds,update,done) {
    const start = performance.now();
    const tick = now => {
      const p = Math.max(0,Math.min(1,(now-start)/(seconds*1000)));
      update(p);
      this.viewer.draw();
      this.frame = p===1?null:requestAnimationFrame(tick);
      if (p===1) done();
    };
    tick(start);
  }

  stroke(cylinder,target,duration,done,follow) {
    const start = cylinder.distance;
    this.tween(duration,p=>{
      const distance = start+(target-start)*eased(p);
      cylinder.setDistance(distance,p===1?undefined:(target>start?'伸出中':'缩回中'));
      follow?.(distance,p);
    },done);
  }

  feed(color) {
    if (this.busy || this.part || this.delivered || !this.signals[color]) return;
    this.busy = true;
    this.carriage.stop();
    this.pusher.stop();
    this.robot.stop();
    this.refresh('正在对准'+colorName[color]+'料仓');
    const target = color==='yellow'?this.carriage.travel:0;
    const align = () => this.stroke(this.carriage,target,.9,()=>{
      const signals = this.signals;
      const confirmed = confirmedColor(signals);
      if (confirmed!==color || !signals[confirmed]) {
        this.busy = false;
        this.refresh('料井位置或存料信号异常，推料未启动');
        return;
      }
      const well = this.stacks[confirmed];
      const [part,...remaining] = well.pieces.slice(0,well.count);
      this.fedColor = confirmed;
      this.part = part;
      this.work.attach(part);
      part.position.set(pickX,stockY,stockZ);
      this.refresh('已确认'+colorName[confirmed]+'，推料气缸伸出');
      this.stroke(this.pusher,this.pusher.travel,1.35,()=>{
        well.count--;
        this.stroke(this.pusher,0,.85,()=>{
          this.busy = false;
          this.refresh(colorName[confirmed]+'料块已到取料位，可开始搬运');
        },(distance,p)=>{
          for (const [i,block] of remaining.entries()) block.position.y=stockY+(i+1-eased(p))*pitch;
        });
      },distance=>{
        const progress = Math.max(0,(distance-contact)/(this.pusher.travel-contact));
        part.position.z = stockZ+(pickZ-stockZ)*progress;
        part.position.y = stockY+(tableY-stockY)*progress;
      });
    });
    if (this.pusher.distance>0) this.stroke(this.pusher,0,.65,align);
    else align();
  }

  run(continuous) {
    if (this.busy || !this.part || this.index>=steps.length) return;
    this.busy = true;
    const next = () => {
      this.index++;
      if (continuous && this.index<steps.length) this.moveNext(next);
      else {
        this.busy = false;
        this.refresh(this.index===steps.length?'搬运完成，料块已交接到 S02':'单步完成，可继续下一步');
      }
    };
    this.moveNext(next);
  }

  moveNext(done) {
    const {action,plan} = this.route[this.index];
    if (action==='grip' || action==='release') {
      const close = action==='grip';
      this.refresh(close?'夹爪正在夹紧料块':'夹爪正在放开料块');
      if (!close) {
        this.context.attach(this.part);
        this.part.position.copy(destination);
        this.part.quaternion.identity();
      }
      this.tween(.32,p=>this.robot.setGrip(close?p:1-p),()=>{
        if (close) this.robot.chain[5].attach(this.part);
        else {
          this.delivered = this.fedColor;
          this.onDeliver(this.delivered);
        }
        done();
      });
      return;
    }
    this.activePoint = action;
    const point = this.points[action];
    const path = this.index===0?[this.robot.angles.slice(),plan.at(-1)]:plan;
    this.refresh('机器人正在前往'+point.label);
    const duration = this.index===0?1550:Math.max(430,(path.length-1)*30);
    this.robot.animate(path,duration,'到达'+point.label,done);
  }

  reset() {
    this.dispose();
    this.part = null;
    this.delivered = null;
    this.onDeliver(null);
    this.index = 0;
    this.activePoint = null;
    this.busy = false;
    this.carriage.reset();
    this.pusher.reset();
    this.robot.setGrip(0);
    this.robot.reset();
    for (const well of Object.values(this.stacks)) {
      const {mount,pieces,x} = well;
      well.count = capacity;
      for (const [i,part] of pieces.entries()) {
        mount.add(part);
        part.userData.stationHidden = false;
        part.visible = true;
        part.position.set(x,stockY+i*pitch,stockZ);
        part.quaternion.identity();
      }
    }
    this.refresh('请选择料仓，推出一个料块');
  }

  dispose() {
    if (this.frame!=null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.robot.cancel();
  }
}
