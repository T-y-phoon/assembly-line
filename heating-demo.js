import {BoxGeometry, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3} from 'three';
import {worldGroup} from './detection-drive.js';
import {bindRotation, workpieceMould} from './motion-geometry.js?v=s06-rack';

const furnace = '#1828895';
const belt = '#1828896';
export const heatingCover = [8951,8955,8956,8961,8962].map(id=>furnace+'/#1828941/#182'+id);
export const heatingDefaults = {setpoint:65,kp:5.5,ki:.12,kd:3,mode:'pid',manual:34,loss:false};
const ambient = 25;
const simulationRate = 10;
const stepSize = .1;
const heatGain = 2.1;
const normalLoss = .018;
const extraLoss = .012;
const infeed = -1.225;
const outlet = -1.717;
const zoneStart = -1.298;
const zoneEnd = -1.653;
const speed = .009;
const beltX = -.20709;
const beltY = .38713;
const cold = new Color(0x256aa8), hot = new Color(0xff8125);
const limitPower = power => Math.min(100,Math.max(0,power));

export class HeatingDemo {
  constructor(viewer,report) {
    this.viewer = viewer;
    this.report = report;
    this.config = {...heatingDefaults};
    const group = worldGroup(viewer.objects.get(furnace));
    this.part = workpieceMould(viewer.objects.get(furnace+'/#1828949'));
    this.partMaterial = new MeshStandardMaterial({color:cold,roughness:.48});
    this.part.traverse(node=>{if(node.isMesh) node.material = this.partMaterial;});
    group.add(this.part);
    const zoneLength = zoneStart-zoneEnd;
    // These translucent strips mark the simulated heating region beside the CAD belt.
    this.zoneMaterial = new MeshBasicMaterial({color:0xff8429,transparent:true,depthWrite:false});
    for (const x of [beltX-.035,beltX+.035]) {
      const strip = new Mesh(new BoxGeometry(.012,.008,zoneLength),this.zoneMaterial);
      strip.position.set(x,beltY+.007,(zoneStart+zoneEnd)/2);
      strip.raycast = ()=>{};
      group.add(strip);
    }
    const beltGroup = worldGroup(viewer.objects.get(belt));
    const tread = new BoxGeometry(.020,.00035,.0013);
    const treadMaterial = new MeshBasicMaterial({color:0x737c81});
    this.marks = Array.from({length:24},()=>{
      const mark = new Mesh(tread,treadMaterial);
      beltGroup.add(mark);
      return mark;
    });
    this.rollers = [-1.20698,-1.73698].map((z,i)=>bindRotation(viewer.objects.get(belt+'/#182'+(9162+i)),
      new Vector3(beltX,.37954,z),new Vector3(1,0,0)));
    this.reset();
  }

  reset() {
    this.dispose();
    this.ticks = 0;
    this.elapsed = 0;
    this.temperature = ambient;
    this.power = 0;
    this.integral = 0;
    this.filteredRate = 0;
    this.lastRate = 0;
    this.partTemp = ambient;
    this.travel = 0;
    this.phase = 'empty';
    this.trace = [];
    this.record();
    this.show();
  }

  configure(config) {
    this.config = {...config};
    if (config.ki===0) this.integral = 0;
    this.record();
    this.show();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.show();
    this.frame = requestAnimationFrame(now=>this.advance(now));
  }

  pause() {
    this.dispose();
    this.show();
  }

  dispose() {
    if (this.frame!=null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.running = false;
  }

  loadPart() {
    if (!this.running || this.phase==='moving') return;
    this.phase = 'moving';
    this.partTemp = ambient;
    this.z = infeed;
    this.record();
    this.show();
  }

  advance(now) {
    this.elapsed += Math.max(0,Math.min(.2,(now-this.last)/1000))*simulationRate;
    this.last = now;
    while (this.elapsed>=stepSize) {
      this.elapsed -= stepSize;
      this.step();
    }
    this.show();
    this.frame = requestAnimationFrame(time=>this.advance(time));
  }

  step() {
    const {mode,manual,setpoint,kp,ki,kd,loss} = this.config;
    this.filteredRate += (this.lastRate-this.filteredRate)*stepSize/(1.5+stepSize);
    if (mode==='pid') {
      const error = setpoint-this.temperature;
      const effect = kp*error-kd*this.filteredRate;
      const nextIntegral = this.integral+ki*error*stepSize;
      const demand = effect+nextIntegral;
      // Integrate only when it can move the output toward its allowed range.
      if ((demand<=100 || error<0) && (demand>=0 || error>0)) this.integral = nextIntegral;
      this.power = limitPower(effect+this.integral);
    } else {
      this.power = manual;
    }
    const inFurnace = this.phase==='moving' && this.z<=zoneStart && this.z>=zoneEnd;
    const partLoad = inFurnace ? .0012*(this.temperature-this.partTemp) : 0;
    this.lastRate = heatGain*this.power/100-(normalLoss+(loss?extraLoss:0))*(this.temperature-ambient)-partLoad;
    this.temperature += this.lastRate*stepSize;
    if (this.phase==='moving') {
      this.partTemp += ((inFurnace?this.temperature:ambient)-this.partTemp)*(inFurnace?.033:.006)*stepSize;
      const distance = Math.min(this.z-outlet,speed*stepSize);
      this.z -= distance;
      this.travel += distance;
      if (this.z<=outlet+1e-8) this.phase = 'done';
    }
    this.ticks++;
    if (this.ticks%10===0) this.record();
  }

  get time() {
    return this.ticks*stepSize;
  }

  record() {
    this.trace.push({time:this.time,temperature:this.temperature,setpoint:this.config.setpoint,power:this.power});
    while (this.trace[0].time<this.time-150) this.trace.shift();
  }

  show() {
    const onBelt = this.phase!=='empty';
    if (this.part.userData.stationHidden!==!onBelt) {
      this.part.userData.stationHidden = !onBelt;
      this.part.visible = onBelt;
    }
    if (onBelt) this.part.position.set(beltX,beltY,this.z);
    this.partMaterial.color.copy(cold).lerp(hot,Math.max(0,Math.min(1,(this.partTemp-ambient)/55)));
    this.zoneMaterial.opacity = .12+.7*this.power/100;
    this.rollers.forEach(rotate=>rotate(-this.travel/.0075));
    this.marks.forEach((mark,i)=>mark.position.set(beltX,beltY+.00022,-1.215-(i*.514/this.marks.length+this.travel)%.514));
    this.report(this);
    this.viewer.draw();
  }
}
