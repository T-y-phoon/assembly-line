import {Box3, Vector3} from 'three';
import {LineViewer} from './line-viewer.js?v=s01-transfer';

import {guides} from './lesson-data.js?v=s05-pid';
import {PusherDemo} from './pusher-demo.js';
import {feedCylinders} from './feed-cylinders.js?v=s01-transfer';
import {machiningCylinders, RotaryDemo} from './machining-demo.js';
import {MachiningProcess} from './machining-process.js';
import {BufferMotion, rails} from './buffer-motion.js';
import {RobotMotion, robots} from './robot-motion.js?v=s06-rack';
import {DetectionDemo} from './detection-demo.js?v=s01-transfer';
import {FeedTransfer, fitFeedRod, transferAssets} from './feed-transfer.js?v=s06-rack';
import {StorageTransfer, storageAssets} from './storage-transfer.js?v=s06-rack';
import {HeatingDemo, heatingCover, heatingDefaults} from './heating-demo.js?v=s05-pid';
import {renderHeatingTrend} from './heating-trend.js?v=s05-pid';

const $ = id => document.getElementById(id);
const line = () => !station;
const toStation = id => '#/station/'+id;
const overviewViews = [['line','整线'], ['top','俯视'], ['focus','聚焦工位']];
const stationViews = [['equipment','台面机构'], ['station','整站'], ['top','俯视']];
let index, viewer, station, selectedStation, selectedPart, catalog, view, task;
let lessonStep = -1, lessonDirection, isolated, demo;
const feedDemos = [];
const machiningDemos = [];
const feedPath = '#1828888';
let rotaryDemo, machiningProcess, bufferMotion, robotMotion;
let feedTransfer, transferContext, transferredColor, transferStock;
let storageTransfer, storageOccupancy;
let heatingDemo, shownHeatPoint;
let routed = false;
const hiddenParts = new Set();
const stationButtons = new Map();
const partButtons = new Map();
const viewButtons = new Map();

function status(message = '', retry = false) {
  $('load-panel').hidden = !message;
  $('status').textContent = message;
  $('retry').hidden = !retry;
}

function stationVisibility() {
  const through = view==='feed' ? [feedPath] : station.topLevelPaths.slice(1,-1);
  const visible = new Set(through.map(path=>viewer.objects.get(path)));
  if (view==='transfer') visible.add(transferContext);
  return {
    visible: view==='station' ? transferContext ? new Set(station.topLevelPaths.map(path=>viewer.objects.get(path))) : null : visible,
    isolated: viewer.objects.get(isolated),
    hidden: view==='heat' ? new Set([...hiddenParts,...heatingCover]) : hiddenParts
  };
}

function viewFrame() {
  if (!viewer.model) return;
  for (const [id, button] of viewButtons) {
    button.setAttribute('aria-pressed', id===view);
    button.disabled = id==='focus' && !selectedStation;
  }
  const top = view==='top';
  if (line()) {
    const focus = view==='focus' && selectedStation;
    let target;
    if (focus) {
      const bounds = new Box3(...focus.mountBounds.map(point=>new Vector3(...point)));
      bounds.max.y = focus.detailBounds[1][1];
      target = bounds;
    }
    viewer.frame({target, direction:top?[.00001,1,0]:[1,1.48,.23], padding:focus?1.16:1.09});
    return;
  }
  const visibility = stationVisibility();
  const selected = viewer.objects.get(selectedPart);
  let target;
  if (selected && (isolated || lessonDirection)) {
    target = new Box3().setFromObject(selected);
    const center = target.getCenter(new Vector3());
    const margin = isolated ? .035 : .105;
    target.expandByPoint(center.clone().addScalar(margin));
    target.expandByPoint(center.clone().addScalar(-margin));
  }
  if (view==='press' && !target) {
    target = new Box3(new Vector3(-.449,.339,-.518),new Vector3(-.235,.542,-.284));
  }
  if (view==='heat' && !target) {
    target = new Box3(new Vector3(-.32,.28,-1.766),new Vector3(-.026,.747,-1.184));
  }
  if (view==='transfer' && !target) {
    target = station.id==='S06' ? new Box3(new Vector3(-.58,.245,-2.61),new Vector3(.16,.89,-1.65)) :
      new Box3(new Vector3(-.60,.245,.345),new Vector3(.15,.94,1.31));
  }
  const direction = view==='heat' ? [1,.96,.30] : view==='feed' ? [1,1.35,.75] : view==='drive' ? [-1,.38,.45] :
    view==='press' ? [1,.72,-.36] : view==='transfer' ? (station.id==='S06' ? [1,.58,.48] : [1,1.15,.23]) :
    top ? [.00001,1,0] : guides[station.id].direction;
  viewer.frame({...visibility, target, direction:lessonDirection || direction,
                padding:view==='station'?1.10:1.18});
}

function showStation(item, focus = false) {
  selectedStation = item;
  for (const [id, button] of stationButtons) button.setAttribute('aria-pressed', id===item?.id);
  $('selection').textContent = item ? item.id+' '+item.teachingName : '从整线选择工位';
  $('description').textContent = item ? guides[item.id].summary : '点击模型中的台面，或从上方工位目录选择。';
  $('open-station').hidden = !item;
  if (item) $('open-station').href = toStation(item.id);
  viewButtons.get('focus').disabled = !item;
  viewer.highlight(item?.id);
  if (focus && item) {
    view = 'focus';
    viewFrame();
  }
}

function showPart(path) {
  selectedPart = path;
  const picked = viewer.objects.get(path);
  const part = catalog.get(path);
  const component = picked?.userData;
  if (path && view!=='station' && [station.topLevelPaths[0], station.topLevelPaths.at(-1)].some(root=>path===root || path.startsWith(root+'/'))) {
    view = 'station';
    viewFrame();
  } else if (path && view==='feed' && path!==feedPath && !path.startsWith(feedPath+'/')) {
    view = 'equipment';
    viewFrame();
  }
  viewer.highlight(path);
  $('selection').textContent = part?.name || component?.cadName || station.teachingName;
  $('description').textContent = part?.note || (picked ? '已在模型中标出该装配。' : guides[station.id].summary);
  const source = $('component-source');
  source.textContent = part?.source ? '依据 · '+part.source : '';
  source.hidden = !part?.source;
  $('component-path').textContent = component?.componentId || '';
  $('component-path').hidden = !component?.componentId;
  $('clear').hidden = !path;
  $('isolate').disabled = !path;
  $('isolate').setAttribute('aria-pressed', Boolean(isolated));
  $('hide-part').disabled = !path;
  for (const [id, button] of partButtons) {
    button.setAttribute('aria-pressed', id===path);
    const hidden = [...hiddenParts].some(part=>id===part || id.startsWith(part+'/'));
    button.querySelector('small').hidden = !hidden;
  }
}

function selectPart(path, direction) {
  const adjustView = Boolean(lessonDirection || isolated || direction);
  lessonDirection = direction;
  if (isolated !== path) isolated = null;
  for (const hidden of hiddenParts) {
    if (path===hidden || path?.startsWith(hidden+'/')) hiddenParts.delete(hidden);
  }
  showPart(path);
  viewer.setVisibility(stationVisibility());
  if (adjustView) viewFrame();
  if (!path) return;
  const step = guides[station.id].parts.findIndex(part=>part[0]===path);
  if (step!==-1) lessonStep = step;
  updateLesson();
}

function updateLesson() {
  const count = guides[station.id].parts.length;
  $('lesson-step').textContent = lessonStep<0 ? count+' 步' : (lessonStep+1)+' / '+count;
  $('lesson-prev').disabled = lessonStep<=0;
  $('lesson-next').disabled = lessonStep===count-1;
  $('lesson-next').textContent = lessonStep<0 ? '开始讲解' : '下一步';
}

function goToStep(delta) {
  const parts = guides[station.id].parts;
  lessonStep = Math.max(0, Math.min(parts.length-1, lessonStep+delta));
  const [path,,,,direction] = parts[lessonStep];
  view = 'equipment';
  selectPart(path,direction);
}

function buildStrip() {
  stationButtons.clear();
  $('stations').replaceChildren();
  for (const item of index.stations) {
    const element = document.createElement(line()?'button':'a');
    element.className = 'station-item';
    if (line()) {
      element.type = 'button';
      element.setAttribute('aria-pressed', 'false');
      element.onclick = () => showStation(item, view==='focus');
    } else {
      element.href = toStation(item.id);
      if (item===station) element.setAttribute('aria-current','page');
    }
    const number = document.createElement('span');
    number.textContent = item.id;
    const name = document.createElement('span');
    name.textContent = item.teachingName;
    element.append(number,name);
    $('stations').append(element);
    stationButtons.set(item.id,element);
  }
}

function buildViewButtons() {
  viewButtons.clear();
  $('views').replaceChildren();
  const additions = station?.id==='S01' ? [['feed','供料单元'],['transfer','搬运视角']] : station?.id==='S02' ? [['drive','传动侧']] :
    station?.id==='S03' ? [['press','加工侧']] : station?.id==='S05' ? [['heat','炉内观察']] :
    station?.id==='S06' ? [['transfer','搬运视角']] : [];
  const choices = line() ? overviewViews : [...stationViews,...additions];
  for (const [id,label] of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = true;
    button.setAttribute('aria-pressed',id===view);
    button.onclick = () => {
      view = id;
      if (!line()) {
        lessonDirection = null;
        isolated = null;
        showPart();
      }
      viewFrame();
    };
    $('views').append(button);
    viewButtons.set(id,button);
  }
}

function buildFeedControls() {
  fitFeedRod(viewer,feedCylinders[1].travel);
  buildCylinderControls('feed',feedCylinders,feedDemos,() => {
    if (view!=='feed' || isolated || hiddenParts.size || selectedPart) openMechanicalView('feed');
  },()=>feedTransfer?.updateReadout());
}

function buildFeedTransfer() {
  const points = $('transfer-points');
  points.replaceChildren();
  feedTransfer = new FeedTransfer(viewer,transferContext,robotMotion,feedDemos,displayTransfer,
    color=>{transferredColor=color;},transferredColor,transferStock);
  for (const [id,point] of Object.entries(feedTransfer.points)) {
    const item = document.createElement('li');
    item.dataset.point = id;
    item.style.setProperty('--point-color','#'+point.color.toString(16).padStart(6,'0'));
    const label = document.createElement('span');
    label.textContent = point.label;
    const position = document.createElement('span');
    position.className = 'transfer-coordinate';
    position.textContent = point.base.toArray().map(value=>(value*1000).toFixed(1)).join(' / ');
    item.append(label,position);
    points.append(item);
  }
  $('transfer-controls').hidden = false;
}

function displayTransfer(state) {
  transferStock = state.stock;
  const select = $('transfer-color');
  select.disabled = !state.canFeed;
  $('transfer-feed').disabled = !state.canFeed || !state.signals[select.value];
  $('transfer-step').disabled = $('transfer-run').disabled = !state.canMove;
  $('transfer-destination').hidden = !state.delivered;
  const status = state.canFeed && !state.signals[select.value]?'所选料仓缺料，推料已禁用':state.status;
  if ($('transfer-status').textContent!==status) $('transfer-status').textContent = status;
  $('transfer-next').textContent = state.next && state.canMove ? '下一步 · '+state.next : '';
  for (const sensor of $('feed-signals').children) {
    const id = sensor.dataset.signal;
    sensor.dataset.active = state.signals[id];
    sensor.querySelector('b').textContent = state.signals[id]?'ON':'OFF';
    if (id in state.stock) {
      sensor.querySelector('small').textContent = state.signals[id]?'有料 · '+state.stock[id]+' 块':'缺料';
      $('feed-stock-'+id).value = state.stock[id];
      $('feed-stock-'+id).disabled = !state.canFeed;
    }
  }
  $('feed-confirmed-color').textContent = state.color ?
    '位置确认 · '+(state.color==='yellow'?'黄色':'蓝色')+'出料位':'位置确认 · 未到位';
  for (const row of $('transfer-points').children) {
    if (row.dataset.point===state.active) row.setAttribute('aria-current','step');
    else row.removeAttribute('aria-current');
  }
  for (const button of document.querySelectorAll('#feed-controls button,#robot-controls button')) {
    button.disabled = state.locked;
  }
}

function buildStorageTransfer() {
  const rack = $('storage-slots');
  rack.replaceChildren();
  for (const row of [3,2,1]) {
    const label = document.createElement('span');
    label.textContent = row+' 层';
    rack.append(label);
    for (let column=1;column<=5;column++) {
      const id = row+'-'+column;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiet';
      button.dataset.slot = id;
      button.textContent = id;
      button.onclick = () => {useTransferView();storageTransfer.select(id);};
      rack.append(button);
    }
  }
  storageTransfer = new StorageTransfer(viewer,transferContext,robotMotion,displayStorage,storageOccupancy);
  $('storage-controls').hidden = false;
}

function displayStorage(state) {
  storageOccupancy = state.occupied;
  $('storage-stage').disabled = !$('storage-color').value || !state.canStage;
  $('storage-color').disabled = !state.canSelect;
  $('storage-step').disabled = $('storage-run').disabled = !state.canRun;
  $('storage-status').textContent = state.status;
  $('storage-next').textContent = state.next ? '下一步 · '+state.next : '';
  $('storage-count').textContent = Object.keys(state.occupied).length+' / 15 已占用';
  for (const button of $('storage-slots').querySelectorAll('button')) {
    const id = button.dataset.slot;
    const color = state.occupied[id];
    button.dataset.color = color || '';
    button.disabled = !state.canSelect;
    button.setAttribute('aria-pressed',id===state.selected);
    button.setAttribute('aria-label','仓位 '+id+' · '+(color==='yellow'?'黄色料块':color==='blue'?'蓝色料块':'空'));
  }
  for (const button of $('robot-controls').querySelectorAll('button')) button.disabled = state.locked;
}

const heatNumberFields = ['setpoint','kp','ki','kd','manual'];
const heatPlot = $('heat-plot');

function buildHeatingControls() {
  for (const field of heatNumberFields) $('heat-'+field).value = heatingDefaults[field];
  $('heat-mode').value = heatingDefaults.mode;
  $('heat-loss').checked = heatingDefaults.loss;
  $('heating-controls').hidden = false;
  $('heating-trend').hidden = false;
  $('heating-trend').parentElement.classList.add('heat-workspace');
  view = 'heat';
  heatingDemo = new HeatingDemo(viewer,displayHeating);
}

function displayHeating(state) {
  const manually = state.config.mode==='manual';
  $('heat-gains').hidden = manually;
  $('heat-manual-field').hidden = !manually;
  $('heat-temperature').value = state.temperature.toFixed(1)+' °C';
  $('heat-power').value = state.power.toFixed(0)+'%';
  $('heat-part-temp').value = state.phase==='empty'?'—':state.partTemp.toFixed(1)+' °C';
  $('heat-start').disabled = state.running;
  $('heat-start').textContent = state.running ? '运行中' : state.time ? '继续' : '开始仿真';
  $('heat-pause').disabled = !state.running;
  $('heat-feed').disabled = !state.running || state.phase==='moving';
  $('heat-feed').textContent = state.phase==='done'?'送入下一块':'送入料块';
  const message = !state.running ? (state.time ? '仿真已暂停' : '等待启动 · 炉温 25 °C') :
    ({empty:'温控运行中，可送入料块',moving:'料块正在通过加热区',done:'料块已到带尾，显示出料温度'})[state.phase];
  if ($('heat-status').textContent!==message) $('heat-status').textContent = message;
  if (shownHeatPoint!==state.trace.at(-1)) {
    shownHeatPoint = state.trace.at(-1);
    renderHeatingTrend(heatPlot,state.trace);
  }
}

function configureHeating() {
  const config = {mode:$('heat-mode').value,loss:$('heat-loss').checked};
  for (const field of heatNumberFields) {
    const input = $('heat-'+field);
    const value = input.valueAsNumber;
    config[field] = Number.isFinite(value) ? Math.min(Number(input.max),Math.max(Number(input.min),value)) :
      heatingDemo.config[field];
    input.value = config[field];
  }
  heatingDemo.configure(config);
}

new ResizeObserver(()=>{
  if (heatingDemo) renderHeatingTrend(heatPlot,heatingDemo.trace);
}).observe(heatPlot);

function openMechanicalView(next) {
  hiddenParts.clear();
  lessonDirection = isolated = null;
  view = next;
  showPart();
  viewFrame();
}

function buildCylinderControls(panel, configs, collection, focus, onChange) {
  const controls = $(panel+'-cylinders');
  controls.replaceChildren();
  for (const config of configs) {
    const group = $('feed-cylinder-template').content.firstElementChild.cloneNode(true);
    group.id = panel+'-'+config.id;
    group.querySelector('legend').textContent = config.name;
    group.querySelector('.cylinder-spec').textContent = (config.model ? config.model+' · ' : '')+'示意行程 '+(config.travel*1000)+' mm';
    const distance = group.querySelector('output');
    const state = group.querySelector('.cylinder-state');
    const cylinder = new PusherDemo(viewer, (mm, message) => {
      distance.value = mm.toFixed(1)+' mm';
      state.textContent = message;
      onChange?.();
    },config);
    collection.push(cylinder);
    function move(direction) {
      focus(config);
      cylinder.move(direction);
    }
    const extend = group.querySelector('[data-action=extend]');
    const retract = group.querySelector('[data-action=retract]');
    if (config.extendButton) extend.textContent = config.extendButton;
    if (config.retractButton) retract.textContent = config.retractButton;
    extend.onclick = () => move(1);
    retract.onclick = () => move(-1);
    group.querySelector('[data-action=stop]').onclick = () => {
      cylinder.stop();
      state.textContent = '已停止';
      onChange?.();
    };
    controls.append(group);
  }
  $(panel+'-controls').hidden = false;
}

function buildMachiningControls() {
  rotaryDemo = new RotaryDemo(viewer, (input, output, message) => {
    $('motor-angle').value = input.toFixed(1)+'°';
    $('table-angle').value = output.toFixed(1)+'°';
    $('motor-state').textContent = message;
    machiningProcess?.refresh(false);
  });
  buildCylinderControls('machining',machiningCylinders,machiningDemos,showMechanismContext,()=>{
    if (!machiningProcess?.operation) machiningProcess?.refresh();
  });
  const cylinders = Object.fromEntries(machiningCylinders.map(({id},i)=>[id,machiningDemos[i]]));
  machiningProcess = new MachiningProcess(viewer,rotaryDemo,cylinders,displayMachining);
}

function buildBufferControls() {
  const controls = $('buffer-groups');
  controls.replaceChildren();
  const ui = new Map();
  const entries = [
    ...rails.map(rail=>[rail.id,rail.name,'','正向','负向']),
    ['z','Z 轴 · 升降气缸','示意行程 50 mm','下降','上升'],
    ['jaw','平行夹爪','每侧示意行程 6 mm','合拢','张开'],
    ['push','推料气缸','按模型净空设定 16 mm','伸出','缩回']
  ];
  for (const [id,name,description,forward,reverse] of entries) {
    const group = $('feed-cylinder-template').content.firstElementChild.cloneNode(true);
    group.id = 'buffer-'+id;
    group.querySelector('legend').textContent = name;
    group.querySelector('.cylinder-spec').textContent = description;
    const spec = group.querySelector('.cylinder-spec');
    const distance = group.querySelector('output');
    const state = group.querySelector('.cylinder-state');
    const extend = group.querySelector('[data-action=extend]');
    const retract = group.querySelector('[data-action=retract]');
    extend.textContent = forward;
    retract.textContent = reverse;
    extend.onclick = () => {
      showMechanismContext();
      bufferMotion.move(id,1);
    };
    retract.onclick = () => {
      showMechanismContext();
      bufferMotion.move(id,-1);
    };
    group.querySelector('[data-action=stop]').onclick = () => bufferMotion.stop(id);
    let input, signals;
    if (rails.some(axis=>axis.id===id)) {
      const positioning = $('buffer-position-template').content.firstElementChild.cloneNode(true);
      const form = positioning.querySelector('form');
      input = form.querySelector('input');
      input.setAttribute('aria-label',id.toUpperCase()+' 轴目标位置（mm）');
      form.onsubmit = event => {
        event.preventDefault();
        showMechanismContext();
        bufferMotion.moveTo(id,input.valueAsNumber);
      };
      positioning.querySelector('.axis-home').onclick = () => {
        input.value = '0';
        showMechanismContext();
        bufferMotion.moveTo(id,0);
      };
      signals = positioning.querySelectorAll('[data-signal]');
      group.append(positioning);
    }
    controls.append(group);
    ui.set(id,{distance,state,input,spec,signals});
  }
  bufferMotion = new BufferMotion(viewer,(id,mm,message,turns,active) => {
    const {distance,state,signals} = ui.get(id);
    const rotation = turns===undefined ? '' : ' · 丝杆 '+turns.toFixed(2)+' 转';
    distance.value = mm.toFixed(1)+' mm'+rotation;
    state.textContent = message;
    if (signals) for (const light of signals) {
      const on = active[light.dataset.signal];
      if (light.dataset.active===String(on)) continue;
      light.dataset.active = on;
      light.querySelector('b').textContent = on ? 'ON' : 'OFF';
    }
  });
  for (const rail of rails) {
    const {min,max} = bufferMotion.axes.get(rail.id);
    const {input,spec} = ui.get(rail.id);
    input.min = min;
    input.max = max;
    spec.textContent = min.toFixed(1)+' 至 +'+max.toFixed(1)+' mm（相对原点）';
  }
  $('buffer-controls').hidden = false;
}

function setRobotMode(base) {
  $('robot-joint-mode').setAttribute('aria-pressed',!base);
  $('robot-base-mode').setAttribute('aria-pressed',base);
  $('robot-joint-panel').hidden = base;
  $('robot-base-panel').hidden = !base;
}

function buildRobotControls(root) {
  function addRows(container,axes,action) {
    container.replaceChildren();
    return axes.map((axis,index) => {
      const row = document.createElement('div');
      row.className = 'robot-row';
      row.dataset.axis = axis.toLowerCase();
      const label = document.createElement('span');
      label.textContent = axis;
      const value = document.createElement('output');
      value.setAttribute('aria-live','off');
      row.append(label,value);
      for (const sign of [-1,1]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quiet';
        button.textContent = sign<0?'−':'+';
        button.setAttribute('aria-label',axis+button.textContent);
        button.onclick = () => {
          if (view==='feed') openMechanicalView('equipment');
          else showMechanismContext();
          action(index,sign);
        };
        row.append(button);
      }
      container.append(row);
      return value;
    });
  }
  const angles = addRows($('robot-joints'),['J1','J2','J3','J4','J5','J6'],
    (i,sign)=>robotMotion.jogJoint(i,sign*Number($('robot-joint-step').value)));
  const components = ['x','y','z'];
  const points = addRows($('robot-base-axes'),['X','Y','Z'],
    (i,sign)=>robotMotion.jogBase(components[i],sign*Number($('robot-base-step').value)));
  robotMotion = new RobotMotion(viewer,root,(joint,point,message) => {
    joint.forEach((value,i)=>{angles[i].value=value.toFixed(1)+'°';});
    components.forEach((axis,i)=>{points[i].value=point[axis].toFixed(1)+' mm';});
    $('robot-position').value = components.map(axis=>axis.toUpperCase()+' '+point[axis].toFixed(1)).join(' · ');
    if ($('robot-status').textContent!==message) $('robot-status').textContent = message;
  });
  for (const button of $('robot-controls').querySelectorAll('button')) button.disabled = false;
  setRobotMode(false);
  $('robot-controls').open = true;
  $('robot-controls').hidden = false;
}
function buildPartButtons() {
  $('parts').replaceChildren();
  partButtons.clear();
  const items = [
    ...guides[station.id].parts,
    [station.topLevelPaths.at(-1),'操作面板','面板集中布置操作件和指示件。可对照按钮与指示灯的安装位置。','操作面板子件名称与排列'],
    [station.topLevelPaths[0],'工位柜体','柜体承托台面设备，柜门提供内部安装区的检修入口。','柜体装配与门板位置']
  ];
  catalog = new Map(items.map(([path,name,note,source])=>[path,{name,note,source}]));
  for (const [path, {name}] of catalog) {
    if (!viewer.objects.has(path)) throw Error('缺少组件 '+path);
    const button = document.createElement('button');
    button.type = 'button';
    const label = document.createElement('span');
    label.textContent = name;
    const badge = document.createElement('small');
    badge.textContent = '已隐藏';
    badge.hidden = true;
    button.append(label, badge);
    button.setAttribute('aria-pressed','false');
    button.onclick = () => selectPart(path);
    $('parts').append(button);
    partButtons.set(path,button);
  }
}

function pick(node) {
  if (!node) return;
  if (line()) {
    for (let object = node; object; object = object.parent) {
      const item = index.stations.find(s=>s.id===object.userData.stationId);
      if (item) { showStation(item); return; }
    }
  } else {
    let path;
    for (let object = node; object; object = object.parent) {
      if (object.userData.storageSlot && storageTransfer) {
        useTransferView();
        storageTransfer.select(object.userData.storageSlot);
        return;
      }
      const current = object.userData.sourcePath;
      if (catalog.has(current)) { selectPart(current); return; }
      path ||= current;
    }
    selectPart(path);
  }
}

async function route(force = false) {
  if (!index || !viewer) return;
  const hash = location.hash;
  const id = /^#\/station\/(S\d{2})$/.exec(hash)?.[1];
  const next = index.stations.find(item=>item.id===id);
  if (!next && hash!=='#/line') history.replaceState(null,'','#/line');
  if (routed && station===next && !force) return;
  const returning = routed && station && !next;
  routed = true;
  task?.abort();
  const controller = new AbortController();
  const {signal} = controller;
  task = controller;
  demo?.dispose();
  demo = null;
  heatingDemo?.dispose();
  heatingDemo = null;
  shownHeatPoint = null;
  storageTransfer?.dispose();
  storageTransfer = null;
  feedTransfer?.dispose();
  feedTransfer = transferContext = null;
  machiningProcess?.dispose();
  machiningProcess = null;
  for (const cylinder of feedDemos.splice(0)) cylinder.stop();
  for (const cylinder of machiningDemos.splice(0)) cylinder.stop();
  rotaryDemo?.stop();
  rotaryDemo = null;
  bufferMotion?.dispose();
  bufferMotion = null;
  robotMotion?.cancel();
  robotMotion = null;
  $('feed-cylinders').replaceChildren();
  $('machining-cylinders').replaceChildren();
  viewer.clear();
  station = next;
  if (station) selectedStation = station;
  selectedPart = null;
  isolated = null;
  lessonDirection = null;
  lessonStep = -1;
  hiddenParts.clear();
  view = station ? 'equipment' : returning ? 'focus' : 'line';
  $('trail-station').hidden = !station;
  $('trail-station').textContent = station ? station.id+' '+station.teachingName : '';
  $('back-to-line').hidden = !station;
  $('title').textContent = station?.teachingName || '131 产线总览';
  $('intro').textContent = station ? guides[station.id].summary : '从供料端到立体库，查看六座工位及其安装位置。';
  document.title = $('title').textContent+' · 三维课堂';
  $('aside-label').textContent = station ? station.id+' · 当前选择' : '工作站';
  $('structure').hidden = true;
  $('lesson').hidden = true;
  $('demonstration').hidden = true;
  $('transfer-controls').hidden = true;
  $('storage-controls').hidden = true;
  $('heating-controls').hidden = true;
  $('heating-trend').hidden = true;
  $('heating-trend').parentElement.classList.remove('heat-workspace');
  $('feed-controls').hidden = true;
  $('machining-controls').hidden = true;
  $('buffer-controls').hidden = true;
  $('robot-controls').hidden = true;
  $('component-source').hidden = true;
  $('open-station').hidden = true;
  $('component-path').hidden = true;
  $('reset').disabled = true;
  buildStrip();
  buildViewButtons();
  if (station) {
    $('selection').textContent = station.teachingName;
    $('description').textContent = guides[station.id].summary;
  } else {
    showStation(selectedStation);
    $('open-station').hidden = true;
  }
  status(station ? '正在加载 '+station.id+' 模型…' : '正在加载整线模型…');
  try {
    const url = new URL('./assets/'+(station?.detailFile || index.overviewFile),location.href);
    if (!await viewer.load(url,signal) || signal.aborted) return;
    if (station) {
      buildPartButtons();
      showPart();
      $('question').textContent = guides[station.id].question;
      $('question').parentElement.open = false;
      updateLesson();
      $('lesson').hidden = false;
      if (station.id==='S02') {
        demo = new DetectionDemo(viewer,displayDetection);
        if (transferredColor) {
          $('sample-color').value = transferredColor;
          $('sample-core').checked = false;
        }
        demo.configure($('sample-color').value,$('sample-core').checked);
        $('demonstration').hidden = false;
      }
      if (station.id==='S03') buildMachiningControls();
      if (station.id==='S04') buildBufferControls();
      if (station.id==='S05') buildHeatingControls();
      if (robots[station.id]) buildRobotControls(robots[station.id]);
      if (station.id==='S01') {
        buildFeedControls();
        status('正在加载 S02 传送带…');
        const beltUrl = new URL('./assets/S02.glb',location.href);
        const context = await viewer.loadContext(beltUrl,signal,transferAssets);
        if (!context || signal.aborted) return;
        transferContext = context;
        buildFeedTransfer();
      }
      if (station.id==='S06') {
        status('正在加载 S05 传送带…');
        const beltUrl = new URL('./assets/S05.glb',location.href);
        const context = await viewer.loadContext(beltUrl,signal,storageAssets);
        if (!context || signal.aborted) return;
        transferContext = context;
        view = 'transfer';
        buildStorageTransfer();
      }
      $('structure').hidden = false;
    } else {
      showStation(selectedStation);
    }
    viewFrame();
    $('reset').disabled = false;
    status();
  } catch (error) {
    if (!signal.aborted) {
      status('模型加载失败。请检查本地服务或模型文件后重试。',true);
      console.error(error);
    }
  }
}

async function start() {
  status('正在读取工位索引…');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('./assets/stations.json', {signal:controller.signal,cache:'no-cache'});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    index = await response.json();
  } catch (error) {
    status(controller.signal.aborted ? '读取工位索引超时，请重试。' : '工位索引加载失败。请检查本地服务后重试。',true);
    console.error(error);
    return;
  } finally {
    clearTimeout(deadline);
  }
  try {
    viewer = new LineViewer($('viewport'),pick);
  } catch (error) {
    status('无法建立三维视图，请使用支持 WebGL 的浏览器。');
    console.error(error);
    return;
  }
  route();
}
$('retry').onclick = () => index && viewer ? route(true) : start();
$('reset').onclick = viewFrame;
$('clear').onclick = () => selectPart();
$('lesson-prev').onclick = () => goToStep(-1);
$('lesson-next').onclick = () => goToStep(1);
$('isolate').onclick = () => {
  isolated = isolated ? null : selectedPart;
  showPart(selectedPart);
  viewFrame();
};
$('hide-part').onclick = () => {
  hiddenParts.add(selectedPart);
  isolated = null;
  lessonDirection = null;
  showPart();
  viewer.setVisibility(stationVisibility());
};
$('restore').onclick = () => {
  hiddenParts.clear();
  isolated = null;
  lessonDirection = null;
  lessonStep = -1;
  updateLesson();
  view = 'station';
  demo?.reset();
  feedTransfer?.reset();
  storageTransfer?.reset();
  heatingDemo?.reset();
  machiningProcess?.reset();
  if (bufferMotion) resetBuffer();
  if (!feedTransfer && !storageTransfer) robotMotion?.reset();
  showPart();
  viewFrame();
};
$('feed-reset').onclick = () => {
  for (const cylinder of feedDemos) cylinder.reset();
};
function useTransferView() {
  if (view!=='transfer' || isolated || hiddenParts.size || lessonDirection) openMechanicalView('transfer');
}
$('transfer-feed').onclick = () => {useTransferView();feedTransfer.feed($('transfer-color').value);};
$('transfer-color').onchange = () => feedTransfer.updateReadout();
for (const color of ['yellow','blue']) {
  $('feed-stock-'+color).onchange = event => feedTransfer.setStock(color,Number(event.target.value));
}
$('transfer-step').onclick = () => {useTransferView();feedTransfer.run(false);};
$('transfer-run').onclick = () => {useTransferView();feedTransfer.run(true);};
$('transfer-reset').onclick = () => feedTransfer.reset();
$('storage-stage').onclick = () => {useTransferView();storageTransfer.stage($('storage-color').value);};
$('storage-step').onclick = () => {useTransferView();storageTransfer.run(false);};
$('storage-run').onclick = () => {useTransferView();storageTransfer.run(true);};
$('storage-reset').onclick = () => storageTransfer.reset();
$('heat-start').onclick = () => {showMechanismContext();heatingDemo.start();};
$('heat-pause').onclick = () => heatingDemo.pause();
$('heat-reset').onclick = () => heatingDemo.reset();
$('heat-feed').onclick = () => {showMechanismContext();heatingDemo.loadPart();};
for (const field of [...heatNumberFields,'mode','loss']) $('heat-'+field).onchange = configureHeating;
$('machining-reset').onclick = () => machiningProcess.reset();
function showMechanismContext() {
  if (isolated || hiddenParts.size || lessonDirection) openMechanicalView(view);
}
function runMotor(direction, index = false) {
  if (!machiningProcess.state.canIndex) return;
  showMechanismContext();
  rotaryDemo.run(direction,index);
}
$('motor-forward').onclick = () => runMotor(1);
$('motor-reverse').onclick = () => runMotor(-1);
$('motor-index-forward').onclick = () => runMotor(-1,true);
$('motor-index-reverse').onclick = () => runMotor(1,true);
$('motor-home').onclick = () => {
  if (!machiningProcess.state.canIndex) return;
  showMechanismContext();
  rotaryDemo.returnHome();
};
$('motor-stop').onclick = () => {
  rotaryDemo.stop();
  $('motor-state').textContent = '已停止';
  machiningProcess.refresh();
};
function displayMachining(state) {
  for (const action of ['Place','Convey','Push','Clamp','Insert','Press','Release']) {
    $('machining-'+action.toLowerCase()+'-sample').disabled = !state['can'+action];
  }
  $('machining-incoming-core').disabled = !state.canPlace;
  for (const id of ['forward','reverse','index-forward','index-reverse']) {
    $('motor-'+id).disabled = !state.canIndex;
  }
  $('motor-stop').disabled = !state.spinning;
  $('motor-home').disabled = !state.canIndex || (state.home && !state.spinning);
  for (const button of $('machining-cylinders').querySelectorAll('button')) button.disabled = !state.canJog;
  const descriptions = {
    arrival:state.arrival?'料块到位':state.arrived?'料块已离开检测点':'等待料块',
    home:state.home?'转盘位于原点':'转盘离开原点',
    block:state.block?'检测到料块':state.inspection!==null?'最近一次 · 有料块':'等待料块',
    core:state.block?(state.core?'有料芯':'无料芯'):state.inspection!==null?
      (state.inspection?'最近一次 · 有料芯':'最近一次 · 无料芯'):'等待检测'
  };
  for (const card of $('machining-signals').children) {
    const id = card.dataset.detector;
    card.dataset.active = state[id];
    card.querySelector('b').textContent = state[id]?'ON':'OFF';
    card.querySelector('small').textContent = descriptions[id];
  }
  $('machining-belt').value = state.beltRunning?'运行':'停止';
  if ($('machining-status').textContent!==state.message) $('machining-status').textContent = state.message;
}
const machiningActions = {
  place:()=>machiningProcess.place($('machining-incoming-core').checked),
  convey:()=>machiningProcess.convey(), push:()=>machiningProcess.push(),
  clamp:()=>machiningProcess.clamp(true), insert:()=>machiningProcess.insert(),
  press:()=>machiningProcess.press(), release:()=>machiningProcess.clamp(false)
};
for (const [action,run] of Object.entries(machiningActions)) {
  $('machining-'+action+'-sample').onclick = () => {
    showMechanismContext();
    run();
  };
}
function resetBuffer() {
  for (const input of $('buffer-groups').querySelectorAll('.axis-target input')) input.value = '0';
  bufferMotion.reset();
}
$('buffer-reset').onclick = resetBuffer;
$('robot-joint-mode').onclick = () => setRobotMode(false);
$('robot-base-mode').onclick = () => setRobotMode(true);
$('robot-stop').onclick = () => robotMotion.stop();
$('robot-reset').onclick = () => robotMotion.reset();

function displayDetection(state) {
  $('sample-color').disabled = $('sample-core').disabled = state.phase!=='ready' || Boolean(transferredColor);
  $('start-detection').disabled = state.running || !state.canStart;
  $('start-detection').textContent = state.phase==='ready' ? '启动输送' : state.canStart?'继续':'启动输送';
  $('stop-detection').disabled = !state.running;
  $('sort-detection').disabled = $('pass-detection').disabled = !state.waiting;
  $('motion-distance').value = state.stroke.toFixed(1)+' mm';
  $('detection-motor').value = state.motorsOn ? '运行' : '停止';
  const message = state.phase==='ready' && transferredColor ?
    '已接收 S01 的'+(transferredColor==='blue'?'蓝色':'黄色')+'料块' : state.status;
  if ($('detection-status').textContent!==message) $('detection-status').textContent = message;
  for (const card of $('demonstration').querySelectorAll('[data-detector]')) {
    const sensor = state.sensors[card.dataset.detector];
    card.dataset.active = sensor.on;
    card.querySelector('b').textContent = sensor.on?'ON':'OFF';
    const suffix = sensor.result==='待检测'||sensor.present?'':' · 最近一次';
    card.querySelector('small').textContent = sensor.result+suffix;
  }
}
function selectSample() {
  demo.configure($('sample-color').value,$('sample-core').checked);
}
$('sample-color').onchange = $('sample-core').onchange = selectSample;
$('start-detection').onclick = () => {showMechanismContext();transferredColor=null;demo.start();};
$('stop-detection').onclick = () => demo.stop();
$('reset-detection').onclick = () => {transferredColor=null;demo.reset();};
$('sort-detection').onclick = () => {showMechanismContext();demo.choose(true);};
$('pass-detection').onclick = () => {showMechanismContext();demo.choose(false);};
window.addEventListener('hashchange', () => route());
start();
