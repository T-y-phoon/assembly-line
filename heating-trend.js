export function renderHeatingTrend(canvas,trace) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height || !trace.length) return;
  const pixelRatio = Math.min(2,window.devicePixelRatio || 1);
  if (canvas.width!==Math.round(width*pixelRatio) || canvas.height!==Math.round(height*pixelRatio)) {
    canvas.width = Math.round(width*pixelRatio);
    canvas.height = Math.round(height*pixelRatio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  ctx.clearRect(0,0,width,height);
  ctx.font = '11px system-ui, sans-serif';
  const left = 39, right = width-28, top = 16, bottom = height-22;
  const range = bottom-top;
  const tempBottom = top+range*.62, powerTop = tempBottom+14;
  const start = Math.max(0,trace.at(-1).time-150);
  const x = time=>left+(time-start)*(right-left)/150;
  const max = Math.max(...trace.flatMap(p=>[p.temperature,p.setpoint]));
  const ceiling = Math.max(80,Math.ceil((max+2)/20)*20);
  const temperatureY = value=>tempBottom-(value-20)*(tempBottom-top)/(ceiling-20);
  const powerY = value=>bottom-value*(bottom-powerTop)/100;

  function grid(y,label) {
    ctx.beginPath();
    ctx.strokeStyle = '#d9e2db';
    ctx.lineWidth = 1;
    ctx.moveTo(left,y);
    ctx.lineTo(right,y);
    ctx.stroke();
    ctx.fillStyle = '#435c4f';
    ctx.textAlign = 'right';
    ctx.fillText(label,left-7,y+4);
  }
  for (let value=20;value<=ceiling;value+=20) grid(temperatureY(value),value+'°');
  for (const value of [0,50,100]) grid(powerY(value),value+'%');
  ctx.textAlign = 'center';
  const interval = width<470?50:30;
  for (let offset=0;offset<=150;offset+=interval) {
    const time = start+offset;
    ctx.fillText(Math.round(time)+' s',x(time),height-5);
  }

  function plot(key,y,color,dash=[]) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    trace.forEach((point,i)=>{
      if (i) ctx.lineTo(x(point.time),y(point[key]));
      else ctx.moveTo(x(point.time),y(point[key]));
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const last = trace.at(-1);
    ctx.beginPath();
    ctx.arc(x(last.time),y(last[key]),2.6,0,2*Math.PI);
    ctx.fill();
  }
  plot('setpoint',temperatureY,'#647885',[5,4]);
  plot('temperature',temperatureY,'#c2561d');
  plot('power',powerY,'#206354');
}
