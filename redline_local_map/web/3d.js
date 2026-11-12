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
function reset(){camera.position.set(18000,33000,48000);controls.target.set((left+meta.extent.local_right_m)/2,0,(top+meta.extent.local_bottom_m)/2);controls.update()}
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
function placeAstronaut(x,north){const h=terrainHeight(x,north);astronaut.visible=h!==null;if(h!==null)astronaut.position.set(x,h+ASTRO_LIFT,north)}
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
const routeGroup=new THREE.Group();missionGroup.add(routeGroup);
const stopGroup=new THREE.Group();missionGroup.add(stopGroup);
const siteGroup=new THREE.Group();missionGroup.add(siteGroup);
const hazardGroup=new THREE.Group();missionGroup.add(hazardGroup);
let plan=null,routePoints=[],routeSamples=[],timeline=[],missionDuration=0;
let stops=[],safeMesh=null,safeTexture=null,safeMeta=null,safeView=null,safeFrames=[],currentFrame=-1;
let progress=0,playing=false,missionTime=0;
// Runtime replanning state. `elapsedOffset` keeps the mission clock continuous
// across replans, and `completedStops` keeps sampled pins on the map.
let hazards=[],hazardMode=null,hazardRadius=1200,hazardSeverity=1;
let apiReady=false,elapsedOffset=0,totalStops=5,replanToken=0;
const completedStops=new Map();
let scienceSeed=null,siteList=[],selectedSiteIds=[];

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

function makeLabel(text,color){
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=96;
  const g=canvas.getContext('2d');
  g.fillStyle='rgba(8,12,15,.78)';g.strokeStyle='rgba(255,255,255,.28)';g.lineWidth=3;
  g.beginPath();g.roundRect(4,4,312,88,18);g.fill();g.stroke();
  g.font='600 54px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle=color;g.fillText(text,160,50);
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

function buildSafeRegion(region){
  if(!region||!region.width||!region.height)return;
  safeMeta={left:region.left_m,top:region.top_m,cell:region.cell_size_m,width:region.width,height:region.height};
  const stride=Math.max(1,Math.ceil(Math.max(region.width,region.height)/SAFE_MAX_AXIS));
  const gw=Math.ceil(region.width/stride),gh=Math.ceil(region.height/stride);
  safeView={w:gw,h:gh,stride};
  if(safeMesh){missionGroup.remove(safeMesh);safeMesh.geometry.dispose();safeMesh.material.dispose();safeMesh=null}
  if(safeTexture){safeTexture.dispose();safeTexture=null}
  const data=new Uint8Array(gw*gh*4);
  safeTexture=new THREE.DataTexture(data,gw,gh,THREE.RGBAFormat);
  safeTexture.minFilter=THREE.LinearFilter;safeTexture.magFilter=THREE.LinearFilter;safeTexture.needsUpdate=true;
  const vertexPositions=new Float32Array(gw*gh*3),vertexUvs=new Float32Array(gw*gh*2),valid=new Uint8Array(gw*gh),quads=[];
  const originCellSize=stride*safeMeta.cell;
  for(let r=0;r<gh;r++)for(let c=0;c<gw;c++){
    const i=r*gw+c;
    const x=safeMeta.left+(c+0.5)*originCellSize;
    const z=safeMeta.top-(r+0.5)*originCellSize;
    const h=terrainHeight(x,z);
    valid[i]=h===null?0:1;
    vertexPositions[i*3]=x;vertexPositions[i*3+1]=(h??0)+SAFE_LIFT;vertexPositions[i*3+2]=z;
    vertexUvs[i*2]=(c+0.5)/gw;vertexUvs[i*2+1]=(r+0.5)/gh;
  }
  for(let r=0;r<gh-1;r++)for(let c=0;c<gw-1;c++){
    const a=r*gw+c,b=a+1,d=a+gw+1,e=a+gw;
    if(valid[a]&&valid[b]&&valid[d]&&valid[e])quads.push(a,d,b,b,d,e);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(vertexPositions,3));
  g.setAttribute('uv',new THREE.BufferAttribute(vertexUvs,2));
  g.setIndex(quads);
  const material=new THREE.MeshBasicMaterial({map:safeTexture,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  safeMesh=new THREE.Mesh(g,material);safeMesh.renderOrder=1;
  safeMesh.visible=$('safe-toggle')?.checked??true;
  missionGroup.add(safeMesh);
  currentFrame=-1;
}

function setSafeCells(cells){
  if(!safeTexture||!safeMeta||!safeView)return;
  const {w:gw,h:gh,stride}=safeView;
  const {width,height}=safeMeta;
  const data=safeTexture.image.data;
  for(let r=0;r<gh;r++)for(let c=0;c<gw;c++){
    const sourceRow=Math.min(height-1,r*stride),sourceColumn=Math.min(width-1,c*stride);
    const on=cells[sourceRow*width+sourceColumn]?1:0;
    const k=(r*gw+c)*4;
    data[k]=64;data[k+1]=255;data[k+2]=150;data[k+3]=on?80:0;
  }
  safeTexture.needsUpdate=true;
}

function updateSafeFrame(fraction){
  if(!safeFrames.length)return;
  let index=0;
  for(let i=0;i<safeFrames.length;i++)if(safeFrames[i].t<=fraction+1e-9)index=i;
  if(index===currentFrame)return;
  currentFrame=index;
  setSafeCells(safeFrames[index].cells);
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

function updateHud(state){
  if(!state||!plan?.mission)return;
  const resources=plan.mission.resources||zeroVec();
  const remaining={};
  for(const key of RESOURCE_KEYS){
    remaining[key]=Math.max(0,(resources[key]||0)-(state.spent[key]||0));
    const total=resources[key]||1;
    const percent=Math.max(0,Math.min(100,remaining[key]/total*100));
    const bar=$(`bar-${key}`),label=$(`val-${key}`);
    if(bar)bar.style.width=`${percent}%`;
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
  for(const stop of stops){
    const visited=stop.completed||(Number.isFinite(stop.dwellStart)&&missionTime>=stop.dwellStart-1e-6);
    if(visited!==stop.timeVisited){
      stop.timeVisited=visited;
      if(stop.orb)stop.orb.material.color.setHex(visited?0x6effb0:0xff8c42);
      if(stop.pin)stop.pin.material.color.setHex(visited?0x6effb0:0xff8c42);
      if(stop.group)stop.group.scale.setScalar(visited?1.15:1);
    }
  }
  updateSafeFrame(progress);
  updateHud(state);
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

function focusRoute(){
  const points=[...routePoints.map(point=>({x:point.x_m,z:point.y_m})),...stops.map(stop=>({x:stop.x_m,z:stop.y_m}))];
  if(!points.length)return;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const point of points){minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minZ=Math.min(minZ,point.z);maxZ=Math.max(maxZ,point.z)}
  const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2,span=Math.max(maxX-minX,maxZ-minZ,900),distance=Math.max(span*0.95,1400);
  controls.target.set(cx,terrainHeight(cx,cz)??0,cz);
  camera.position.set(cx+distance*0.32,distance*0.92,cz+distance*0.78);
  controls.update();
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
  safeFrames=[{t:0,cells:cells.length===width*height?cells:new Uint8Array(width*height)}];
  setSafeCells(safeFrames[0].cells);
  currentFrame=0;
}

function setPlan(next,options={}){
  plan=next||{};
  progress=0;missionTime=0;playing=false;
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
  setSafeRegion(plan.safe_region);
  if(plan.safe_region&&frames.length){
    const count=plan.safe_region.width*plan.safe_region.height;
    safeFrames=frames.map(frame=>({t:Number(frame.t)||0,cells:unpackBits(frame.cells,count)})).sort((a,b)=>a.t-b.t);
    currentFrame=-1;updateSafeFrame(0);
  }
  setRoute(plan.route||[]);
  buildStops();
  buildTimeline();
  const start=plan.astronaut||routePoints[0]||{x_m:0,y_m:0};
  astronautXY=[start.x_m||0,start.y_m||0];placeAstronaut(astronautXY[0],astronautXY[1]);
  const remaining=stops.filter(stop=>!stop.completed).length;
  const badge=$('mission-badge');
  if(badge)badge.textContent=plan.mission
    ?`${remaining} left · ETA ${formatDuration(plan.mission.end_time_s??plan.mission.duration_s)}`
    :'plan.json';
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
  if(!siteList.length){box.innerHTML='<div class="hint">No science sites loaded.</div>';return}
  box.innerHTML=siteList.map(site=>{
    const checked=selectedSiteIds.includes(site.id);
    return `<label class="site${checked?' on':''}"><input type="checkbox" data-site="${site.id}"${checked?' checked':''}${apiReady?'':' disabled'}>`
      +`<span class="sname">S${site.id} ${escapeHtml(site.label)}</span>`
      +`<span class="sval">${(Number(site.reward)||0).toFixed(1)}</span></label>`;
  }).join('');
  for(const input of box.querySelectorAll('input[data-site]'))input.onchange=()=>setSiteSelected(Number(input.dataset.site),input.checked);
}

function setScienceHint(text){const element=$('science-hint');if(element)element.textContent=text}

function selectedSummary(){
  const planned=stops.filter(stop=>!stop.completed).length;
  return `${selectedSiteIds.length} of ${siteList.length} sites selected · ${planned} on this plan`;
}

async function setSiteSelected(id,on){
  selectedSiteIds=(on?[...new Set([...selectedSiteIds,id])]:selectedSiteIds.filter(value=>value!==id)).sort((a,b)=>a-b);
  renderSiteList();
  buildStops();
  await replan('Science selection updated');
}

async function selectAllSites(){
  selectedSiteIds=siteList.map(site=>site.id);
  renderSiteList();
  buildStops();
  await replan('All science sites selected');
}

async function clearSites(){
  selectedSiteIds=[];
  renderSiteList();
  buildStops();
  await replan('No science sites selected');
}

async function randomizeSites(){
  if(!apiReady){setScienceHint('Live site generation needs ./run_demo.sh.');return}
  const seed=Math.floor(Math.random()*1_000_000_000);
  setScienceHint('Generating a new site set…');
  try{
    const response=await fetch(`/api/sites?seed=${seed}`);
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const payload=await response.json();
    completedStops.clear();
    stops=[];
    scienceSeed=Number(payload.seed);
    siteList=(payload.sites||[]).map(site=>({...site}));
    selectedSiteIds=siteList.map(site=>site.id);
    renderSiteList();
    buildStops();
    await replan('New science sites generated');
  }catch(error){
    setScienceHint(`Could not generate sites: ${error.message}`);
  }
}

// --------------------------------------------------------------- replanning --
function setStatus(text){const element=$('mission-status');if(element)element.textContent=text}
function setHazardHint(text){const element=$('hazard-hint');if(element)element.textContent=text}

function setHazardMode(kind){
  hazardMode=hazardMode===kind?null:kind;
  const dust=$('hazard-dust'),terrain=$('hazard-terrain');
  if(dust)dust.classList.toggle('active',hazardMode==='dust');
  if(terrain)terrain.classList.toggle('active',hazardMode==='terrain');
  renderer.domElement.style.cursor=hazardMode?'crosshair':'grab';
  setHazardHint(hazardMode
    ?`Click the terrain to place ${hazardMode==='dust'?'a dust storm':'bad terrain'} · click the button again to cancel`
    :'Choose a hazard, then click the terrain.');
}

async function replan(reason){
  if(!apiReady){
    setHazardHint('Offline replay only. Run ./run_demo.sh (or cargo run --release -- --serve) to replan live.');
    return;
  }
  const wasPlaying=playing;
  const state=stateAt(missionTime);
  const start=state&&Number.isFinite(state.x)&&Number.isFinite(state.z)
    ?{x_m:state.x,y_m:state.z}
    :{x_m:Number(routePoints[0]?.x_m)||0,y_m:Number(routePoints[0]?.y_m)||0};
  const spent=state?state.spent:zeroVec();
  const elapsed=elapsedOffset+missionTime;
  for(const stop of stops){
    if(stop.completed||stop.timeVisited)completedStops.set(stop.id,{...stop,completed:true,timeVisited:true});
  }
  const visited=[...completedStops.keys()];
  const token=++replanToken;
  setHazardHint(`${reason} · replanning…`);
  const body={hazards,start,spent_before:spent,elapsed_s:elapsed,visited_stop_ids:visited};
  if(Number.isFinite(scienceSeed)){body.seed=scienceSeed;body.site_ids=selectedSiteIds}
  try{
    const response=await fetch('/api/plan',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const payload=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
    if(token!==replanToken)return;
    if(!response.ok||payload.error){
      setHazardHint(`Replan blocked: ${payload.error||`HTTP ${response.status}`}`);
      setStatus('Route unchanged · adjust or clear hazards');
      return;
    }
    const remaining=payload.stops?.length??0;
    setPlan(payload,{
      preserved:[...completedStops.values()],
      focus:false,
      status:`Replanned · ${remaining} stop${remaining===1?'':'s'} left`
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
$('restart').onclick=()=>{pause();seek(0)};
$('scrub').oninput=event=>{pause();seek(Number(event.target.value)/1000)};
$('focus').onclick=focusRoute;
$('safe-toggle').onchange=event=>{if(safeMesh)safeMesh.visible=event.target.checked};

const radiusInput=$('hazard-radius'),severityInput=$('hazard-severity');
if(radiusInput){hazardRadius=Number(radiusInput.value);radiusInput.oninput=()=>{hazardRadius=Number(radiusInput.value);$('hazard-radius-val').textContent=`${(hazardRadius/1000).toFixed(1)} km`}}
if(severityInput){hazardSeverity=Number(severityInput.value);severityInput.oninput=()=>{hazardSeverity=Number(severityInput.value);$('hazard-severity-val').textContent=hazardSeverity.toFixed(1)}}
$('hazard-dust').onclick=()=>setHazardMode('dust');
$('hazard-terrain').onclick=()=>setHazardMode('terrain');
$('hazard-clear').onclick=clearHazards;
$('hazard-undo').onclick=undoHazard;
$('sites-random').onclick=randomizeSites;
$('sites-all').onclick=selectAllSites;
$('sites-none').onclick=clearSites;

window.REDLINE={setAstronaut:(x_m,y_m)=>{if(!Number.isFinite(x_m)||!Number.isFinite(y_m))throw Error('Expected metre coordinates');astronautXY=[x_m,y_m];placeAstronaut(x_m,y_m)},setEnvelope,terrainAt,resetView:reset,setPlan,setRoute,setStops,setSafeRegion,play,pause,seek,focusRoute,
  setHazards:async list=>{hazards=(list||[]).filter(h=>Number.isFinite(h.x_m)&&Number.isFinite(h.y_m)&&h.radius_m>0).map(h=>({x_m:h.x_m,y_m:h.y_m,radius_m:h.radius_m,kind:h.kind==='terrain'?'terrain':'dust',severity:Number(h.severity)||1}));buildHazards();await replan('Hazards updated')},
  getHazards:()=>hazards.map(hazard=>({...hazard})),
  replan};

async function boot(){
  try{
    const info=await fetch('/api/health').then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json()});
    apiReady=Boolean(info.ok);
  }catch{apiReady=false}
  if(apiReady){
    for(const id of ['hazard-dust','hazard-terrain','hazard-clear','hazard-undo','sites-random','sites-all','sites-none']){const element=$(id);if(element)element.disabled=false}
    setHazardHint('Pick a hazard, then click the terrain. The Rust planner replans from the astronaut’s current position.');
    setScienceHint('Randomize the site set, or pick which sites to visit.');
  }else{
    for(const id of ['hazard-dust','hazard-terrain','hazard-clear','hazard-undo','sites-random','sites-all','sites-none']){const element=$(id);if(element)element.disabled=true}
    setHazardHint('Offline replay. Run ./run_demo.sh for live hazard replanning.');
    setScienceHint('Offline plan. Run ./run_demo.sh to regenerate sites and replan.');
  }
  try{
    const response=await fetch(`./plan.json?t=${Date.now()}`);
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    setPlan(await response.json(),{focus:false});
    setScienceHint(selectedSummary());
  }catch(error){
    console.warn('No plan.json yet - run `./run_demo.sh` from the repo root.',error);
    $('mission-status').textContent='No plan.json · run ./run_demo.sh';
    $('mission-badge').textContent='offline';
  }
}
boot();

const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
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
  if(!hit){const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),point=new THREE.Vector3();if(raycaster.ray.intersectPlane(plane,point)){const status=terrainAt(point.x,point.z).status;readout.textContent=status==='nodata'?'DEM nodata':status==='outside_dataset'?'Outside DEM dataset':status==='outside_processed'?'Outside processed region':'No terrain intersection at this view'}else readout.textContent='No terrain intersection at this view';return}const x=hit.point.x,z=hit.point.z,t=terrainAt(x,z),rad=180/Math.PI,lon=(meta.landing.projected_x_m+x)/meta.mars_radius_m*rad,lat=(meta.landing.projected_y_m+z)/meta.mars_radius_m*rad;
 readout.innerHTML=`E ${x.toFixed(0)} m · N ${z.toFixed(0)} m<br>${Math.abs(lat).toFixed(5)}°${lat<0?'S':'N'} · ${lon.toFixed(5)}°E<br>${t.status==='valid'?`Elevation ${t.elevation.toFixed(1)} m · Relative ${t.relative>=0?'+':''}${t.relative.toFixed(1)} m<br>Slope ${Number.isFinite(t.slope)?t.slope.toFixed(1)+'°':'unavailable'} · ${t.imagery==='HiRISE'?'HiRISE imagery':'No high-resolution imagery'}`:t.status==='nodata'?'DEM nodata':t.status==='outside_dataset'?'Outside DEM dataset':'Outside processed region'}`
});
$('exaggeration').onchange=e=>{const factor=Number(e.target.value);world.scale.y=factor;$('warning').textContent=factor===1?'':`${factor}× vertical exaggeration · heights visually amplified`};
$('wire').onchange=e=>{baseMaterial.wireframe=e.target.checked;imagery.visible=!e.target.checked&&$('terrain-mode').value==='imagery'};
$('terrain-mode').onchange=e=>{const mode=e.target.value;baseMaterial.map=mode==='elevation'?elevationTexture:mode==='slope'?slopeTexture:neutralTexture;baseMaterial.needsUpdate=true;imagery.visible=mode==='imagery'&&!$('wire').checked};
$('top').onclick=()=>{const cx=(left+meta.extent.local_right_m)/2,cz=(top+meta.extent.local_bottom_m)/2;camera.position.set(cx,75000,cz+1);controls.target.set(cx,0,cz);controls.update()};$('reset').onclick=reset;
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
addEventListener('keydown',event=>{if(event.code==='Space'&&event.target.tagName!=='INPUT'&&event.target.tagName!=='SELECT'){event.preventDefault();togglePlay()}});
readout.textContent='Click the terrain to inspect coordinates, elevation, and slope.';
let lastFrame=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min(.25,(now-lastFrame)/1000);lastFrame=now;
 if(playing&&missionDuration>1){progress=Math.min(1,progress+dt*Number($('speed').value)/missionDuration);missionTime=progress*missionDuration;applyProgress();if(progress>=1)pause()}
 controls.update();renderer.render(scene,camera)}
animate(performance.now());
