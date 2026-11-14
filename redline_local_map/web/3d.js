import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadTerrainBuild, sampleTerrain } from './terrain-core.js';
const $=id=>document.getElementById(id), readout=$('readout');
const {manifest:meta,url:terrainUrl,mesh:heights,query}=await loadTerrainBuild();
const cols=meta.display.width_vertices,rows=meta.display.height_vertices,step=meta.display.cell_size_m;
const left=meta.extent.local_left_m,top=meta.extent.local_top_m;
const buildInfo=$('terrain-build');
if(buildInfo)buildInfo.textContent=`Build ${meta.build_id} · ${(meta.extent.width_m/1000).toFixed(2)} × ${(meta.extent.height_m/1000).toFixed(1)} km · ${cols} × ${rows} mesh`;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x11171a);
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,1,100000);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;$('view').appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=25;controls.maxDistance=110000;controls.maxPolarAngle=Math.PI/2-.015;
function reset(){if(typeof focusSelectedSites==='function')focusSelectedSites();else{camera.position.set(0,2500,3200);controls.target.set(0,0,0);controls.update()}}
reset();
scene.add(new THREE.HemisphereLight(0xffffff,0x56504b,2.1));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-3500,7000,4500);scene.add(sun);
const world=new THREE.Group();scene.add(world);
const positions=new Float32Array(rows*cols*3),uvs=new Float32Array(rows*cols*2),indices=[];
for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const i=r*cols+c;positions[i*3]=left+c*step;positions[i*3+1]=Number.isFinite(heights[i])?heights[i]:0;positions[i*3+2]=top-r*step;uvs[i*2]=c/(cols-1);uvs[i*2+1]=1-r/(rows-1)}
for(let r=0;r<rows-1;r++)for(let c=0;c<cols-1;c++){const a=r*cols+c,b=a+1,d=a+cols+1,e=a+cols;
  if(Number.isFinite(heights[a])&&Number.isFinite(heights[b])&&Number.isFinite(heights[e]))indices.push(a,b,e);
  if(Number.isFinite(heights[b])&&Number.isFinite(heights[d])&&Number.isFinite(heights[e]))indices.push(b,d,e)
}
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
const baseMaterial=new THREE.MeshStandardMaterial({color:0x8b7666,roughness:1,side:THREE.DoubleSide});const base=new THREE.Mesh(geometry,baseMaterial);world.add(base);
const textureLoader=new THREE.TextureLoader();
const [texture,neutralTexture,elevationTexture,slopeTexture]=await Promise.all(['hirise','neutral','elevation','slope'].map(name=>textureLoader.loadAsync(terrainUrl(name))));
for(const t of [texture,neutralTexture,elevationTexture,slopeTexture]){t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy())}
baseMaterial.color.setHex(0xffffff);baseMaterial.map=neutralTexture;baseMaterial.needsUpdate=true;
const imageMaterial=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.05,roughness:1,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});const imagery=new THREE.Mesh(geometry,imageMaterial);imagery.raycast=()=>{};world.add(imagery);
function terrainHeight(x,z){const c=(x-left)/step,r=(top-z)/step;if(c<0||r<0||c>cols-1||r>rows-1)return null;const c0=Math.min(cols-2,Math.floor(c)),r0=Math.min(rows-2,Math.floor(r)),u=c-c0,v=r-r0;const a=heights[r0*cols+c0],b=heights[r0*cols+c0+1],d=heights[(r0+1)*cols+c0],e=heights[(r0+1)*cols+c0+1];return [a,b,d,e].every(Number.isFinite)?(1-v)*((1-u)*a+u*b)+v*((1-u)*d+u*e):null}
let minTerrainH=Infinity,maxTerrainH=-Infinity;
for(let i=0;i<heights.length;i++){const v=heights[i];if(Number.isFinite(v)){if(v<minTerrainH)minTerrainH=v;if(v>maxTerrainH)maxTerrainH=v}}
if(!Number.isFinite(minTerrainH)){minTerrainH=-500;maxTerrainH=1500}
function marker(color,radius){const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,16,12),new THREE.MeshBasicMaterial({color,depthTest:true}));world.add(mesh);return mesh}
const landing=marker(0xff493f,70);let astronautXY=[0,0];
function place(mesh,x,north){const h=terrainHeight(x,north);mesh.visible=h!==null;if(h!==null)mesh.position.set(x,h+mesh.geometry.parameters.radius*.8,north)}
place(landing,0,0);
// Astronaut pin: the base ring sits on the same plane as the route ribbon.
// A floating sphere looked horizontally offset from the line at low camera
// angles because of parallax, so the ground contact point is made explicit.
const ASTRO_LIFT=10;
const astronaut=new THREE.Group();
const astroRing=new THREE.Mesh(new THREE.TorusGeometry(20,4,8,28),new THREE.MeshBasicMaterial({color:0x45dfff}));
astroRing.rotation.x=Math.PI/2;astroRing.position.y=1;
const astroBeam=new THREE.Mesh(new THREE.CylinderGeometry(5,5,150,8),new THREE.MeshBasicMaterial({color:0x45dfff,transparent:true,opacity:.7}));
astroBeam.position.y=76;
const astroOrb=new THREE.Mesh(new THREE.SphereGeometry(30,18,12),new THREE.MeshBasicMaterial({color:0x9ff6ff}));
astroOrb.position.y=158;
astronaut.add(astroRing,astroBeam,astroOrb);world.add(astronaut);
let followAstronaut=false,lastAstroPos=null;
function focusPoint(x,north,maxDist=null){
  const h=(terrainHeight(x,north)??0)*world.scale.y;
  const nextTarget=new THREE.Vector3(x,h,north);
  const offset=camera.position.clone().sub(controls.target);
  if(maxDist!==null&&offset.length()>maxDist)offset.setLength(maxDist);
  controls.target.copy(nextTarget);
  camera.position.copy(nextTarget).add(offset);
  controls.update();
}
function placeAstronaut(x,north){
  const h=terrainHeight(x,north);
  astronaut.visible=h!==null;
  if(h===null)return;
  const newY=h+ASTRO_LIFT;
  if(followAstronaut&&lastAstroPos){
    const dx=x-lastAstroPos.x,dy=(newY-lastAstroPos.y)*world.scale.y,dz=north-lastAstroPos.z;
    controls.target.x+=dx;controls.target.y+=dy;controls.target.z+=dz;
    camera.position.x+=dx;camera.position.y+=dy;camera.position.z+=dz;
  }
  astronaut.position.set(x,newY,north);
  lastAstroPos={x,y:newY,z:north};
}
placeAstronaut(0,0);
const pole=new THREE.Mesh(new THREE.CylinderGeometry(10,10,180,8),new THREE.MeshBasicMaterial({color:0xff493f}));world.add(pole);pole.position.set(0,(terrainHeight(0,0)??0)+90,0);
let envelope=[],envelopeLine=null;
function setEnvelope(points){envelope=points||[];if(envelopeLine){world.remove(envelopeLine);envelopeLine.geometry.dispose();envelopeLine.material.dispose();envelopeLine=null}if(envelope.length<2)return;
 const coords=[];for(let i=0;i<envelope.length;i++){const a=envelope[i],b=envelope[(i+1)%envelope.length],length=Math.hypot(b.x_m-a.x_m,b.y_m-a.y_m),segments=Math.max(1,Math.ceil(length/step));for(let k=0;k<segments;k++){const t=k/segments,x=a.x_m+(b.x_m-a.x_m)*t,z=a.y_m+(b.y_m-a.y_m)*t,h=terrainHeight(x,z);if(h!==null)coords.push(x,h+8,z)}}
 if(coords.length<6)return;coords.push(coords[0],coords[1],coords[2]);envelopeLine=new THREE.Line(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(coords,3)),new THREE.LineBasicMaterial({color:0x33ff96,linewidth:2,depthTest:true}));world.add(envelopeLine)
}
let imageMaskContext=null;
function hasHiRise(x,north){
 const b=meta.source_imagery.bounds,px=meta.landing.projected_x_m+x,py=meta.landing.projected_y_m+north;
 if(px<b[0]||px>=b[2]||py<=b[1]||py>b[3])return false;
 if(!imageMaskContext){const canvas=document.createElement('canvas');canvas.width=meta.texture.width_px;canvas.height=meta.texture.height_px;imageMaskContext=canvas.getContext('2d',{willReadFrequently:true});imageMaskContext.drawImage(texture.image,0,0)}
 const c=Math.floor((x-left)/meta.extent.width_m*meta.texture.width_px),r=Math.floor((top-north)/meta.extent.height_m*meta.texture.height_px);
 return c>=0&&r>=0&&c<meta.texture.width_px&&r<meta.texture.height_px&&imageMaskContext.getImageData(c,r,1,1).data[3]>0;
}
function terrainAt(x,north){const result=sampleTerrain(meta,query,x,north);if(result.status==='valid')result.imagery=hasHiRise(x,north)?'HiRISE':'no_high_resolution_imagery';return result}

// ---------------------------------------------------------------- mission --
// Coordinate contract: route points, stops and safe regions all arrive in the
// same local metre frame as terrain_build.json (+x east, +y north).
// Everything below is draped onto terrainHeight, so the overlays follow the DEM.
const RESOURCE_KEYS=['time_s','oxygen','rover_power','equipment_power'];
const ROUTE_LIFT=10, SAFE_LIFT=6, SAFE_MAX_AXIS=256;
const zeroVec=()=>({time_s:0,oxygen:0,rover_power:0,equipment_power:0});
const copyVec=v=>({time_s:v.time_s||0,oxygen:v.oxygen||0,rover_power:v.rover_power||0,equipment_power:v.equipment_power||0});
const addVec=(a,b)=>({time_s:a.time_s+b.time_s,oxygen:a.oxygen+b.oxygen,rover_power:a.rover_power+b.rover_power,equipment_power:a.equipment_power+b.equipment_power});
const lerpVec=(a,b,u)=>({time_s:a.time_s+(b.time_s-a.time_s)*u,oxygen:a.oxygen+(b.oxygen-a.oxygen)*u,rover_power:a.rover_power+(b.rover_power-a.rover_power)*u,equipment_power:a.equipment_power+(b.equipment_power-a.equipment_power)*u});
const missionGroup=new THREE.Group();world.add(missionGroup);
const ghostRouteGroup=new THREE.Group();missionGroup.add(ghostRouteGroup);
const routeGroup=new THREE.Group();missionGroup.add(routeGroup);
const stopGroup=new THREE.Group();missionGroup.add(stopGroup);
const siteGroup=new THREE.Group();missionGroup.add(siteGroup);
const hazardGroup=new THREE.Group();missionGroup.add(hazardGroup);
const hazardPreviewGroup=new THREE.Group();world.add(hazardPreviewGroup);
const measureGroup=new THREE.Group();world.add(measureGroup);
let plan=null,routePoints=[],routeSamples=[],timeline=[],missionDuration=0;
let stops=[],safeMesh=null,safeContour=null,safeTexture=null,safeMeta=null,safeFrames=[],currentFrame=-1;
let progress=0,playing=false,missionTime=0;
// Runtime replanning state. `elapsedOffset` keeps the mission clock continuous
// across replans, and `completedStops` keeps sampled pins on the map.
let hazards=[],hazardMode=null,hazardRadius=1200,hazardSeverity=1;
let apiReady=false,elapsedOffset=0,totalStops=5,replanToken=0;
const completedStops=new Map();
let scienceSeed=null,siteList=[],selectedSiteIds=[];
let defaultPlan=null,activeScenarioId='default',customScenarios=[];
let modalSeed=null,modalSites=[],modalSelectedIds=[];
const SCENARIO_STORAGE_KEY='redline_scenarios_v1';
let elevProfile=null,lastPreviewPos=null,measureMode=false,measurePoints=[],resourceBonus=zeroVec();

function disposeObject(object){object.traverse?.(child=>{child.geometry?.dispose?.();const materials=child.material?(Array.isArray(child.material)?child.material:[child.material]):[];for(const material of materials){material.map?.dispose?.();material.dispose?.()}})}
function clearGroup(group){while(group.children.length){const child=group.children[0];group.remove(child);disposeObject(child)}}
function heightCached(x,z,fallback){const h=terrainHeight(x,z);return h===null?(fallback??0):h}

function densify(points,spacing){
  if(points.length<2)return points.map(p=>({x:p.x_m,z:p.y_m,h:heightCached(p.x_m,p.y_m),t:p.t}));
  const out=[];let lastHeight=null;
  const push=(x,z,t)=>{const h=terrainHeight(x,z);if(h!==null)lastHeight=h;if(h===null&&lastHeight===null)return;out.push({x,z,h:h??lastHeight,t})};
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],length=Math.hypot(b.x_m-a.x_m,b.y_m-a.y_m),segments=Math.max(1,Math.ceil(length/spacing));
    for(let k=0;k<segments;k++){const u=k/segments;push(a.x_m+(b.x_m-a.x_m)*u,a.y_m+(b.y_m-a.y_m)*u,a.t+(b.t-a.t)*u)}
  }
  const last=points[points.length-1];push(last.x_m,last.y_m,last.t);
  return out;
}

// A flat ribbon of constant metre width, following the terrain. Line primitives
// are only 1 px wide on most GPUs, so a ribbon keeps the route readable at
// regional zoom levels.
function ribbonGeometry(samples,width,lift){
  if(samples.length<2)return null;
  const positions=new Float32Array(samples.length*2*3),indices=[];
  for(let i=0;i<samples.length;i++){
    const p=samples[i],a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)];
    let dx=b.x-a.x,dz=b.z-a.z;const length=Math.hypot(dx,dz)||1;dx/=length;dz/=length;
    const nx=-dz*width/2,nz=dx*width/2;
    // Sample both edges so the ribbon follows cross-slope instead of sinking
    // one side into the terrain on sloped ground.
    const leftX=p.x+nx,leftZ=p.z+nz,rightX=p.x-nx,rightZ=p.z-nz;
    const leftHeight=terrainHeight(leftX,leftZ),rightHeight=terrainHeight(rightX,rightZ);
    positions[i*6]=leftX;positions[i*6+1]=(leftHeight??p.h)+lift;positions[i*6+2]=leftZ;
    positions[i*6+3]=rightX;positions[i*6+4]=(rightHeight??p.h)+lift;positions[i*6+5]=rightZ;
    if(i<samples.length-1){const a0=i*2,b0=i*2+1,c0=(i+1)*2,d0=(i+1)*2+1;indices.push(a0,c0,b0,b0,c0,d0)}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(positions,3));
  g.setIndex(indices);
  return g;
}

function ribbon(samples,width,lift,color,opacity,order){
  const g=ribbonGeometry(samples,width,lift);if(!g)return null;
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
  m.renderOrder=order;
  return m;
}

function buildRoute(){
  clearGroup(routeGroup);
  if(routePoints.length<2)return;
  routeSamples=densify(routePoints,Math.max(step*0.5,12));
  const halo=ribbon(routeSamples,74,ROUTE_LIFT-5,0x1a1206,0.9,3);
  const main=ribbon(routeSamples,44,ROUTE_LIFT,0xffd166,1,4);
  const center=ribbon(routeSamples,7,ROUTE_LIFT+3,0xfff6cf,0.9,5);
  if(halo)routeGroup.add(halo);
  if(main)routeGroup.add(main);
  if(center)routeGroup.add(center);
}

function buildGhostRoute(points){
  clearGroup(ghostRouteGroup);
  if(!points||points.length<2)return;
  const samples=densify(points,Math.max(step*0.5,12));
  const ghost=ribbon(samples,30,ROUTE_LIFT-3,0x7d96b0,0.52,2);
  if(ghost)ghostRouteGroup.add(ghost);
}

function clearGhostRoute(){
  clearGroup(ghostRouteGroup);
  const box=$('replan-delta');
  if(box)box.classList.remove('visible');
}

function makeLabel(text,color){
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=96;
  const g=canvas.getContext('2d');
  g.fillStyle='rgba(8,12,15,.78)';g.strokeStyle='rgba(255,255,255,.28)';g.lineWidth=3;
  g.beginPath();g.roundRect(4,4,312,88,18);g.fill();g.stroke();
  g.font='600 54px "Roboto",system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle=color;g.fillText(text,160,50);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));
  sprite.scale.set(680,204,1);sprite.renderOrder=10;
  return sprite;
}

function buildStops(){
  clearGroup(stopGroup);
  for(const stop of stops){
    const h=heightCached(stop.x_m,stop.y_m);
    const completed=Boolean(stop.completed);
    const color=completed?0x6effb0:0xff8c42;
    const group=new THREE.Group();
    const pin=new THREE.Mesh(new THREE.CylinderGeometry(16,16,240,10),new THREE.MeshBasicMaterial({color}));
    pin.position.y=120;
    const orb=new THREE.Mesh(new THREE.SphereGeometry(75,20,14),new THREE.MeshBasicMaterial({color}));
    orb.position.y=290;
    const label=makeLabel(stop.label||`S${stop.id??''}`,completed?'#b9ffd8':'#ffd9b3');label.position.y=520;
    group.add(pin,orb,label);
    group.position.set(stop.x_m,h,stop.y_m);
    group.renderOrder=6;
    if(completed)group.scale.setScalar(1.15);
    stopGroup.add(group);
    stop.group=group;stop.orb=orb;stop.pin=pin;stop.timeVisited=completed;
  }
  buildSites();
}

function buildSites(){
  clearGroup(siteGroup);
  for(const site of siteList){
    if(stops.some(stop=>stop.id===site.id))continue;
    const group=new THREE.Group();
    const orb=new THREE.Mesh(new THREE.SphereGeometry(52,16,12),new THREE.MeshBasicMaterial({color:0x93a6b3,transparent:true,opacity:.5}));
    orb.position.y=140;
    const label=makeLabel(`S${site.id}`,'#c4d3dd');
    label.position.y=330;label.scale.set(420,126,1);
    group.add(orb,label);
    group.position.set(site.x_m,heightCached(site.x_m,site.y_m),site.y_m);
    group.renderOrder=5;
    siteGroup.add(group);
  }
}

const HAZARD_LIFT=8;
const HAZARD_STYLE={
  dust:{fill:0xd98b3a,edge:0xffc46b},
  terrain:{fill:0xa83f3f,edge:0xff8a7a}
};

// A hazard is a disc draped onto the DEM. Concentric rings keep every vertex on
// the terrain instead of letting a flat circle clip through slopes. Dust also
// gets a faint column so it reads at regional zoom.
function hazardDisc(hazard){
  const style=HAZARD_STYLE[hazard.kind]||HAZARD_STYLE.dust;
  const rings=6;
  const segments=Math.max(32,Math.min(180,Math.ceil(hazard.radius_m/step*2)));
  const centerHeight=heightCached(hazard.x_m,hazard.y_m);
  const positions=[hazard.x_m,centerHeight+HAZARD_LIFT,hazard.y_m];
  const indices=[];
  for(let ring=1;ring<=rings;ring++){
    const radius=hazard.radius_m*ring/rings;
    for(let segment=0;segment<segments;segment++){
      const angle=segment/segments*Math.PI*2;
      const x=hazard.x_m+Math.cos(angle)*radius,z=hazard.y_m+Math.sin(angle)*radius;
      positions.push(x,heightCached(x,z,centerHeight)+HAZARD_LIFT,z);
    }
  }
  for(let segment=0;segment<segments;segment++)indices.push(0,1+segment,1+(segment+1)%segments);
  for(let ring=1;ring<rings;ring++){
    const inner=1+(ring-1)*segments,outer=1+ring*segments;
    for(let segment=0;segment<segments;segment++){
      const next=(segment+1)%segments;
      indices.push(inner+segment,outer+segment,inner+next,inner+next,outer+segment,outer+next);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  const disc=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:style.fill,transparent:true,opacity:.26,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  disc.renderOrder=2;
  const group=new THREE.Group();group.add(disc);

  const rim=[];
  for(let segment=0;segment<=segments;segment++){
    const angle=segment/segments*Math.PI*2;
    const x=hazard.x_m+Math.cos(angle)*hazard.radius_m,z=hazard.y_m+Math.sin(angle)*hazard.radius_m;
    rim.push(x,heightCached(x,z,centerHeight)+HAZARD_LIFT+1,z);
  }
  const rimLine=new THREE.Line(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(rim,3)),new THREE.LineBasicMaterial({color:style.edge,transparent:true,opacity:.85}));
  rimLine.renderOrder=3;group.add(rimLine);

  if((hazard.kind||'dust')!=='terrain'){
    const column=new THREE.Mesh(new THREE.CylinderGeometry(hazard.radius_m,hazard.radius_m*0.85,700,Math.min(48,segments),1,true),new THREE.MeshBasicMaterial({color:style.fill,transparent:true,opacity:.07,depthWrite:false,side:THREE.DoubleSide}));
    column.position.set(hazard.x_m,centerHeight+350,hazard.y_m);
    column.renderOrder=1;group.add(column);
  }
  return group;
}

function buildHazards(){
  clearGroup(hazardGroup);
  for(const hazard of hazards)hazardGroup.add(hazardDisc(hazard));
  const count=$('hazard-count');if(count)count.textContent=String(hazards.length);
  renderHazardList();
}

function renderHazardList(){
  const box=$('hazard-list');
  if(!box)return;
  if(!hazards.length){box.innerHTML='';return}
  box.innerHTML=hazards.map((h,idx)=>{
    const kind=h.kind==='terrain'?'terrain':'dust';
    const label=kind==='terrain'?'Terrain':'Dust';
    return `<div class="hazard-item"><span class="h-dot ${kind}"></span>`
      +`<span class="h-name" data-hfocus="${idx}" title="Click to focus">${label} · ${(h.radius_m/1000).toFixed(1)}km · ${Number(h.severity||1).toFixed(1)}×</span>`
      +`<button class="h-del" type="button" data-hdel="${idx}" title="Remove hazard">×</button></div>`;
  }).join('');
  for(const el of box.querySelectorAll('[data-hfocus]'))el.onclick=()=>{
    const h=hazards[Number(el.dataset.hfocus)];
    if(h)focusPoint(h.x_m,h.y_m,Math.max(h.radius_m*4.5,3500));
  };
  for(const btn of box.querySelectorAll('[data-hdel]'))btn.onclick=async()=>{
    const idx=Number(btn.dataset.hdel);
    if(idx<0||idx>=hazards.length)return;
    hazards.splice(idx,1);
    buildHazards();
    await replan('Removed hazard');
  };
}

function clearHazardPreview(){
  lastPreviewPos=null;
  clearGroup(hazardPreviewGroup);
}

function updateHazardPreview(x,z){
  if(!hazardMode){clearHazardPreview();return}
  lastPreviewPos={x,z};
  clearGroup(hazardPreviewGroup);
  const style=HAZARD_STYLE[hazardMode]||HAZARD_STYLE.dust;
  const segments=72;
  const ch=heightCached(x,z);
  const pts=[];
  for(let i=0;i<segments;i++){
    const a=i/segments*Math.PI*2;
    const px=x+Math.cos(a)*hazardRadius,pz=z+Math.sin(a)*hazardRadius;
    pts.push(px,heightCached(px,pz,ch)+HAZARD_LIFT+3,pz);
  }
  const ring=new THREE.LineLoop(
    new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pts,3)),
    new THREE.LineBasicMaterial({color:style.edge,transparent:true,opacity:0.95})
  );
  ring.renderOrder=8;
  hazardPreviewGroup.add(ring);
}

function rayTerrainFast(ray){
  const ys=world.scale.y||1;
  const minY=minTerrainH*ys-50,maxY=maxTerrainH*ys+50;
  const dy=ray.direction.y;
  let t0=1,t1=150000;
  if(Math.abs(dy)>1e-6){
    const ta=(minY-ray.origin.y)/dy,tb=(maxY-ray.origin.y)/dy;
    t0=Math.max(1,Math.min(ta,tb));
    t1=Math.min(150000,Math.max(ta,tb));
    if(t1<=t0)return null;
  }
  const steps=140,dt=(t1-t0)/steps;
  let prevT=t0,prevDiff=null;
  for(let i=0;i<=steps;i++){
    const t=t0+i*dt;
    const px=ray.origin.x+ray.direction.x*t;
    const py=ray.origin.y+ray.direction.y*t;
    const pz=ray.origin.z+ray.direction.z*t;
    const h=terrainHeight(px,pz);
    if(h===null){prevT=t;prevDiff=null;continue}
    const diff=py-h*ys;
    if(diff<=0&&prevDiff!==null&&prevDiff>0){
      let lo=prevT,hi=t;
      for(let k=0;k<8;k++){
        const mid=(lo+hi)*0.5;
        const mx=ray.origin.x+ray.direction.x*mid;
        const my=ray.origin.y+ray.direction.y*mid;
        const mz=ray.origin.z+ray.direction.z*mid;
        const mh=terrainHeight(mx,mz);
        if(mh!==null&&my<=mh*ys)hi=mid;else lo=mid;
      }
      return {x:ray.origin.x+ray.direction.x*hi,z:ray.origin.z+ray.direction.z*hi};
    }
    prevT=t;prevDiff=diff;
  }
  return null;
}

function buildTimeline(){
  timeline=[];missionTime=0;
  const stopAt=new Map();
  for(const stop of stops)if(Number.isFinite(stop.arrive_index))stopAt.set(stop.arrive_index,stop);
  let t=0,visit=zeroVec();
  for(let i=0;i<routePoints.length;i++){
    const stop=stopAt.get(i);
    if(stop){
      const dt=Math.max(0,stop.visit?.time_s||0),start=t;
      timeline.push({type:'dwell',t0:start,t1:start+dt,x:stop.x_m,z:stop.y_m,stop,baseVisit:copyVec(visit),visit:copyVec(stop.visit||zeroVec())});
      visit=addVec(visit,stop.visit||zeroVec());
      t+=dt;
      stop.dwellStart=start;stop.dwellEnd=t;
    }
    if(i<routePoints.length-1){
      const a=routePoints[i],b=routePoints[i+1],dt=Math.max(0,b.t-a.t);
      timeline.push({type:'move',t0:t,t1:t+dt,a,b,baseVisit:copyVec(visit)});
      t+=dt;
    }
  }
  missionDuration=t>0?t:1;
  buildElevProfile();
}

function buildElevProfile(){
  if(!timeline.length||missionDuration<=0){elevProfile=null;drawElevProfile();return}
  const N=140,samples=[];
  let minH=Infinity,maxH=-Infinity;
  for(let i=0;i<=N;i++){
    const u=i/N,st=stateAt(u*missionDuration);
    const h=st?terrainHeight(st.x,st.z):null;
    if(h!==null){if(h<minH)minH=h;if(h>maxH)maxH=h}
    samples.push({u,h});
  }
  if(!Number.isFinite(minH)){elevProfile=null;drawElevProfile();return}
  const pad=Math.max(4,(maxH-minH)*0.12);
  const markers=stops.filter(s=>Number.isFinite(s.dwellStart)).map(s=>({
    u:Math.min(1,Math.max(0,s.dwellStart/missionDuration)),
    stop:s
  }));
  elevProfile={samples,minH:minH-pad,maxH:maxH+pad,rawMin:minH,rawMax:maxH,markers};
  const rangeEl=$('elev-range');
  if(rangeEl){
    const fmt=v=>`${v>=0?'+':''}${Math.round(v)}m`;
    rangeEl.textContent=`${fmt(minH)} .. ${fmt(maxH)} rel`;
  }
  drawElevProfile();
}

function drawElevProfile(){
  const canvas=$('elev-profile');
  if(!canvas)return;
  const dpr=Math.min(devicePixelRatio||1,2);
  const w=Math.max(100,canvas.clientWidth||280),h=Math.max(36,canvas.clientHeight||52);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  }
  const g=canvas.getContext('2d');
  g.setTransform(dpr,0,0,dpr,0,0);
  g.clearRect(0,0,w,h);
  if(!elevProfile)return;
  const {samples,minH,maxH,markers}=elevProfile;
  const span=Math.max(1,maxH-minH);
  const yOf=v=>h-5-((v-minH)/span)*(h-12);

  if(minH<0&&maxH>0){
    const y0=yOf(0);
    g.strokeStyle='rgba(139,148,158,0.22)';
    g.lineWidth=1;
    g.setLineDash([3,3]);
    g.beginPath();g.moveTo(0,y0);g.lineTo(w,y0);g.stroke();
    g.setLineDash([]);
  }

  g.beginPath();
  let started=false,lastX=0,lastY=h;
  for(const s of samples){
    if(s.h===null)continue;
    const x=s.u*w,y=yOf(s.h);
    if(!started){g.moveTo(x,h);g.lineTo(x,y);started=true}
    else g.lineTo(x,y);
    lastX=x;lastY=y;
  }
  if(started){
    g.lineTo(lastX,h);g.closePath();
    g.fillStyle='rgba(217,155,38,0.16)';
    g.fill();
  }

  g.beginPath();started=false;
  for(const s of samples){
    if(s.h===null)continue;
    const x=s.u*w,y=yOf(s.h);
    if(!started){g.moveTo(x,y);started=true}else g.lineTo(x,y);
  }
  g.strokeStyle='#d99b26';g.lineWidth=1.5;g.stroke();

  for(const m of markers){
    const x=m.u*w,done=m.stop.completed||m.stop.timeVisited;
    g.strokeStyle=done?'rgba(63,185,80,0.65)':'rgba(217,155,38,0.45)';
    g.lineWidth=1;
    g.beginPath();g.moveTo(x,4);g.lineTo(x,h);g.stroke();
    g.fillStyle=done?'#3fb950':'#d99b26';
    g.beginPath();g.arc(x,4,2.2,0,Math.PI*2);g.fill();
  }

  const cx=Math.min(w-1,Math.max(1,progress*w));
  g.strokeStyle='#e6edf3';g.lineWidth=1.5;
  g.beginPath();g.moveTo(cx,0);g.lineTo(cx,h);g.stroke();
  const st=stateAt(missionTime),ch=st?terrainHeight(st.x,st.z):null;
  if(ch!==null){
    g.fillStyle='#e6edf3';
    g.beginPath();g.arc(cx,yOf(ch),2.8,0,Math.PI*2);g.fill();
  }
}

function stateAt(time){
  if(!timeline.length)return null;
  const clamped=Math.max(0,Math.min(missionDuration,time));
  let segment=timeline[timeline.length-1];
  for(const candidate of timeline){if(clamped>=candidate.t0&&clamped<=candidate.t1){segment=candidate;break}}
  const span=Math.max(1e-9,segment.t1-segment.t0);
  const u=Math.min(1,Math.max(0,(clamped-segment.t0)/span));
  if(segment.type==='dwell'){
    return {x:segment.x,z:segment.z,spent:addVec(segment.baseVisit,lerpVec(zeroVec(),segment.visit,u)),stop:segment.stop,dwelling:true,time:clamped};
  }
  return {x:segment.a.x_m+(segment.b.x_m-segment.a.x_m)*u,z:segment.a.y_m+(segment.b.y_m-segment.a.y_m)*u,spent:addVec(lerpVec(segment.a.spent,segment.b.spent,u),segment.baseVisit),stop:null,dwelling:false,time:clamped};
}

function unpackBits(hex,count){
  const out=new Uint8Array(count);
  for(let i=0;i<count;i++){
    const byte=parseInt(hex.substr((i>>3)*2,2),16);
    out[i]=(byte>>(i&7))&1;
  }
  return out;
}

function unpackRatios(hex,count){
  const out=new Float32Array(count);
  for(let i=0;i<count;i++)out[i]=parseInt(hex.substr(i*2,2),16)/200;
  return out;
}

function disposeContourGroup(group){
  if(!group)return;
  for(const child of group.children){
    child.geometry?.dispose();
    child.material?.dispose();
  }
  missionGroup.remove(group);
}

const ISO_LEVELS=[
  {t:0.15,color:0x42f5be,opacity:0.65},
  {t:0.30,color:0x66f588,opacity:0.76},
  {t:0.50,color:0xd2ed53,opacity:0.84},
  {t:0.75,color:0xf5a642,opacity:0.90},
  {t:1.00,color:0xff5d4d,opacity:0.95},
];

function buildSafeRegion(region){
  if(!region||!region.width||!region.height)return;
  safeMeta={left:region.left_m,top:region.top_m,cell:region.cell_size_m,width:region.width,height:region.height};
  const regW=region.width*region.cell_size_m,regH=region.height*region.cell_size_m;
  if(safeMesh){missionGroup.remove(safeMesh);safeMesh.geometry.dispose();safeMesh.material.dispose();safeMesh=null}
  disposeContourGroup(safeContour);safeContour=null;
  if(safeTexture){safeTexture.dispose();safeTexture=null}
  const data=new Uint8Array(region.width*region.height*4);
  safeTexture=new THREE.DataTexture(data,region.width,region.height,THREE.RGBAFormat);
  safeTexture.minFilter=THREE.LinearFilter;safeTexture.magFilter=THREE.LinearFilter;
  safeTexture.wrapS=THREE.ClampToEdgeWrapping;safeTexture.wrapT=THREE.ClampToEdgeWrapping;
  safeTexture.needsUpdate=true;

  // Build vertices aligned to the 50 m DEM mesh and match its triangle split
  // (a,b,e) and (b,d,e) so the overlay sits coplanar without sawtooth clipping.
  const c0=Math.max(0,Math.floor((region.left_m-left)/step));
  const c1=Math.min(cols-1,Math.ceil((region.left_m+regW-left)/step));
  const r0=Math.max(0,Math.floor((top-region.top_m)/step));
  const r1=Math.min(rows-1,Math.ceil((top-(region.top_m-regH))/step));
  const mw=Math.max(2,c1-c0+1),mh=Math.max(2,r1-r0+1);
  const vertexPositions=new Float32Array(mw*mh*3),vertexUvs=new Float32Array(mw*mh*2),valid=new Uint8Array(mw*mh),tris=[];
  for(let mr=0;mr<mh;mr++)for(let mc=0;mc<mw;mc++){
    const r=r0+mr,c=c0+mc,i=mr*mw+mc;
    const x=left+c*step,z=top-r*step,h=heights[r*cols+c];
    valid[i]=Number.isFinite(h)?1:0;
    vertexPositions[i*3]=x;vertexPositions[i*3+1]=(Number.isFinite(h)?h:0)+SAFE_LIFT;vertexPositions[i*3+2]=z;
    vertexUvs[i*2]=Math.min(1,Math.max(0,(x-region.left_m)/regW));
    vertexUvs[i*2+1]=Math.min(1,Math.max(0,(region.top_m-z)/regH));
  }
  for(let mr=0;mr<mh-1;mr++)for(let mc=0;mc<mw-1;mc++){
    const a=mr*mw+mc,b=a+1,d=a+mw+1,e=a+mw;
    if(valid[a]&&valid[b]&&valid[e])tris.push(a,b,e);
    if(valid[b]&&valid[d]&&valid[e])tris.push(b,d,e);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(vertexPositions,3));
  g.setAttribute('uv',new THREE.BufferAttribute(vertexUvs,2));
  g.setIndex(tris);
  const material=new THREE.MeshBasicMaterial({map:safeTexture,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  safeMesh=new THREE.Mesh(g,material);safeMesh.renderOrder=1;
  const visible=$('safe-toggle')?.checked??true;
  safeMesh.visible=visible;
  missionGroup.add(safeMesh);

  safeContour=new THREE.Group();
  safeContour.visible=visible;
  for(let i=0;i<ISO_LEVELS.length;i++){
    const level=ISO_LEVELS[i];
    const line=new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([],3)),
      new THREE.LineBasicMaterial({color:level.color,transparent:true,opacity:level.opacity,depthWrite:false})
    );
    line.renderOrder=2;
    safeContour.add(line);
  }
  missionGroup.add(safeContour);
  currentFrame=-1;
}

const ISOCHRONE_SEG_TABLE=[
  [], [2,3], [1,2], [1,3], [0,1], [0,3,1,2], [0,2], [0,3],
  [0,3], [0,2], [0,1,2,3], [0,1], [1,3], [1,2], [2,3], []
];

function edgeCross(ax,az,va,bx,bz,vb,iso){
  const d=vb-va,u=Math.abs(d)<1e-6?0.5:Math.min(1,Math.max(0,(iso-va)/d));
  return [ax+(bx-ax)*u,az+(bz-az)*u];
}

function updateSafeContour(ratios){
  if(!safeContour||!safeMeta||!ratios)return;
  const {left:regLeft,top:regTop,cell,width,height}=safeMeta;
  const lift=SAFE_LIFT+2;
  const buckets=ISO_LEVELS.map(()=>[]);
  for(let r=0;r<height-1;r++){
    const z0=regTop-(r+0.5)*cell,z1=z0-cell,row0=r*width,row1=(r+1)*width;
    for(let c=0;c<width-1;c++){
      const v0=ratios[row0+c],v1=ratios[row0+c+1],v2=ratios[row1+c+1],v3=ratios[row1+c];
      const lo=Math.min(v0,v1,v2,v3),hi=Math.max(v0,v1,v2,v3);
      if(lo===hi)continue;
      const x0=regLeft+(c+0.5)*cell,x1=x0+cell;
      for(let li=0;li<ISO_LEVELS.length;li++){
        const iso=ISO_LEVELS[li].t;
        if(lo>=iso||hi<iso)continue;
        let mask=(v0<iso?8:0)|(v1<iso?4:0)|(v2<iso?2:0)|(v3<iso?1:0);
        let segs=ISOCHRONE_SEG_TABLE[mask];
        if(mask===5||mask===10){
          const centerOn=(v0+v1+v2+v3)*0.25<iso;
          segs=(mask===5)===centerOn?[0,3,1,2]:[0,1,2,3];
        }
        if(!segs.length)continue;
        const pts=buckets[li];
        const edgePt=e=>{
          if(e===0)return edgeCross(x0,z0,v0,x1,z0,v1,iso);
          if(e===1)return edgeCross(x1,z0,v1,x1,z1,v2,iso);
          if(e===2)return edgeCross(x1,z1,v2,x0,z1,v3,iso);
          return edgeCross(x0,z1,v3,x0,z0,v0,iso);
        };
        for(let i=0;i<segs.length;i+=2){
          const a=edgePt(segs[i]),b=edgePt(segs[i+1]);
          const mx=(a[0]+b[0])*0.5,mz=(a[1]+b[1])*0.5;
          const ha=heightCached(a[0],a[1])+lift,hm=heightCached(mx,mz)+lift,hb=heightCached(b[0],b[1])+lift;
          pts.push(a[0],ha,a[1],mx,hm,mz,mx,hm,mz,b[0],hb,b[1]);
        }
      }
    }
  }
  for(let li=0;li<ISO_LEVELS.length;li++){
    const line=safeContour.children[li];
    if(!line)continue;
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(buckets[li],3));
    g.computeBoundingSphere();
    line.geometry.dispose();
    line.geometry=g;
  }
}

function ratioRgb(r){
  if(r<=0.45){
    const u=r/0.45;
    return [Math.round(50+u*34),Math.round(224+u*10),Math.round(145-u*30)];
  }
  if(r<=0.80){
    const u=(r-0.45)/0.35;
    return [Math.round(84+u*146),Math.round(234-u*24),Math.round(115-u*47)];
  }
  const u=Math.min(1,(r-0.80)/0.20);
  return [Math.round(230+u*20),Math.round(210-u*102),Math.round(68+u*6)];
}

function setSafeCells(cells,ratios){
  if(!safeTexture||!safeMeta)return;
  const {width,height,cell}=safeMeta;
  const data=safeTexture.image.data;
  const rField=ratios||Float32Array.from(cells,v=>v?0.5:1.25);
  let onCount=0,halfCount=0;
  for(let r=0;r<height;r++)for(let c=0;c<width;c++){
    const idx=r*width+c,on=cells[idx]?1:0,val=rField[idx],k=idx*4;
    if(!on){data[k]=245;data[k+1]=110;data[k+2]=75;data[k+3]=0;continue}
    onCount++;
    if(val<=0.50)halfCount++;
    const [cr,cg,cb]=ratioRgb(Math.min(1,Math.max(0,val)));
    // Feather the outermost 3 grid cells so a crop-clipped region never draws a hard square border.
    const boxDist=Math.min(r,height-1-r,c,width-1-c);
    const boxFade=boxDist<3?boxDist/3:1;
    const alpha=Math.round((78-30*Math.min(1,val))*boxFade);
    data[k]=cr;data[k+1]=cg;data[k+2]=cb;data[k+3]=alpha;
  }
  safeTexture.needsUpdate=true;
  updateSafeContour(rField);
  const out=$('safe-readout');
  if(out){
    const total=width*height,pct=(onCount/total)*100,km2=(onCount*cell*cell)/1e6,halfKm2=(halfCount*cell*cell)/1e6;
    if(onCount===0)out.textContent='0.0 km² · reserve';
    else if(onCount===total)out.textContent=`>144 km² (½ ${halfKm2.toFixed(0)} km²)`;
    else out.textContent=`${km2>=10?km2.toFixed(1):km2.toFixed(2)} km² (${Math.round(pct)}%)`;
  }
}

function updateSafeFrame(fraction){
  if(!safeFrames.length)return;
  let index=0;
  for(let i=0;i<safeFrames.length;i++)if(safeFrames[i].t<=fraction+1e-9)index=i;
  if(index===currentFrame)return;
  currentFrame=index;
  setSafeCells(safeFrames[index].cells,safeFrames[index].ratios);
}

function formatDuration(seconds){
  if(!Number.isFinite(seconds))return '–';
  const total=Math.max(0,Math.round(seconds)),hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60);
  return hours>0?`${hours}h ${String(minutes).padStart(2,'0')}m`:`${minutes}m ${String(total%60).padStart(2,'0')}s`;
}
function resourceText(key,value){
  if(key==='time_s')return formatDuration(value);
  if(key==='rover_power')return `${Math.round(value)}`;
  return value.toFixed(value<10?1:0);
}

function effectiveSpent(spent){
  const out=zeroVec();
  for(const key of RESOURCE_KEYS)out[key]=Math.max(0,(spent?.[key]||0)-(resourceBonus[key]||0));
  return out;
}

function safeFractionForState(state){
  if(!state)return progress;
  const hasBonus=RESOURCE_KEYS.some(key=>Math.abs(resourceBonus[key]||0)>1e-9);
  if(!hasBonus)return progress;
  const spentBefore=plan?.mission?.spent_before||zeroVec();
  const used=plan?.mission?.used||zeroVec();
  const eff=effectiveSpent(state.spent);
  let frac=0;
  for(const key of RESOURCE_KEYS){
    const span=used[key]>1e-6?used[key]:Math.max(1e-6,(plan?.mission?.resources?.[key]||0)-(plan?.mission?.reserve?.[key]||0));
    const localSpent=Math.max(0,eff[key]-(spentBefore[key]||0));
    frac=Math.max(frac,localSpent/span);
  }
  return Math.min(1,Math.max(0,frac));
}

function updateHud(state){
  if(!state||!plan?.mission)return;
  const resources=plan.mission.resources||zeroVec();
  const reserve=plan.mission.reserve||zeroVec();
  const effSpent=effectiveSpent(state.spent);
  const remaining={};
  for(const key of RESOURCE_KEYS){
    remaining[key]=Math.max(0,(resources[key]||0)-(effSpent[key]||0));
    const total=resources[key]||1;
    const percent=Math.max(0,Math.min(100,remaining[key]/total*100));
    const resPercent=Math.max(0,Math.min(100,(reserve[key]||0)/total*100));
    const bar=$(`bar-${key}`),label=$(`val-${key}`),res=$(`res-${key}`),row=$(`row-${key}`);
    if(bar)bar.style.width=`${percent}%`;
    if(res)res.style.left=`${resPercent}%`;
    if(row)row.classList.toggle('near-reserve',remaining[key]<=(reserve[key]||0)*1.15);
    if(label)label.textContent=resourceText(key,remaining[key]);
  }
  const visited=stops.filter(stop=>stop.completed||stop.timeVisited).length;
  const next=stops.find(stop=>!stop.completed&&!stop.timeVisited);
  let status;
  if(state.dwelling&&state.stop)status=`Sampling ${state.stop.label||`S${state.stop.id}`}`;
  else if(next)status=`En route to ${next.label||`S${next.id}`}`;
  else status='Returning to safehouse';
  $('mission-status').textContent=status;
  const time=$('mission-time');if(time)time.textContent=`${formatDuration(elapsedOffset+state.time)} / ${formatDuration(elapsedOffset+missionDuration)}`;
  const stats=$('stats');
  if(stats){
    const reward=stops.reduce((sum,stop)=>sum+((stop.completed||stop.timeVisited)?(stop.reward||0):0),0);
    stats.innerHTML=`<div><span>Reward</span><strong>${reward.toFixed(1)}</strong></div>`
      +`<div><span>Stops</span><strong>${visited}/${totalStops}</strong></div>`
      +`<div><span>Hazards</span><strong>${hazards.length}</strong></div>`
      +`<div><span>Risk</span><strong>${plan.mission.risk||'–'}</strong></div>`;
  }
}

function applyProgress(){
  const state=stateAt(missionTime);
  if(!state)return;
  placeAstronaut(state.x,state.z);
  let stopChanged=false;
  for(const stop of stops){
    const visited=stop.completed||(Number.isFinite(stop.dwellStart)&&missionTime>=stop.dwellStart-1e-6);
    if(visited!==stop.timeVisited){
      stop.timeVisited=visited;
      stopChanged=true;
      if(stop.orb)stop.orb.material.color.setHex(visited?0x6effb0:0xff8c42);
      if(stop.pin)stop.pin.material.color.setHex(visited?0x6effb0:0xff8c42);
      if(stop.group)stop.group.scale.setScalar(visited?1.15:1);
    }
  }
  if(stopChanged)renderSiteList();
  updateSafeFrame(safeFractionForState(state));
  updateHud(state);
  drawElevProfile();
  const scrub=$('scrub');if(scrub)scrub.value=String(Math.round(progress*1000));
}

function seek(fraction){
  progress=Math.min(1,Math.max(0,fraction));
  missionTime=progress*missionDuration;
  applyProgress();
}
function play(){if(missionDuration<=1)return;if(progress>=1)seek(0);playing=true;$('play').textContent='❚❚ Pause'}
function pause(){playing=false;$('play').textContent='▶ Play'}
function togglePlay(){playing?pause():play()}

function focusSelectedSites(){
  const selectedSites=(siteList||[]).filter(s=>(selectedSiteIds||[]).includes(s.id));
  const points=selectedSites.length
    ? [...selectedSites.map(s=>({x:s.x_m,z:s.y_m})),{x:0,z:0}]
    : [...stops.map(s=>({x:s.x_m,z:s.y_m})),...routePoints.map(p=>({x:p.x_m,z:p.y_m})),{x:0,z:0}];
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const p of points){
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
    minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
  }
  if(!Number.isFinite(minX)){minX=-3000;maxX=3000;minZ=-3000;maxZ=3000}
  const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
  const span=Math.max(maxX-minX,maxZ-minZ,1000);
  const distance=Math.max(span*0.95,1400);
  const cy=(terrainHeight(cx,cz)??0)*world.scale.y;
  controls.target.set(cx,cy,cz);
  camera.position.set(cx+distance*0.32,cy+distance*0.92,cz+distance*0.78);
  controls.update();
}

function focusRoute(){
  focusSelectedSites();
}

function setRoute(points){
  routePoints=(points||[]).map(point=>({x_m:+point.x_m,y_m:+point.y_m,t:Number.isFinite(point.t)?point.t:undefined,spent:point.spent?copyVec(point.spent):null}));
  let time=0;
  for(let i=0;i<routePoints.length;i++){
    const point=routePoints[i];
    if(i===0){if(point.t===undefined)point.t=0;time=point.t}
    else if(point.t===undefined){time+=Math.max(1,Math.hypot(point.x_m-routePoints[i-1].x_m,point.y_m-routePoints[i-1].y_m));point.t=time}
    else time=point.t;
    if(!point.spent)point.spent=zeroVec();
  }
  buildRoute();
  buildTimeline();
}
function setStops(list){
  stops=(list||[]).map(stop=>({...stop,completed:Boolean(stop.completed),timeVisited:Boolean(stop.completed)}));
  buildStops();
  buildTimeline();
}
function setSafeRegion(region){
  if(!region)return;
  buildSafeRegion(region);
  const width=region.width,height=region.height;
  const cells=region.cells instanceof Uint8Array?region.cells:Uint8Array.from(region.cells||[]);
  const normalized=cells.length===width*height?cells:new Uint8Array(width*height);
  const ratios=region.ratios?unpackRatios(region.ratios,width*height):Float32Array.from(normalized,v=>v?0.5:1.25);
  safeFrames=[{t:0,cells:normalized,ratios}];
  setSafeCells(safeFrames[0].cells,safeFrames[0].ratios);
  currentFrame=0;
}

function signedDuration(seconds){
  if(!Number.isFinite(seconds)||Math.abs(seconds)<1)return '0s';
  const sign=seconds>0?'+':'−';
  return `${sign}${formatDuration(Math.abs(seconds))}`;
}

function setPlan(next,options={}){
  plan=next||{};
  progress=0;missionTime=0;playing=false;
  resourceBonus=zeroVec();
  elapsedOffset=Number(plan.mission?.elapsed_before)||0;
  const preserved=options.preserved||[];
  const incoming=(plan.stops||[]).map(stop=>({...stop,completed:false,timeVisited:false}));
  const incomingIds=new Set(incoming.map(stop=>stop.id));
  const kept=preserved
    .filter(stop=>!incomingIds.has(stop.id))
    .map(stop=>({...stop,completed:true,timeVisited:true,arrive_index:undefined,dwellStart:NaN,dwellEnd:NaN}));
  stops=[...incoming,...kept];
  const planned=Number(plan.mission?.stops_total);
  totalStops=Number.isFinite(planned)?planned:stops.length;
  applyScience(plan.science);
  const frames=plan.safe_region_frames||[];
  if(plan.safe_region&&frames.length){
    buildSafeRegion(plan.safe_region);
    const count=plan.safe_region.width*plan.safe_region.height;
    safeFrames=frames.map(frame=>({
      t:Number(frame.t)||0,
      cells:unpackBits(frame.cells,count),
      ratios:frame.ratios?unpackRatios(frame.ratios,count):null
    })).sort((a,b)=>a.t-b.t);
    currentFrame=-1;updateSafeFrame(0);
  }else{
    setSafeRegion(plan.safe_region);
  }
  setRoute(plan.route||[]);
  if(options.compareFrom){
    buildGhostRoute(options.compareFrom.routePoints);
    const dTime=(plan.mission?.end_time_s??missionDuration)-options.compareFrom.duration_s;
    const dReward=(plan.mission?.reward??0)-options.compareFrom.reward;
    const deltaBox=$('replan-delta'),deltaText=$('replan-delta-text');
    if(deltaBox&&deltaText){
      deltaText.textContent=`vs prior: ${signedDuration(dTime)} · ${dReward>=0?'+':''}${dReward.toFixed(1)} sci`;
      deltaBox.classList.add('visible');
    }
  }else if(options.clearGhost!==false){
    clearGhostRoute();
  }
  buildStops();
  buildTimeline();
  renderSiteList();
  const start=plan.astronaut||routePoints[0]||{x_m:0,y_m:0};
  astronautXY=[start.x_m||0,start.y_m||0];
  lastAstroPos=null;
  placeAstronaut(astronautXY[0],astronautXY[1]);
  const remaining=stops.filter(stop=>!stop.completed).length;
  const badge=$('mission-badge');
  if(badge)badge.textContent=plan.mission
    ?`${remaining} left · ETA ${formatDuration(plan.mission.end_time_s??plan.mission.duration_s)}`
    :'plan.json';
  const riskSel=$('plan-risk');
  if(riskSel&&plan.mission?.risk)riskSel.value=plan.mission.risk.toLowerCase();
  const objSel=$('plan-objective');
  if(objSel&&plan.mission?.objective)objSel.value=plan.mission.objective.toLowerCase();
  pause();
  applyProgress();
  if(options.focus!==false)focusRoute();
  $('mission-status').textContent=options.status||'Plan loaded · press Play';
}

// --------------------------------------------------------------- science --
const escapeHtml=text=>String(text??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function applyScience(science){
  if(!science||!Array.isArray(science.sites))return;
  scienceSeed=Number.isFinite(Number(science.seed))?Number(science.seed):null;
  siteList=science.sites.map(site=>({...site}));
  selectedSiteIds=Array.isArray(science.selected)?[...science.selected]:siteList.map(site=>site.id);
  renderSiteList();
}

function renderSiteList(){
  const box=$('site-list');
  if(!box)return;
  const seed=$('science-seed');
  if(seed)seed.textContent=scienceSeed===null?'–':`seed ${scienceSeed}`;
  if(!siteList.length){box.innerHTML='<div class="status-note">No science sites loaded.</div>';return}
  const upcomingOrder=new Map();
  let orderNum=1;
  for(const stop of stops){
    if(!stop.completed&&!stop.timeVisited)upcomingOrder.set(stop.id,orderNum++);
  }
  box.innerHTML=siteList.map(site=>{
    const included=selectedSiteIds.includes(site.id);
    const stopObj=stops.find(s=>s.id===site.id);
    const isDone=completedStops.has(site.id)||Boolean(stopObj&&(stopObj.completed||stopObj.timeVisited));
    const idx=upcomingOrder.get(site.id);
    let tagHtml='<span class="site-tag">OFF</span>';
    if(isDone)tagHtml='<span class="site-tag done">DONE</span>';
    else if(idx!==undefined)tagHtml=`<span class="site-tag planned">#${idx}</span>`;
    else if(included)tagHtml='<span class="site-tag skip">SKIP</span>';
    const visitDur=formatDuration(site.visit?.time_s||0);
    const conf=Math.round((Number(site.confidence)||0)*100);
    const tip=`${site.label} · ${visitDur} visit · ${conf}% conf · click to focus`;
    return `<div class="site${included?' on':''}" title="${escapeHtml(tip)}">`
      +`<span class="sname" data-site-focus="${site.id}">S${site.id} ${escapeHtml(site.label)}</span>`
      +tagHtml
      +`<span class="sval">${(Number(site.reward)||0).toFixed(1)}</span></div>`;
  }).join('');
  for(const label of box.querySelectorAll('[data-site-focus]'))label.onclick=()=>{
    const site=siteList.find(s=>s.id===Number(label.dataset.siteFocus));
    if(site)focusPoint(site.x_m,site.y_m,3200);
  };
}

function setScienceHint(text){const element=$('science-hint');if(element)element.textContent=text}

function selectedSummary(){
  const planned=stops.filter(stop=>!stop.completed&&!stop.timeVisited).length;
  const done=stops.filter(stop=>stop.completed||stop.timeVisited).length;
  return `${done} done · ${planned} queued · ${selectedSiteIds.length}/${siteList.length} in scenario`;
}

// -------------------------------------------------------------- scenarios --
function loadCustomScenarios(){
  try{
    const raw=localStorage.getItem(SCENARIO_STORAGE_KEY);
    const parsed=raw?JSON.parse(raw):[];
    if(Array.isArray(parsed))customScenarios=parsed.filter(s=>s&&typeof s.id==='string'&&typeof s.name==='string'&&Array.isArray(s.site_ids));
  }catch{customScenarios=[]}
}

function saveCustomScenarios(){
  try{localStorage.setItem(SCENARIO_STORAGE_KEY,JSON.stringify(customScenarios))}catch{}
}

function getBuiltinScenarios(){
  const src=defaultPlan?.science||{seed:scienceSeed,sites:siteList,selected:selectedSiteIds};
  const sites=Array.isArray(src.sites)?src.sites:[];
  const baseSeed=Number.isFinite(Number(src.seed))?Number(src.seed):scienceSeed;
  const baseSelected=Array.isArray(src.selected)&&src.selected.length?src.selected:sites.map(s=>s.id);
  const presets=[{id:'default',name:'Default Scenario',builtin:true}];
  if(sites.length){
    const top4=[...sites].sort((a,b)=>(Number(b.reward)||0)-(Number(a.reward)||0)).slice(0,4).map(s=>s.id).sort((a,b)=>a-b);
    presets.push(
      {id:'high-yield',name:'High-Yield Top 4',builtin:true,seed:baseSeed,site_ids:top4,risk:'neutral',objective:'fastest',hazards:[]},
      {id:'all-sites',name:'Full Sweep (All Sites)',builtin:true,seed:baseSeed,site_ids:sites.map(s=>s.id),risk:'neutral',objective:'fastest',hazards:[]},
      {id:'conserve-o2',name:'Conserve O₂',builtin:true,seed:baseSeed,site_ids:baseSelected,risk:'neutral',objective:'oxygen',hazards:[]},
      {id:'pessimistic',name:'Pessimistic Stress Test',builtin:true,seed:baseSeed,site_ids:baseSelected,risk:'pessimistic',objective:'balanced',hazards:[]}
    );
  }
  return presets;
}

function findScenario(id){
  return [...getBuiltinScenarios(),...customScenarios].find(s=>s.id===id)||null;
}

function renderScenarioOptions(){
  const sel=$('scenario-select');
  if(!sel)return;
  const builtins=getBuiltinScenarios();
  const optHtml=s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`;
  let html=optHtml(builtins[0]);
  if(builtins.length>1)html+=`<optgroup label="Presets">${builtins.slice(1).map(optHtml).join('')}</optgroup>`;
  if(customScenarios.length)html+=`<optgroup label="Custom Scenarios">${customScenarios.map(optHtml).join('')}</optgroup>`;
  sel.innerHTML=html;
  if(!findScenario(activeScenarioId))activeScenarioId='default';
  sel.value=activeScenarioId;
}

function resetToDefaultScenario(){
  replanToken++;
  hazards=[];
  buildHazards();
  completedStops.clear();
  stops=[];
  resourceBonus=zeroVec();
  elapsedOffset=0;
  clearGhostRoute();
  activeScenarioId='default';
  renderScenarioOptions();
  const abortBtn=$('abort-return');
  if(abortBtn)abortBtn.classList.remove('urgent');
  if(defaultPlan){
    setPlan(structuredClone(defaultPlan),{focus:true,clearGhost:true,status:'Reset to default scenario'});
    setScienceHint(selectedSummary());
    setHazardHint(apiReady
      ?'Default scenario restored. Click the terrain to place hazards.'
      :'Offline replay · reset to default scenario.');
    return;
  }
  if(apiReady){
    replan('Reset to default scenario',{freshStart:true,focus:true,compare:false,status:'Reset to default scenario'});
  }
}

async function runScenario(id){
  if(id==='default'){resetToDefaultScenario();return}
  const scenario=findScenario(id);
  if(!scenario){resetToDefaultScenario();return}
  if(!apiReady){
    const sel=$('scenario-select');
    if(sel)sel.value=activeScenarioId;
    setStatus('Live server required for alternate scenarios · use Reset for default');
    return;
  }
  activeScenarioId=scenario.id;
  renderScenarioOptions();
  hazards=(scenario.hazards||[]).map(h=>({...h}));
  buildHazards();
  if(Number.isFinite(Number(scenario.seed)))scienceSeed=Number(scenario.seed);
  if(Array.isArray(scenario.sites)&&scenario.sites.length)siteList=scenario.sites.map(s=>({...s}));
  else if(defaultPlan?.science?.sites&&scienceSeed===defaultPlan.science.seed)siteList=defaultPlan.science.sites.map(s=>({...s}));
  selectedSiteIds=[...(scenario.site_ids||[])];
  const riskSel=$('plan-risk'),objSel=$('plan-objective');
  if(riskSel&&scenario.risk)riskSel.value=scenario.risk;
  if(objSel&&scenario.objective)objSel.value=scenario.objective;
  renderSiteList();
  buildStops();
  await replan(`Scenario: ${scenario.name}`,{
    freshStart:true,
    focus:true,
    compare:false,
    statusPrefix:`Scenario: ${scenario.name}`
  });
}

function isScenarioModalOpen(){
  return Boolean($('scenario-modal')?.classList.contains('open'));
}

function updateModalSelectionSummary(){
  const seedEl=$('sc-seed-label'),countEl=$('sc-selected-count');
  if(seedEl)seedEl.textContent=modalSeed===null?'Site Selection':`Site Selection · seed ${modalSeed}`;
  if(countEl)countEl.textContent=`${modalSelectedIds.length} of ${modalSites.length} selected`;
}

function renderModalSiteList(){
  const box=$('sc-site-list');
  updateModalSelectionSummary();
  if(!box)return;
  if(!modalSites.length){box.innerHTML='<div class="status-note">No science sites available.</div>';return}
  box.innerHTML=modalSites.map(site=>{
    const checked=modalSelectedIds.includes(site.id);
    const visitDur=formatDuration(site.visit?.time_s||0);
    return `<label class="modal-site${checked?' on':''}">`
      +`<input type="checkbox" data-sc-site="${site.id}"${checked?' checked':''}>`
      +`<span class="modal-site-label">S${site.id} ${escapeHtml(site.label)}</span>`
      +`<span class="modal-site-meta">${visitDur}</span>`
      +`<span class="sval">${(Number(site.reward)||0).toFixed(1)}</span></label>`;
  }).join('');
  for(const input of box.querySelectorAll('input[data-sc-site]')){
    input.onchange=()=>{
      const id=Number(input.dataset.scSite);
      modalSelectedIds=(input.checked
        ?[...new Set([...modalSelectedIds,id])]
        :modalSelectedIds.filter(v=>v!==id)).sort((a,b)=>a-b);
      input.closest('.modal-site')?.classList.toggle('on',input.checked);
      updateModalSelectionSummary();
    };
  }
}

function openScenarioModal(){
  const modal=$('scenario-modal');
  if(!modal)return;
  modalSeed=Number.isFinite(scienceSeed)?scienceSeed:(defaultPlan?.science?.seed??null);
  modalSites=siteList.map(s=>({...s}));
  modalSelectedIds=[...selectedSiteIds];
  const nameInput=$('sc-name');
  if(nameInput)nameInput.value='';
  const riskSel=$('sc-risk'),objSel=$('sc-objective');
  if(riskSel)riskSel.value=$('plan-risk')?.value||'neutral';
  if(objSel)objSel.value=$('plan-objective')?.value||'fastest';
  const keepHazards=$('sc-keep-hazards');
  if(keepHazards)keepHazards.checked=false;
  const randBtn=$('sc-sites-random'),runBtn=$('sc-run'),hint=$('sc-hint');
  if(randBtn)randBtn.disabled=!apiReady;
  if(runBtn)runBtn.disabled=!apiReady;
  if(hint)hint.textContent=apiReady
    ?'Select sites to visit in this scenario, then click Save & Run.'
    :'Live planner required to run custom scenarios.';
  renderModalSiteList();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  nameInput?.focus();
}

function closeScenarioModal(){
  const modal=$('scenario-modal');
  if(!modal)return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
}

async function randomizeModalSites(){
  if(!apiReady)return;
  const seed=Math.floor(Math.random()*1_000_000_000);
  const hint=$('sc-hint');
  if(hint)hint.textContent='Generating a new site set…';
  try{
    const response=await fetch(`/api/sites?seed=${seed}`);
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const payload=await response.json();
    modalSeed=Number(payload.seed);
    modalSites=(payload.sites||[]).map(s=>({...s}));
    modalSelectedIds=modalSites.map(s=>s.id);
    renderModalSiteList();
    if(hint)hint.textContent=`Generated ${modalSites.length} candidate sites (seed ${modalSeed}).`;
  }catch(error){
    if(hint)hint.textContent=`Could not generate sites: ${error.message}`;
  }
}

async function saveAndRunModalScenario(){
  if(!apiReady)return;
  const rawName=($('sc-name')?.value||'').trim();
  const scenario={
    id:`custom-${Date.now().toString(36)}`,
    name:rawName||`Custom Scenario ${customScenarios.length+1}`,
    seed:modalSeed,
    sites:modalSites.map(s=>({...s})),
    site_ids:[...modalSelectedIds].sort((a,b)=>a-b),
    risk:$('sc-risk')?.value||'neutral',
    objective:$('sc-objective')?.value||'fastest',
    hazards:$('sc-keep-hazards')?.checked?hazards.map(h=>({...h})):[]
  };
  customScenarios.push(scenario);
  saveCustomScenarios();
  renderScenarioOptions();
  closeScenarioModal();
  await runScenario(scenario.id);
}

async function abortToSafehouse(){
  if(!apiReady)return;
  selectedSiteIds=[];
  renderSiteList();
  buildStops();
  await replan('Emergency abort to safehouse');
}

// --------------------------------------------------------------- replanning --
function setStatus(text){const element=$('mission-status');if(element)element.textContent=text}
function setHazardHint(text){const element=$('hazard-hint');if(element)element.textContent=text}

function setHazardMode(kind){
  if(kind&&measureMode)setMeasureMode(false);
  hazardMode=hazardMode===kind?null:kind;
  if(!hazardMode)clearHazardPreview();
  const dust=$('hazard-dust'),terrain=$('hazard-terrain');
  if(dust)dust.classList.toggle('active',hazardMode==='dust');
  if(terrain)terrain.classList.toggle('active',hazardMode==='terrain');
  renderer.domElement.style.cursor=hazardMode||measureMode?'crosshair':'grab';
  setHazardHint(hazardMode
    ?`Click terrain to place ${hazardMode==='dust'?'dust storm':'bad terrain'} · Esc to cancel`
    :'Choose a hazard, then click the terrain.');
}

function clearMeasure(){
  measurePoints=[];
  clearGroup(measureGroup);
  const out=$('measure-out');
  if(out){out.innerHTML='';out.classList.remove('visible')}
}

function setMeasureMode(on){
  measureMode=Boolean(on);
  if(measureMode&&hazardMode)setHazardMode(null);
  const btn=$('measure-btn');
  if(btn)btn.classList.toggle('active',measureMode);
  renderer.domElement.style.cursor=measureMode||hazardMode?'crosshair':'grab';
  const out=$('measure-out');
  if(measureMode&&!measurePoints.length&&out){
    out.textContent='Click two terrain points to measure distance & slope.';
    out.classList.add('visible');
  }else if(!measureMode&&measurePoints.length===0){
    clearMeasure();
  }
}

function updateMeasure(){
  clearGroup(measureGroup);
  const out=$('measure-out');
  if(!measurePoints.length){if(out){out.innerHTML='';out.classList.remove('visible')}return}
  for(const pt of measurePoints){
    const h=heightCached(pt.x,pt.z);
    const pin=new THREE.Mesh(new THREE.SphereGeometry(42,14,10),new THREE.MeshBasicMaterial({color:0x58a6ff}));
    pin.position.set(pt.x,h+35,pt.z);
    pin.renderOrder=9;
    measureGroup.add(pin);
  }
  if(measurePoints.length===1){
    if(out){out.textContent='Point A set · click point B on terrain.';out.classList.add('visible')}
    return;
  }
  const [a,b]=measurePoints;
  const flatDist=Math.hypot(b.x-a.x,b.z-a.z);
  const segs=Math.max(8,Math.ceil(flatDist/25));
  const linePos=[];
  let surfDist=0,maxSlope=0,prev=null,hStart=null,hEnd=null;
  for(let i=0;i<=segs;i++){
    const u=i/segs,x=a.x+(b.x-a.x)*u,z=a.z+(b.z-a.z)*u;
    const t=terrainAt(x,z);
    const h=heightCached(x,z);
    if(i===0)hStart=t.status==='valid'?t.elevation:h;
    if(i===segs)hEnd=t.status==='valid'?t.elevation:h;
    if(t.status==='valid'&&Number.isFinite(t.slope)&&t.slope>maxSlope)maxSlope=t.slope;
    if(prev)surfDist+=Math.hypot(x-prev.x,h-prev.h,z-prev.z);
    prev={x,h,z};
    linePos.push(x,h+14,z);
  }
  const line=new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(linePos,3)),
    new THREE.LineBasicMaterial({color:0x58a6ff})
  );
  line.renderOrder=9;
  measureGroup.add(line);
  const dElev=(hEnd??0)-(hStart??0);
  const fmtDist=d=>d>=1000?`${(d/1000).toFixed(2)} km`:`${Math.round(d)} m`;
  if(out){
    out.innerHTML=`Span: ${fmtDist(flatDist)} · Surface: ${fmtDist(surfDist)}<br>`
      +`ΔElev: ${dElev>=0?'+':''}${dElev.toFixed(1)} m · Max slope: ${maxSlope.toFixed(1)}° `
      +`<button type="button" id="measure-clear" style="height:18px;padding:0 5px;font-size:10px;margin-left:4px">Clear</button>`;
    out.classList.add('visible');
    const clr=$('measure-clear');if(clr)clr.onclick=clearMeasure;
  }
}

async function replan(reason,options={}){
  if(!apiReady){
    setHazardHint('Offline replay only. Run ./run_demo.sh (or cargo run --release -- --serve) to replan live.');
    return;
  }
  const freshStart=Boolean(options.freshStart);
  if(freshStart){
    completedStops.clear();
    stops=[];
    elapsedOffset=0;
    resourceBonus=zeroVec();
    progress=0;
    missionTime=0;
    pause();
    clearGhostRoute();
  }
  const shouldCompare=!freshStart&&options.compare!==false&&plan&&routePoints.length>1;
  const compareFrom=shouldCompare?{
    routePoints:routePoints.map(p=>({...p})),
    duration_s:plan.mission?.end_time_s??missionDuration,
    reward:plan.mission?.reward??0
  }:null;
  const wasPlaying=!freshStart&&playing;
  const state=freshStart?null:stateAt(missionTime);
  const start=freshStart
    ?{x_m:0,y_m:0}
    :(state&&Number.isFinite(state.x)&&Number.isFinite(state.z)
      ?{x_m:state.x,y_m:state.z}
      :{x_m:Number(routePoints[0]?.x_m)||0,y_m:Number(routePoints[0]?.y_m)||0});
  const spent=options.spentOverride||(freshStart?zeroVec():(state?effectiveSpent(state.spent):zeroVec()));
  const elapsed=freshStart?0:elapsedOffset+missionTime;
  if(!freshStart){
    for(const stop of stops){
      if(stop.completed||stop.timeVisited)completedStops.set(stop.id,{...stop,completed:true,timeVisited:true});
    }
  }
  const visited=freshStart?[]:[...completedStops.keys()];
  const token=++replanToken;
  setHazardHint(`${reason} · replanning…`);
  const body={
    hazards,
    start,
    spent_before:spent,
    elapsed_s:elapsed,
    visited_stop_ids:visited,
    risk:$('plan-risk')?.value||'neutral',
    objective:$('plan-objective')?.value||'fastest'
  };
  if(Number.isFinite(scienceSeed)){body.seed=scienceSeed;body.site_ids=selectedSiteIds}
  try{
    const response=await fetch('/api/plan',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const payload=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
    if(token!==replanToken)return;
    const abortBtn=$('abort-return');
    if(!response.ok||payload.error){
      setHazardHint(`Replan blocked: ${payload.error||`HTTP ${response.status}`}`);
      setStatus('Route blocked · clear hazards or Abort to Safehouse');
      if(abortBtn)abortBtn.classList.add('urgent');
      return;
    }
    if(abortBtn)abortBtn.classList.remove('urgent');
    const remaining=payload.stops?.length??0;
    const statusLabel=options.statusPrefix
      ?`${options.statusPrefix} · ${remaining} stop${remaining===1?'':'s'}`
      :`Replanned · ${remaining} stop${remaining===1?'':'s'} left`;
    setPlan(payload,{
      preserved:freshStart?[]:[...completedStops.values()],
      focus:Boolean(options.focus),
      compareFrom,
      clearGhost:freshStart||options.compare===false,
      status:statusLabel
    });
    setHazardHint(`${reason} · ${hazards.length} hazard${hazards.length===1?'':'s'} active · ${remaining} stop${remaining===1?'':'s'} left`);
    setScienceHint(selectedSummary());
    if(wasPlaying)play();
  }catch(error){
    if(token!==replanToken)return;
    setHazardHint(`Replan failed: ${error.message}. Is the Rust server running?`);
  }
}

async function placeHazard(kind,x_m,y_m){
  hazards.push({x_m,y_m,radius_m:hazardRadius,kind,severity:hazardSeverity});
  buildHazards();
  await replan(`Placed ${kind==='dust'?'a dust storm':'bad terrain'}`);
}

async function clearHazards(){
  if(!hazards.length)return;
  hazards=[];
  buildHazards();
  await replan('Cleared hazards');
}

async function undoHazard(){
  if(!hazards.length)return;
  hazards.pop();
  buildHazards();
  await replan('Removed the last hazard');
}

// --------------------------------------------------------------------- ui --
$('play').onclick=togglePlay;
$('restart').onclick=()=>{pause();resourceBonus=zeroVec();seek(0)};
$('scrub').oninput=event=>{pause();seek(Number(event.target.value)/1000)};
$('focus').onclick=focusRoute;
$('safe-toggle').onchange=event=>{const show=event.target.checked;if(safeMesh)safeMesh.visible=show;if(safeContour)safeContour.visible=show};
const followToggle=$('follow-toggle');
if(followToggle)followToggle.onchange=event=>{
  followAstronaut=event.target.checked;
  if(followAstronaut){
    const st=stateAt(missionTime);
    const x=st?st.x:astronautXY[0],z=st?st.z:astronautXY[1];
    focusPoint(x,z,6000);
  }
};
const clearGhostBtn=$('clear-ghost');
if(clearGhostBtn)clearGhostBtn.onclick=clearGhostRoute;
const abortBtn=$('abort-return');
if(abortBtn)abortBtn.onclick=abortToSafehouse;
const resupplyBtn=$('resupply-btn');
if(resupplyBtn)resupplyBtn.onclick=()=>replenishResources(1);

async function applyResourceTarget(targetSpent,reason){
  if(apiReady){
    await replan(reason,{spentOverride:targetSpent,compare:false});
    return;
  }
  const state=stateAt(missionTime),raw=state?state.spent:zeroVec();
  for(const key of RESOURCE_KEYS)resourceBonus[key]=(raw[key]||0)-targetSpent[key];
  applyProgress();
  setStatus(`${reason} (offline)`);
}

async function replenishResources(fraction=1){
  const amount=Math.min(1,Math.max(0,Number(fraction)||0));
  if(amount<=0)return;
  const state=stateAt(missionTime),spent=state?effectiveSpent(state.spent):zeroVec();
  const targetSpent=zeroVec();
  for(const key of RESOURCE_KEYS)targetSpent[key]=Math.max(0,spent[key]*(1-amount));
  await applyResourceTarget(targetSpent,'Resources replenished');
}

async function setRemainingResources(nextRemaining={}){
  if(!plan?.mission?.resources)return;
  const resources=plan.mission.resources,state=stateAt(missionTime),curSpent=state?effectiveSpent(state.spent):zeroVec();
  const targetSpent=zeroVec();
  for(const key of RESOURCE_KEYS){
    const total=resources[key]||0,val=Number(nextRemaining[key]);
    targetSpent[key]=Number.isFinite(val)?Math.min(total,Math.max(0,total-val)):curSpent[key];
  }
  await applyResourceTarget(targetSpent,'Resources updated');
}
const planRisk=$('plan-risk'),planObj=$('plan-objective');
if(planRisk)planRisk.onchange=()=>replan('Forecast risk updated');
if(planObj)planObj.onchange=()=>replan('Route objective updated');
const measureBtn=$('measure-btn');
if(measureBtn)measureBtn.onclick=()=>setMeasureMode(!measureMode);

// Interactive scrubbing directly on the elevation strip
const elevCanvas=$('elev-profile');
if(elevCanvas){
  let elevDrag=false;
  const scrubFromPointer=e=>{
    const rect=elevCanvas.getBoundingClientRect();
    const u=(e.clientX-rect.left)/Math.max(1,rect.width);
    pause();seek(u);
  };
  elevCanvas.addEventListener('pointerdown',e=>{elevDrag=true;elevCanvas.setPointerCapture(e.pointerId);scrubFromPointer(e)});
  elevCanvas.addEventListener('pointermove',e=>{if(elevDrag)scrubFromPointer(e)});
  elevCanvas.addEventListener('pointerup',e=>{elevDrag=false;elevCanvas.releasePointerCapture?.(e.pointerId)});
}

const radiusInput=$('hazard-radius'),severityInput=$('hazard-severity');
if(radiusInput){hazardRadius=Number(radiusInput.value);radiusInput.oninput=()=>{hazardRadius=Number(radiusInput.value);$('hazard-radius-val').textContent=`${(hazardRadius/1000).toFixed(1)} km`;if(hazardMode&&lastPreviewPos)updateHazardPreview(lastPreviewPos.x,lastPreviewPos.z)}}
if(severityInput){hazardSeverity=Number(severityInput.value);severityInput.oninput=()=>{hazardSeverity=Number(severityInput.value);$('hazard-severity-val').textContent=hazardSeverity.toFixed(1)}}
$('hazard-dust').onclick=()=>setHazardMode('dust');
$('hazard-terrain').onclick=()=>setHazardMode('terrain');
$('hazard-clear').onclick=clearHazards;
$('hazard-undo').onclick=undoHazard;
$('scenario-select').onchange=e=>runScenario(e.target.value);
$('create-scenario-btn').onclick=openScenarioModal;
$('reset-scenario-btn').onclick=resetToDefaultScenario;
$('sc-close').onclick=closeScenarioModal;
$('sc-cancel').onclick=closeScenarioModal;
$('scenario-modal').onclick=e=>{if(e.target===$('scenario-modal'))closeScenarioModal()};
$('sc-sites-random').onclick=randomizeModalSites;
$('sc-sites-all').onclick=()=>{modalSelectedIds=modalSites.map(s=>s.id);renderModalSiteList()};
$('sc-sites-none').onclick=()=>{modalSelectedIds=[];renderModalSiteList()};
$('sc-run').onclick=saveAndRunModalScenario;

window.REDLINE={setAstronaut:(x_m,y_m)=>{if(!Number.isFinite(x_m)||!Number.isFinite(y_m))throw Error('Expected metre coordinates');astronautXY=[x_m,y_m];placeAstronaut(x_m,y_m)},setEnvelope,terrainAt,resetView:reset,setPlan,setRoute,setStops,setSafeRegion,play,pause,seek,focusRoute,
  setHazards:async list=>{hazards=(list||[]).filter(h=>Number.isFinite(h.x_m)&&Number.isFinite(h.y_m)&&h.radius_m>0).map(h=>({x_m:h.x_m,y_m:h.y_m,radius_m:h.radius_m,kind:h.kind==='terrain'?'terrain':'dust',severity:Number(h.severity)||1}));buildHazards();await replan('Hazards updated')},
  getHazards:()=>hazards.map(hazard=>({...hazard})),
  replenish:replenishResources,
  setRemaining:setRemainingResources,
  runScenario,
  resetScenario:resetToDefaultScenario,
  replan};

async function boot(){
  loadCustomScenarios();
  try{
    const info=await fetch('/api/health').then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json()});
    apiReady=Boolean(info.ok);
  }catch{apiReady=false}
  const liveIds=['hazard-dust','hazard-terrain','hazard-clear','hazard-undo','plan-risk','plan-objective','abort-return','scenario-select','create-scenario-btn'];
  if(apiReady){
    for(const id of liveIds){const element=$(id);if(element)element.disabled=false}
    setHazardHint('Pick a hazard, then click the terrain. The Rust planner replans from the astronaut’s current position.');
    setScienceHint('Site report · click a site name to focus.');
  }else{
    for(const id of liveIds){const element=$(id);if(element)element.disabled=true}
    setHazardHint('Offline replay. Run ./run_demo.sh for live hazard replanning.');
    setScienceHint('Offline plan report · click a site name to focus.');
  }
  try{
    const response=await fetch(`./plan.json?t=${Date.now()}`);
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const loadedPlan=await response.json();
    defaultPlan=structuredClone(loadedPlan);
    setPlan(loadedPlan,{focus:true});
    renderScenarioOptions();
    setScienceHint(selectedSummary());
  }catch(error){
    console.warn('No plan.json yet - run `./run_demo.sh` from the repo root.',error);
    renderScenarioOptions();
    $('mission-status').textContent='No plan.json · run ./run_demo.sh';
    $('mission-badge').textContent='offline';
  }
}
boot();

const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
renderer.domElement.addEventListener('pointermove',e=>{
  if(!hazardMode)return;
  pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hit=rayTerrainFast(raycaster.ray);
  if(hit)updateHazardPreview(hit.x,hit.z);
  else clearHazardPreview();
});
renderer.domElement.addEventListener('pointerleave',clearHazardPreview);
renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup',async e=>{
  if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
  pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObject(base)[0];
  if(hazardMode){
    if(!hit){setHazardHint('Click directly on the terrain to place a hazard.');return}
    const status=terrainAt(hit.point.x,hit.point.z).status;
    if(status!=='valid'){setHazardHint('That cell has no DEM data. Pick another spot.');return}
    await placeHazard(hazardMode,hit.point.x,hit.point.z);
    return;
  }
  if(measureMode){
    if(!hit)return;
    if(measurePoints.length>=2)measurePoints=[];
    measurePoints.push({x:hit.point.x,z:hit.point.z});
    updateMeasure();
    return;
  }
  if(!hit){const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),point=new THREE.Vector3();if(raycaster.ray.intersectPlane(plane,point)){const status=terrainAt(point.x,point.z).status;readout.textContent=status==='nodata'?'DEM nodata':status==='outside_dataset'?'Outside DEM dataset':status==='outside_processed'?'Outside processed region':'No terrain intersection at this view'}else readout.textContent='No terrain intersection at this view';return}const x=hit.point.x,z=hit.point.z,t=terrainAt(x,z),rad=180/Math.PI,lon=(meta.landing.projected_x_m+x)/meta.mars_radius_m*rad,lat=(meta.landing.projected_y_m+z)/meta.mars_radius_m*rad;
 readout.innerHTML=`E ${x.toFixed(0)} m · N ${z.toFixed(0)} m<br>${Math.abs(lat).toFixed(5)}°${lat<0?'S':'N'} · ${lon.toFixed(5)}°E<br>${t.status==='valid'?`Elevation ${t.elevation.toFixed(1)} m · Relative ${t.relative>=0?'+':''}${t.relative.toFixed(1)} m<br>Slope ${Number.isFinite(t.slope)?t.slope.toFixed(1)+'°':'unavailable'} · ${t.imagery==='HiRISE'?'HiRISE imagery':'No high-resolution imagery'}`:t.status==='nodata'?'DEM nodata':t.status==='outside_dataset'?'Outside DEM dataset':'Outside processed region'}`
});
function updateLayerLegend(mode){
  const box=$('layer-legend'),bar=$('legend-bar'),minEl=$('legend-min'),maxEl=$('legend-max');
  if(!box||!bar||!minEl||!maxEl)return;
  if(mode==='elevation'){
    bar.style.background='linear-gradient(90deg, rgb(70,85,155), rgb(255,190,45))';
    minEl.textContent='-500 m rel';maxEl.textContent='+1,300 m rel';
    box.classList.add('visible');
  }else if(mode==='slope'){
    bar.style.background='linear-gradient(90deg, rgb(60,225,115), rgb(255,45,35))';
    minEl.textContent='0° flat';maxEl.textContent='30°+ steep';
    box.classList.add('visible');
  }else{
    box.classList.remove('visible');
  }
}
$('exaggeration').onchange=e=>{const factor=Number(e.target.value);world.scale.y=factor;$('warning').textContent=factor===1?'':`${factor}× vertical exaggeration · heights visually amplified`};
$('wire').onchange=e=>{baseMaterial.wireframe=e.target.checked;imagery.visible=!e.target.checked&&$('terrain-mode').value==='imagery'};
$('terrain-mode').onchange=e=>{const mode=e.target.value;baseMaterial.map=mode==='elevation'?elevationTexture:mode==='slope'?slopeTexture:neutralTexture;baseMaterial.needsUpdate=true;imagery.visible=mode==='imagery'&&!$('wire').checked;updateLayerLegend(mode)};
$('top').onclick=()=>{
  const dist=Math.max(controls.minDistance||25,camera.position.distanceTo(controls.target));
  camera.position.set(controls.target.x,controls.target.y+dist,controls.target.z+Math.max(0.5,dist*0.0005));
  controls.update();
};
$('reset').onclick=reset;
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);drawElevProfile()});
addEventListener('keydown',event=>{
  if(event.code==='Escape'){
    if(isScenarioModalOpen()){closeScenarioModal();return}
    if(hazardMode)setHazardMode(null);
    if(measureMode)setMeasureMode(false);
    return;
  }
  if(isScenarioModalOpen())return;
  if(event.code==='Space'&&event.target.tagName!=='INPUT'&&event.target.tagName!=='SELECT'&&event.target.tagName!=='BUTTON'&&event.target.tagName!=='TEXTAREA'){event.preventDefault();togglePlay()}
});
readout.textContent='Click the terrain to inspect coordinates, elevation, and slope.';
let lastFrame=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.25,(now-lastFrame)/1000);lastFrame=now;
 if(playing&&missionDuration>1){progress=Math.min(1,progress+dt*Number($('speed').value)/missionDuration);missionTime=progress*missionDuration;applyProgress();if(progress>=1)pause()}
 controls.update();renderer.render(scene,camera)}
animate(performance.now());
