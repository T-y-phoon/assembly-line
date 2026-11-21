import {Vector3} from 'three';
import {bindRotation, splitMotorShaft} from './motion-geometry.js';

const rotaryPath = '#1828893/#1828999';
const conveyorPath = '#1828893/#1829000';
const rotary = id => rotaryPath+'/#182'+id;
const conveyor = id => conveyorPath+'/#182'+id;

export const machiningCylinders = [
  {id:'upper', name:'中间气缸 · 推出料芯', paths:[rotary(9063),rotary(9068)],
   travel:.066, speed:.035, rodZ:-1},
  {id:'lower', name:'底部气缸 · 夹紧料块', paths:[rotary(9062),rotary(9075)],
   travel:.066, speed:.035, rodZ:-1},
  {id:'vertical', name:'上方气缸 · 压入料芯', paths:[rotary(9073),rotary(9071)],
   travel:.038, speed:.025, rodZ:1,
   extendButton:'下降', retractButton:'上升', extendEnd:'下限（伸出）', retractEnd:'上限（缩回）'},
  {id:'conveyor', name:'输送带推料气缸', paths:[conveyor(9035),conveyor(9033)],
   travel:.076, speed:.038, rodZ:-1}
].map(config => ({
  // The modeled rods are exposed up to the gland face. Retraction uses the
  // measured axial clearance to the moving attachment, minus a small margin.
  ...config, home:config.travel, initial:0
}));

const motorPath = rotary(9100);
const pinionPath = rotary(9082);
const gearPath = rotary(9044);
const tablePaths = [9043,9047,9051,9052,9053].map(rotary);
export const gearRatio = 16/120;
export const tableCenter = new Vector3(-.33042672,.37104,-.49703945);

function lookup(viewer, path) {
  const node = viewer.objects.get(path);
  if (!node) throw Error('加工单元缺少组件 '+path);
  return node;
}

export class RotaryDemo {
  constructor(viewer, report) {
    this.viewer = viewer;
    this.report = report;
    const motor = lookup(viewer,motorPath);
    // Centers measured from the circular GLB meshes, in world metres.
    const inputCenter = new Vector3(-.41542674,.36478,-.49705485);
    this.input = [...splitMotorShaft(motor,(triangle,vertex)=>triangle.some(index=>vertex(index).y>.353)),lookup(viewer,pinionPath)].map(node=>bindRotation(node,inputCenter));
    this.output = [gearPath,...tablePaths].map(path=>bindRotation(lookup(viewer,path),tableCenter));
    this.motorAngle = 0;
    this.frame = null;
    this.show('已停止');
  }

  get tableAngle() {
    return -this.motorAngle*gearRatio;
  }

  show(status) {
    for (const spin of this.input) spin(this.motorAngle);
    for (const spin of this.output) spin(this.tableAngle);
    this.report(this.motorAngle*180/Math.PI,this.tableAngle*180/Math.PI,status);
    this.viewer.draw();
  }

  run(direction, index = false) {
    this.drive(direction,index ? (Math.PI/2)/gearRatio : Infinity,'转盘已转 90°');
  }

  returnHome() {
    const offset = Math.atan2(Math.sin(this.tableAngle),Math.cos(this.tableAngle));
    this.drive(Math.sign(offset)||1,Math.abs(offset)/gearRatio,'转盘已回原点');
  }

  drive(direction, limit, completion) {
    this.stop();
    const speed = Math.PI*1.5;
    const origin = this.motorAngle;
    const running = direction>0?'电机正转':'电机反转';
    const started = performance.now();
    const tick = now => {
      const delta = Math.min(limit,Math.max(0,now-started)*speed/1000);
      this.motorAngle = origin + direction*delta;
      this.frame = delta===limit ? null : requestAnimationFrame(tick);
      this.show(delta===limit ? completion : running);
    };
    this.frame = requestAnimationFrame(tick);
    this.show(running);
  }

  stop() {
    if (this.frame!==null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  reset() {
    this.stop();
    this.motorAngle = 0;
    this.show('已停止');
  }
}
