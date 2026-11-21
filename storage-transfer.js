import {Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, Vector3} from 'three';
import {downwardGrip} from './robot-motion.js?v=s06-rack';
import {workpieceMould} from './motion-geometry.js?v=s06-rack';
import {worldGroup} from './detection-drive.js';

export const storageAssets = ['#1828896','#1828895/#1828949'];
// Top of the support and centers of the five measured cutouts on each CAD shelf.
const shelves = [
  [.3419493,[[-.04532,-2.35856],[-.07605,-2.41174],[-.11874,-2.45591],[-.17085,-2.48843],[-.22927,-2.50739]]],
  [.4694970,[[-.03743,-2.36563],[-.06872,-2.41849],[-.11187,-2.46220],[-.16431,-2.49418],[-.22293,-2.51252]]],
  [.6017699,[[-.03090,-2.37465],[-.06274,-2.42717],[-.10634,-2.47043],[-.15912,-2.50186],[-.21792,-2.51959]]]
];
const colorName = {yellow:'黄色',blue:'蓝色'};
const beltTail = new Vector3(-.20709,.38713,-1.717);
const gripHeight = .010;
const lift = .016;
const safe = new Vector3(-.057,.680,-2.073);

export class StorageTransfer {
  constructor(viewer,context,robot,report,occupied = {}) {
    this.viewer = viewer;
    this.context = context;
    this.robot = robot;
    this.report = report;
    this.occupied = {...occupied};
    this.busy = false;
    this.part = null;
    this.index = 0;
    const rack = viewer.objects.get('#1828898');
    this.shelves = worldGroup(rack);
    const mould = workpieceMould(viewer.objects.get(storageAssets[1]));
    this.materials = {
      yellow:new MeshStandardMaterial({color:0xf2ba24,roughness:.48}),
      blue:new MeshStandardMaterial({color:0x2065d7,roughness:.48})
    };
    this.slots = new Map();
    const ring = new RingGeometry(.016,.019,32).rotateX(-Math.PI/2);
    shelves.forEach(([floor,positions],row)=>{
      positions.forEach(([x,z],column)=>{
        const id = (row+1)+'-'+(column+1);
        const position = new Vector3(x,floor,z);
        const marker = new Mesh(ring,new MeshBasicMaterial({color:0x6b8077,transparent:true,opacity:.85}));
        marker.userData.storageSlot = id;
        marker.position.copy(position).y += .0035;
        this.shelves.add(marker);
        const part = mould.clone();
        this.shelves.add(part);
        part.userData.storageSlot = id;
        part.position.copy(position);
        this.slots.set(id,{id,position,marker,part});
        this.showPart(part,occupied[id]);
      });
    });
    this.selected = [...this.slots.keys()].find(id=>!this.occupied[id]) || '1-1';
    const pick = beltTail.clone().add(new Vector3(0,gripHeight,0));
    const abovePick = pick.clone().setY(.538);
    const qSafe = downwardGrip();
    const qPick = downwardGrip(-Math.PI/2);
    this.safePose = robot.solveTarget(robot.base.worldToLocal(safe.clone()),qSafe,[0,0,0,0,90,0]);
    if (!this.safePose) throw Error('无法定位 S06 搬运安全点');
    this.pickMoves = this.plan([
      ['带尾取料点上方',abovePick,qPick],['带尾取料点',pick,qPick],['grip'],
      ['带尾取料点上方',abovePick,qPick],['安全点',safe,qSafe]
    ],this.safePose);
    const base = robot.base.getWorldPosition(new Vector3());
    for (const slot of this.slots.values()) {
      const seat = slot.position.clone().add(new Vector3(0,gripHeight,0));
      const above = seat.clone().add(new Vector3(0,lift,0));
      const inward = above.clone().sub(base).setY(0).normalize();
      const front = above.clone().addScaledVector(inward,-.14);
      const qSeat = downwardGrip(Math.atan2(-inward.z,inward.x));
      slot.moves = this.plan([
        ['仓前',front,qSeat],['仓位上方',above,qSeat],['仓位放料点',seat,qSeat],['release'],
        ['仓位上方',above,qSeat],['撤回仓前',front,qSeat],['安全点',safe,qSafe]
      ],this.pickMoves.at(-1).path.at(-1));
    }
    this.refresh('选择空仓位，在 S05 带尾放料');
  }

  plan(targets,start) {
    return targets.map(([label,position,rotation])=>{
      if (!position) return {action:label};
      const goal = this.robot.base.worldToLocal(position.clone());
      const path = this.robot.planLinear(goal,rotation,start);
      if (!path) throw Error('无法定位 S06 '+label);
      start = path.at(-1);
      return {label,path};
    });
  }

  showPart(part,color) {
    part.visible = Boolean(color);
    part.userData.stationHidden = !color;
    part.traverse(node=>{if (node.isMesh) node.material = this.materials[color || 'yellow'];});
  }

  select(id) {
    if (this.busy || this.part || !this.slots.has(id)) return;
    this.selected = id;
    this.refresh(this.occupied[id]?'仓位 '+id+' 已占用，请选空位':'已选择仓位 '+id);
  }

  stage(color) {
    if (this.busy || this.part || this.occupied[this.selected]) return;
    this.robot.cancel();
    const free = this.slots.get(this.selected);
    this.part = free.part;
    this.context.add(this.part);
    this.part.userData.storageSlot = undefined;
    this.part.position.copy(beltTail);
    this.color = color;
    this.showPart(this.part,color);
    this.refresh(colorName[color]+'料块已在 S05 带尾，可开始入库');
  }

  run(continuous) {
    if (this.busy || !this.part || (this.index===0 && this.occupied[this.selected])) return;
    this.busy = true;
    if (this.index===0) {
      this.moves = [{label:'安全点',path:[this.robot.angles.slice(),this.safePose]},
        ...this.pickMoves,...this.slots.get(this.selected).moves];
    }
    const next = () => {
      this.index++;
      if (this.index===this.moves.length) {
        const completed = this.selected;
        this.part = null;
        this.index = 0;
        this.busy = false;
        this.selected = [...this.slots.keys()].find(id=>!this.occupied[id]) || completed;
        this.refresh('已入库 '+completed+(Object.keys(this.occupied).length===15?'，仓库已满':''));
      } else if (continuous) {
        this.move(next);
      } else {
        this.busy = false;
        this.refresh('单步完成');
      }
    };
    this.move(next);
  }

  move(done) {
    const {action,label,path} = this.moves[this.index];
    if (path) {
      this.refresh('正在前往'+label);
      this.robot.animate(path,this.index===0?1100:Math.max(390,(path.length-1)*28),'到达'+label,done);
      return;
    }
    const close = action==='grip';
    const part = this.part;
    this.refresh(close?'圆弧夹爪正在夹紧':'料块已落座，夹爪正在张开');
    if (!close) {
      this.shelves.attach(part);
      part.position.copy(this.slots.get(this.selected).position);
      part.quaternion.identity();
    }
    const start = performance.now();
    const tick = now => {
      const p = Math.min(1,Math.max(0,(now-start)/320));
      this.robot.setGrip(close?p:1-p);
      this.viewer.draw();
      this.frame = p===1?null:requestAnimationFrame(tick);
      if (p!==1) return;
      if (close) this.robot.chain[5].attach(part);
      else {
        part.userData.storageSlot = this.selected;
        this.occupied[this.selected] = this.color;
      }
      done();
    };
    this.frame = requestAnimationFrame(tick);
  }

  refresh(status) {
    for (const [id,{marker}] of this.slots) {
      marker.material.color.setHex(this.occupied[id]?0x187052:id===this.selected?0xc47a12:0x6b8077);
    }
    const hasFree = Object.keys(this.occupied).length<this.slots.size;
    this.report({
      selected:this.selected,occupied:{...this.occupied},status,
      locked:this.busy || Boolean(this.part),canSelect:!this.busy && !this.part,
      canStage:!this.busy && !this.part && hasFree && !this.occupied[this.selected],
      canRun:!this.busy && Boolean(this.part),
      next:!this.busy && this.part ? this.moves?.[this.index]?.label ||
        ({grip:'夹紧',release:'松开放料'})[this.moves?.[this.index]?.action] || '安全点' : ''
    });
    this.viewer.draw();
  }

  reset() {
    this.dispose();
    this.occupied = {};
    this.part = null;
    this.index = 0;
    this.busy = false;
    this.selected = '1-1';
    for (const [id,{part,position}] of this.slots) {
      this.shelves.add(part);
      part.position.copy(position);
      part.quaternion.identity();
      part.userData.storageSlot = id;
      this.showPart(part);
    }
    this.robot.setGrip(0);
    this.robot.reset();
    this.refresh('仓库已清空，可重新放料');
  }

  dispose() {
    if (this.frame!=null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.robot.cancel();
  }
}
