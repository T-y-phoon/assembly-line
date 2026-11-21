import {
  Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SphereGeometry, Vector3
} from 'three';
import {worldGroup} from './detection-drive.js';
import {bindRotation} from './motion-geometry.js';
import {tableCenter} from './machining-demo.js';

const root = '#1828893';
const rotary = id => root+'/#1828999/#182'+id;
const conveyor = id => root+'/#1829000/#182'+id;
const up = new Vector3(0,1,0);
const turn = 2*Math.PI;
const tolerance = Math.PI/180;
const angleDistance = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const beltStart = new Vector3(-.20975,.38714,-.139);
const beltStop = new Vector3(-.2095,.38714,-.49616);
const homeSeat = new Vector3(-.26243,.3840367,-.49689);
const pressSeat = new Vector3(-.33048,.38404,-.42997);
const coreHeight = .018;
const stagedCoreBottom = .4125;
const sensors = {
  arrival:[-.205,.470,-.49615],
  home:[-.33043,.353,-.593],
  block:[-.459,.399,-.497],
  core:[-.406,.459,-.497]
};
const operations = {
  placing:'正在从左端放下料块',
  feeding:'传送带运行，料块向推料气缸处移动',
  pushing:'推料气缸将料块送入托位，随后缩回',
  clamping:'底部气缸伸出，夹紧料块',
  inserting:'中间气缸推出料芯，随后缩回',
  pressing:'上方气缸下降压入料芯，随后上升',
  releasing:'底部气缸缩回，松开料块'
};
const limit = value => Math.min(1,Math.max(0,value));

function makeBelt(group,get) {
  const axis = new Vector3(1,0,0);
  const rollers = [[9010,.37954,-.12102],[9011,.37954,-.65102]].map(([id,y,z]) =>
    bindRotation(get(conveyor(id)),new Vector3(-.2095,y,z),axis));
  const material = new MeshBasicMaterial({color:0x737c81});
  const geometry = new BoxGeometry(.020,.00032,.0013);
  const markers = Array.from({length:25},()=>{
    const marker = new Mesh(geometry,material);
    group.add(marker);
    return marker;
  });
  return distance => {
    for (const rotate of rollers) rotate(-distance/.0075);
    markers.forEach((marker,i)=>{
      marker.position.set(-.2095,.38731,-.127-(i*.516/markers.length+distance)%.516);
    });
  };
}

function fitPressTip(head,stroke) {
  head.updateWorldMatrix(true,true);
  const bounds = new Box3().setFromObject(head,true);
  // The workpiece has a through-bore. Seat the core on the same table
  // surface as the workpiece and keep the cylinder's existing stroke.
  const retractedTipY = homeSeat.y+coreHeight+stroke;
  const length = bounds.min.y-retractedTipY;
  let material;
  head.traverse(node=>{if (node.isMesh) material = node.material;});
  const tip = new Mesh(new CylinderGeometry(.006,.006,length,32),material);
  tip.name = '压头接触端';
  tip.position.copy(bounds.getCenter(new Vector3())).setY(retractedTipY+length/2);
  worldGroup(head).add(tip);
}

export class MachiningProcess {
  constructor(viewer,rotaryDemo,cylinders,report) {
    this.viewer = viewer;
    this.rotary = rotaryDemo;
    this.cylinders = cylinders;
    this.report = report;
    const get = path => viewer.objects.get(path);
    fitPressTip(get(rotary(9071)),cylinders.vertical.travel);
    const group = worldGroup(get(root));
    const sample = get(rotary(9098));
    const bounds = new Box3().setFromObject(sample,true);
    this.sample = new Group();
    this.sample.position.copy(bounds.getCenter(new Vector3())).setY(bounds.min.y);
    group.add(this.sample);
    this.sample.attach(sample);
    // These CAD instances are sample blocks. The four holders remain on the table.
    for (const id of [9074,9096,9099]) get(rotary(id)).userData.stationHidden = true;
    const ringMaterial = new MeshStandardMaterial({color:0x2077c9,roughness:.48});
    sample.traverse(node => {if (node.isMesh) node.material = ringMaterial;});
    this.core = new Mesh(new CylinderGeometry(.0088,.0088,coreHeight,32),
      new MeshStandardMaterial({color:0xd5a547,metalness:.42,roughness:.3}));
    this.core.name = '料芯';
    group.add(this.core);
    const lampGeometry = new SphereGeometry(.0045,14,10);
    this.lights = Object.fromEntries(Object.entries(sensors).map(([id,position])=>{
      const lamp = new Mesh(lampGeometry,new MeshBasicMaterial({color:0x657174,depthTest:false,depthWrite:false}));
      lamp.position.set(...position);
      lamp.renderOrder = 4;
      lamp.raycast = ()=>{};
      group.add(lamp);
      return [id,lamp];
    }));
    const homeBracket = new Mesh(new BoxGeometry(.018,.009,.014),new MeshStandardMaterial({color:0x344e60,roughness:.64}));
    homeBracket.name = '原点传感器示意';
    homeBracket.position.set(-.33043,.347,-.593);
    group.add(homeBracket);
    this.homeTarget = new Mesh(new BoxGeometry(.011,.005,.012),new MeshStandardMaterial({color:0xe8a75a,roughness:.56}));
    this.homeTarget.name = '转盘原点标记';
    group.add(this.homeTarget);
    this.belt = makeBelt(worldGroup(get(root+'/#1829000')),get);
    this.reset();
  }

  dispose() {
    if (this.frame!=null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  reset() {
    this.dispose();
    this.location = 'empty';
    this.operation = null;
    this.arrived = false;
    this.hasCore = this.staged = this.pressed = false;
    this.inspection = null;
    this.coreAdvance = 0;
    this.coreBottom = .0065;
    this.position = beltStart.clone();
    this.belt(0);
    for (const cylinder of Object.values(this.cylinders)) cylinder.reset();
    this.rotary.reset();
    this.refresh();
  }

  get state() {
    const {tableAngle,frame} = this.rotary;
    const home = angleDistance(tableAngle,0)<tolerance;
    const canIndex = !this.operation && Object.values(this.cylinders).every(cylinder => cylinder.distance===0 && cylinder.frame===null);
    const atPosition = angle => this.location==='table' && angleDistance(tableAngle,angle)<tolerance;
    const atInspection = atPosition(Math.PI);
    const atPress = atPosition(-Math.PI/2);
    const idle = !this.operation && frame===null;
    const clamped = this.cylinders.lower.distance===this.cylinders.lower.travel;
    return {
      home, atInspection, atPress, clamped, canIndex,
      arrival:this.operation==='pushing'?this.position.x>beltStop.x-.018:this.location==='waiting',
      block:atInspection, core:atInspection && this.hasCore,
      canPlace:idle && this.location==='empty' && canIndex,
      canConvey:idle && this.location==='belt' && canIndex,
      canPush:idle && this.location==='waiting' && home && canIndex,
      canClamp:idle && atPress && !clamped,
      canInsert:idle && atPress && clamped && !this.hasCore,
      canPress:idle && atPress && clamped && this.hasCore && !this.pressed,
      canRelease:idle && atPress && clamped && !this.staged,
      canJog:idle && this.location==='empty',
      spinning:frame!==null
    };
  }

  place(hasCore) {
    if (!this.state.canPlace) return;
    this.hasCore = hasCore;
    this.location = 'belt';
    this.animate('placing',.48,p=>{
      this.position.copy(beltStart).y += .055*(1-p)*(1-p);
    });
  }

  convey() {
    if (!this.state.canConvey) return;
    const distance = beltStart.z-beltStop.z;
    this.animate('feeding',distance/.085,p=>{
      this.position.lerpVectors(beltStart,beltStop,p);
      this.belt(distance*p);
    },()=>{
      this.arrived = true;
      this.location = 'waiting';
    });
  }

  push() {
    if (!this.state.canPush) return;
    const cylinder = this.cylinders.conveyor;
    this.animate('pushing',2.1,p=>{
      const out = limit(p/.57);
      const returned = limit((p-.62)/.38);
      this.setCylinder(cylinder,cylinder.travel*out*(1-returned),returned>0?-1:1);
      // The plate travels through the initial air gap before touching the rim.
      const transfer = limit((cylinder.travel*out-.025)/(cylinder.travel-.025));
      this.position.lerpVectors(beltStop,homeSeat,transfer);
      if (out===1) this.location = 'table';
    });
  }

  clamp(extend) {
    if (!(extend ? this.state.canClamp : this.state.canRelease)) return;
    const cylinder = this.cylinders.lower;
    this.animate(extend?'clamping':'releasing',.97,p=>{
      this.setCylinder(cylinder,cylinder.travel*(extend?p:1-p),extend?1:-1);
    });
  }

  insert() {
    if (!this.state.canInsert) return;
    const cylinder = this.cylinders.upper;
    this.animate('inserting',1.65,p=>{
      const out = limit(p/.58);
      const returned = limit((p-.65)/.35);
      this.setCylinder(cylinder,cylinder.travel*out*(1-returned),returned>0?-1:1);
      this.staged = true;
      this.coreAdvance = out;
      if (out===1) {
        this.hasCore = true;
        this.coreBottom = stagedCoreBottom-homeSeat.y;
      }
    },()=>{this.coreAdvance = 0;});
  }

  press() {
    if (!this.state.canPress) return;
    const cylinder = this.cylinders.vertical;
    const start = this.coreBottom;
    this.animate('pressing',1.7,p=>{
      const out = limit(p/.57);
      const returned = limit((p-.65)/.35);
      const stroke = cylinder.travel*out;
      this.setCylinder(cylinder,stroke*(1-returned),returned>0?-1:1);
      this.coreBottom = Math.min(start,cylinder.travel-stroke);
      if (out===1) {
        this.staged = false;
        this.pressed = true;
      }
    });
  }

  setCylinder(cylinder,distance,direction) {
    const message = distance>0 && distance<cylinder.travel ? (direction>0?'伸出中':'缩回中') : undefined;
    cylinder.setDistance(distance,message);
  }

  animate(operation,seconds,update,complete) {
    const start = performance.now();
    this.operation = operation;
    const tick = now => {
      const progress = limit((now-start)/(seconds*1000));
      update(progress);
      if (progress===1) {
        this.frame = this.operation = null;
        complete?.();
      } else {
        this.frame = requestAnimationFrame(tick);
      }
      this.refresh();
    };
    tick(start);
  }

  refresh(draw = true) {
    const state = this.state;
    const angle = this.rotary.tableAngle;
    this.showPart(this.sample,this.location!=='empty');
    if (this.location==='table') {
      this.sample.position.copy(homeSeat).sub(tableCenter).applyAxisAngle(up,angle).add(tableCenter);
      this.sample.rotation.y = angle;
    } else {
      this.sample.position.copy(this.position);
      this.sample.rotation.y = 0;
    }
    const target = this.homeTarget.position.set(-.33043,.355,-.585);
    target.sub(tableCenter).applyAxisAngle(up,angle).add(tableCenter);
    this.homeTarget.rotation.y = angle;
    this.showPart(this.core,this.hasCore || this.operation==='inserting');
    this.core.position.copy(this.sample.position).y += this.coreBottom+coreHeight/2;
    if (this.operation==='inserting') {
      this.core.position.copy(pressSeat);
      this.core.position.y = stagedCoreBottom+coreHeight/2;
      this.core.position.z += .066*(1-this.coreAdvance);
    }
    if (state.atInspection) this.inspection = this.hasCore;
    for (const [id,lamp] of Object.entries(this.lights)) lamp.material.color.setHex(state[id]?0x08e479:0x536369);
    this.report({...state,arrived:this.arrived,inspection:this.inspection,beltRunning:this.operation==='feeding',message:this.message(state)});
    if (draw) this.viewer.draw();
  }

  showPart(node,shown) {
    if (node.userData.stationHidden!==!shown) {
      node.userData.stationHidden = !shown;
      node.visible = shown;
    }
  }

  message(state) {
    if (this.operation) return operations[this.operation];
    if (state.spinning) return '转盘正在转动';
    if (this.location==='empty') return '从传送带左端放料';
    if (this.location==='belt') return '料块已放在左端，可启动输送';
    if (this.location==='waiting') return state.home?'料块和转盘均已到位，可推料':'输送带已停止，转盘回原点后方可推料';
    if (this.pressed) return state.clamped?'压装完成，料芯已到底，可松开夹紧气缸':'压装完成，料芯与料块随托位一起转动';
    if (state.atPress) return this.staged?'料芯已推出，可下降压装':state.clamped?
      (this.hasCore?'料块已夹紧，已有料芯，可压装':'料块已夹紧，可推出料芯'):'料块到达 9 点钟加工位，可夹紧';
    return state.atInspection?'料块到达 12 点钟检测位，可读取两路信号':'用转盘 ±90° 把料块移到检测位和加工位';
  }
}
