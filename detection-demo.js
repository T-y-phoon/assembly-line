import {Box3, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, SphereGeometry, Vector3} from 'three';
import {PusherDemo, detectionPusher} from './pusher-demo.js';
import {conveyorRadius, createDetectionDrive, motorSpeed, worldGroup} from './detection-drive.js';

const root = '#1828894';
export const detectionInput = {x:-.21063,y:.38715,z:.409};
const {x:beltX,y:beltY,z:inputZ} = detectionInput;
const sortZ = .081;
const finishedZ = -.072;
const pushContact = .028;

const stations = [
  {id:'metal', z:.278, x:-.298, y:.409},
  {id:'color', z:.228, x:-.272, y:.424},
  {id:'position', z:sortZ, x:-.181, y:.456}
];
const messages = {
  ready:'料块已放在左端', feeding:'正在输送与检测', waiting:'料块到达气缸位置，请选择去向',
  passing:'料块直行通过', pushing:'推片正在推料', sliding:'料块进入滑道，气缸缩回',
  passed:'直行通过完成', sorted:'分拣完成'
};
const convey = new Set(['feeding','passing']);
const activePhases = new Set([...convey,'pushing','sliding']);

export class DetectionDemo {
  constructor(viewer,report) {
    this.viewer=viewer;
    this.report=report;
    const get=path=>{
      const node=viewer.objects.get(path);
      if (!node) throw Error('检测工位缺少模型 '+path);
      return node;
    };
    const unit=get(root);
    this.chuteSurface=get(root+'/#1828967/#1828994');
    this.chuteRay=new Raycaster(new Vector3(),new Vector3(0,-1,0));
    const sample=get(root+'/#1828968');
    // Two filled blocks and the ring on the chute are separate CAD occurrences.
    // Leave just one instance of the real workpiece on the belt.
    for (const id of [1828992,1828993,1828998]) {
      get(root+'/#1828967/#'+id).userData.stationHidden=true;
    }
    const group=worldGroup(unit);
    const box = new Box3().setFromObject(sample,true);
    this.block=new Group();
    this.block.position.copy(box.getCenter(new Vector3()));
    this.block.position.y=box.min.y;
    group.add(this.block);
    this.block.attach(sample);
    this.blockMaterial=new MeshStandardMaterial({roughness:.49,color:0x2065d7});
    sample.traverse(node=>{if(node.isMesh)node.material=this.blockMaterial;});
    this.core=new Mesh(new CylinderGeometry(.0081,.0081,.020,24),new MeshStandardMaterial({color:0x58616d,metalness:.65,roughness:.34}));
    this.core.position.y=.010;
    this.block.add(this.core);
    const lampGeometry=new SphereGeometry(.005,12,8);
    this.lights=stations.map(({x,y,z})=>{
      const lamp=new Mesh(lampGeometry,new MeshBasicMaterial({color:0x657174,depthTest:false,depthWrite:false}));
      lamp.position.set(x,y,z);
      lamp.renderOrder=3;
      lamp.raycast=()=>{};
      group.add(lamp);
      return lamp;
    });
    this.drive=createDetectionDrive(get);
    this.pusher=new PusherDemo({objects:viewer.objects,draw(){}},()=>{},detectionPusher);
    this.color='blue';
    this.hasCore=true;
    this.reset();
  }

  reset() {
    this.dispose();
    this.phase='ready';
    this.elapsed=0;
    this.z=inputZ;
    this.x=beltX;
    this.height=beltY;
    this.angle=0;
    this.motor=0;
    this.results={};
    this.running=false;
    this.pusher.reset();
    this.draw();
  }

  configure(color,hasCore) {
    if (this.phase!=='ready') return;
    this.color=color;
    this.hasCore=hasCore;
    this.draw();
  }

  start() {
    if (this.phase==='ready') this.phase='feeding';
    if (activePhases.has(this.phase)) this.resume();
  }

  choose(sort) {
    if (this.phase!=='waiting') return;
    this.phase=sort?'pushing':'passing';
    this.elapsed=0;
    this.resume();
  }

  resume() {
    if (this.running) return;
    this.running=true;
    this.last=performance.now();
    this.draw();
    this.frame=requestAnimationFrame(now=>this.advance(now));
  }

  stop() {
    this.dispose();
    this.draw();
  }

  dispose() {
    if (this.frame!=null) cancelAnimationFrame(this.frame);
    this.frame=null;
    this.running=false;
  }

  advance(now) {
    this.frame=null;
    if (!this.running) return;
    const dt=Math.max(0,now-this.last)/1000;
    this.last=now;
    if (convey.has(this.phase)) {
      const stop=this.phase==='feeding'?sortZ:finishedZ;
      const delta=Math.min(this.z-stop,motorSpeed*dt*conveyorRadius);
      for (const {id,z} of stations) {
        if (this.z>z && this.z-delta<=z) this.record(id);
      }
      this.motor+=delta/conveyorRadius;
      this.z-=delta;
      if (Math.abs(this.z-stop)<1.e-7) {
        this.z=stop;
        this.phase=this.phase==='feeding'?'waiting':'passed';
      }
    } else {
      this.elapsed+=dt;
      if (this.phase==='pushing') {
        const stroke=Math.min(.076,this.elapsed*.085);
        this.pusher.distance=stroke;
        this.x=beltX-Math.max(0,stroke-pushContact);
        this.pusher.apply();
        if (stroke===.076) {
          this.phase='sliding';
          this.elapsed=0;
          this.chuteEntry=this.x;
        }
      } else {
        const progress=Math.min(1,this.elapsed/1.25);
        this.x=this.chuteEntry+(-.452-this.chuteEntry)*progress;
        this.chuteRay.ray.origin.set(this.x,.50,this.z);
        const surface=this.chuteRay.intersectObject(this.chuteSurface,true)[0];
        this.height=surface ? surface.point.y+.0005 : beltY+(.310-beltY)*progress;
        this.angle=.38*Math.min(1,progress*5);
        this.pusher.distance=Math.max(0,.076-this.elapsed*.105);
        this.pusher.apply();
        if (progress===1) this.phase='sorted';
      }
    }
    if (!activePhases.has(this.phase)) this.running=false;
    this.draw();
    if (this.running) this.frame=requestAnimationFrame(time=>this.advance(time));
  }

  record(id) {
    this.results[id]=id==='metal'?(this.hasCore?'有铁芯':'无铁芯'):
      id==='color'?(this.color==='blue'?'蓝色':'黄色'):'料块到位';
  }

  draw() {
    this.block.position.set(this.x,this.height,this.z);
    this.block.rotation.z=this.angle;
    this.blockMaterial.color.setHex(this.color==='blue'?0x2065d7:0xf2c229);
    this.core.visible=this.hasCore;
    this.core.userData.stationHidden=!this.hasCore;
    this.drive(this.motor);
    const sensors={};
    const onBelt=!['sliding','sorted'].includes(this.phase);
    for (const [index,{id,z}] of stations.entries()) {
      const present=onBelt && Math.abs(this.z-z)<.013 && Math.abs(this.x-beltX)<.018;
      if (present) this.record(id);
      const on=present&&(id!=='metal'||this.hasCore);
      sensors[id]={on,present,result:this.results[id]||'待检测'};
      this.lights[index].material.color.setHex(on?0x12db77:0x657174);
    }
    this.viewer.draw();
    const waiting=this.phase==='waiting';
    this.report({phase:this.phase,waiting,running:this.running,
      canStart:activePhases.has(this.phase)||this.phase==='ready',
      motorsOn:this.running&&convey.has(this.phase),
      stroke:this.pusher.distance*1000,sensors,status:!this.running&&activePhases.has(this.phase)?'已暂停，可继续':messages[this.phase]});
  }
}
