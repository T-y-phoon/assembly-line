import {Matrix3, Vector3} from 'three';

export const detectionPusher = {
  paths:['#1828894/#1828965','#1828894/#1828963'],
  travel:.076, home:.076, initial:0, speed:.038,
  extendEnd:'伸出到位', retractEnd:'缩回到位'
};

export class PusherDemo {
  constructor(viewer, report, config) {
    this.viewer = viewer;
    this.report = report;
    const nodes = config.paths.map(path => {
      const node = viewer.objects.get(path);
      if (!node) throw Error('气缸运动组件缺失：'+path);
      return node;
    });
    this.travel = config.travel;
    this.speed = config.speed;
    this.home = config.home ?? 0;
    this.initial = config.initial ?? this.home;
    this.extendEnd = config.extendEnd ?? '示意伸出到位';
    this.retractEnd = config.retractEnd ?? (this.home===0?'原模型位置':'示意缩回到位');
    const rod = nodes[0];
    rod.updateWorldMatrix(true, false);
    const worldAxis = new Vector3(0, 0, config.rodZ ?? -1).transformDirection(rod.matrixWorld);
    this.parts = nodes.map(node => {
      node.updateWorldMatrix(true, false);
      const inverse = new Matrix3().setFromMatrix4(node.parent.matrixWorld).invert();
      return {node, origin:node.position.clone(), axis:worldAxis.clone().applyMatrix3(inverse)};
    });
    this.distance = this.initial;
    this.frame = null;
    if (this.initial!==this.home) this.apply();
    this.report(this.distance*1000, this.initial===this.home ? '原模型位置' : this.retractEnd);
  }

  apply() {
    for (const {node, origin, axis} of this.parts) {
      node.position.copy(origin).addScaledVector(axis, this.distance-this.home);
    }
    this.viewer.draw();
  }

  setDistance(distance, status) {
    this.distance = distance;
    this.apply();
    this.report(distance*1000,status ?? (distance===0 ? this.retractEnd : this.extendEnd));
  }

  move(direction) {
    this.stop();
    const end = direction>0 ? this.travel : 0;
    const origin = this.distance;
    const started = performance.now();
    const tick = now => {
      const advanced = Math.min(Math.abs(end-origin), Math.max(0, now-started)*this.speed/1000);
      const done = advanced>=Math.abs(end-origin);
      const endpoint = direction>0 ? this.extendEnd : this.retractEnd;
      this.frame = done ? null : requestAnimationFrame(tick);
      this.setDistance(done ? end : origin + direction*advanced, done ? endpoint : (direction>0?'伸出中':'缩回中'));
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    if (this.frame!==null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  reset() {
    this.stop();
    this.distance = this.initial;
    this.apply();
    this.report(this.distance*1000, this.initial===this.home ? '原模型位置' : this.retractEnd);
  }
}
