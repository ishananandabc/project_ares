import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const $=id=>document.getElementById(id), readout=$('readout');
const [meta, terrainMeta, heightsBuffer, queryBuffer, extendedQueryBuffer] = await Promise.all([
  fetch('./terrain3d_meta.json').then(checkJson),fetch('./terrain_meta.json').then(checkJson),
  fetch('./terrain3d.bin').then(checkBuffer),fetch('./terrain.bin').then(checkBuffer),fetch('./terrain3d_query.bin').then(checkBuffer)
]);
function checkJson(r){if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}
function checkBuffer(r){if(!r.ok)throw Error(`HTTP ${r.status}`);return r.arrayBuffer()}
const n=meta.mesh.vertices_per_axis, step=meta.mesh.step_m, left=meta.mesh.local_left_m, top=meta.mesh.local_top_m, heights=new Float32Array(heightsBuffer), query=new DataView(queryBuffer), extendedQuery=new DataView(extendedQueryBuffer);
if(heights.length!==n*n || query.byteLength!==terrainMeta.browser.width_cells*terrainMeta.browser.height_cells*8 || extendedQuery.byteLength!==n*n*8)throw Error('Terrain asset size mismatch');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x11171a);
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,1,100000);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;$('view').appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=25;controls.maxDistance=110000;controls.maxPolarAngle=Math.PI/2-.015;
function reset(){camera.position.set(14500,11500,22000);controls.target.set(0,0,0);controls.update()}
reset();
scene.add(new THREE.HemisphereLight(0xffffff,0x56504b,2.1));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-3500,7000,4500);scene.add(sun);
const world=new THREE.Group();scene.add(world);
const positions=new Float32Array(n*n*3),uvs=new Float32Array(n*n*2),indices=[];
for(let r=0;r<n;r++)for(let c=0;c<n;c++){const i=r*n+c;positions[i*3]=left+c*step;positions[i*3+1]=Number.isFinite(heights[i])?heights[i]:0;positions[i*3+2]=top-r*step;uvs[i*2]=c/(n-1);uvs[i*2+1]=1-r/(n-1)}
for(let r=0;r<n-1;r++)for(let c=0;c<n-1;c++){const a=r*n+c,b=a+1,d=a+n+1,e=a+n;
  if(Number.isFinite(heights[a])&&Number.isFinite(heights[b])&&Number.isFinite(heights[e]))indices.push(a,b,e);
  if(Number.isFinite(heights[b])&&Number.isFinite(heights[d])&&Number.isFinite(heights[e]))indices.push(b,d,e)
}
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
const baseMaterial=new THREE.MeshStandardMaterial({color:0x8b7666,roughness:1,side:THREE.DoubleSide});const base=new THREE.Mesh(geometry,baseMaterial);world.add(base);
const texture=await new THREE.TextureLoader().loadAsync('./hirise_registered.webp');texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
const imageMaterial=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.05,roughness:1,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});const imagery=new THREE.Mesh(geometry,imageMaterial);imagery.raycast=()=>{};world.add(imagery);
function terrainHeight(x,z){const c=(x-left)/step,r=(top-z)/step;if(c<0||r<0||c>n-1||r>n-1)return null;const c0=Math.min(n-2,Math.floor(c)),r0=Math.min(n-2,Math.floor(r)),u=c-c0,v=r-r0;const a=heights[r0*n+c0],b=heights[r0*n+c0+1],d=heights[(r0+1)*n+c0],e=heights[(r0+1)*n+c0+1];return [a,b,d,e].every(Number.isFinite)?(1-v)*((1-u)*a+u*b)+v*((1-u)*d+u*e):null}
function marker(color,radius){const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,16,12),new THREE.MeshBasicMaterial({color,depthTest:true}));world.add(mesh);return mesh}
const landing=marker(0xff493f,70),astronaut=marker(0x45dfff,60);let astronautXY=[0,0];
function place(mesh,x,north){const h=terrainHeight(x,north);mesh.visible=h!==null;if(h!==null)mesh.position.set(x,h+mesh.geometry.parameters.radius*.8,north)}
place(landing,0,0);place(astronaut,0,0);
const pole=new THREE.Mesh(new THREE.CylinderGeometry(10,10,180,8),new THREE.MeshBasicMaterial({color:0xff493f}));world.add(pole);pole.position.set(0,(terrainHeight(0,0)??0)+90,0);
let envelope=[],envelopeLine=null;
function setEnvelope(points){envelope=points||[];if(envelopeLine){world.remove(envelopeLine);envelopeLine.geometry.dispose();envelopeLine.material.dispose();envelopeLine=null}if(envelope.length<2)return;
 const coords=[];for(let i=0;i<envelope.length;i++){const a=envelope[i],b=envelope[(i+1)%envelope.length],length=Math.hypot(b.x_m-a.x_m,b.y_m-a.y_m),segments=Math.max(1,Math.ceil(length/step));for(let k=0;k<segments;k++){const t=k/segments,x=a.x_m+(b.x_m-a.x_m)*t,z=a.y_m+(b.y_m-a.y_m)*t,h=terrainHeight(x,z);if(h!==null)coords.push(x,h+8,z)}}
 if(coords.length<6)return;coords.push(coords[0],coords[1],coords[2]);envelopeLine=new THREE.Line(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(coords,3)),new THREE.LineBasicMaterial({color:0x33ff96,linewidth:2,depthTest:true}));world.add(envelopeLine)
}
function terrainAt(x,north){
 const b=terrainMeta.browser;
 // Preserve the finer 20 m terrain query inside the original operating area.
 if(x>=b.local_left_m&&north<=b.local_top_m&&x<b.local_left_m+b.width_cells*b.cell_size_m&&north>b.local_top_m-b.height_cells*b.cell_size_m){
  const c=Math.floor((x-b.local_left_m)/b.cell_size_m),r=Math.floor((b.local_top_m-north)/b.cell_size_m),o=(r*b.width_cells+c)*8;
  const elevation=query.getFloat32(o,true),slope=query.getFloat32(o+4,true);
  return Number.isFinite(elevation)?{status:'valid',elevation,relative:elevation-meta.landing.absolute_elevation_m,slope,resolution_m:b.cell_size_m}:{status:'nodata'};
 }
 const e=meta.terrain_query;
 if(x<e.local_left_m||north>e.local_top_m||x>e.local_left_m+(e.width_cells-1)*e.cell_size_m||north<e.local_top_m-(e.height_cells-1)*e.cell_size_m)return {status:'outside'};
 const c=Math.min(e.width_cells-1,Math.max(0,Math.round((x-e.local_left_m)/e.cell_size_m)));
 const r=Math.min(e.height_cells-1,Math.max(0,Math.round((e.local_top_m-north)/e.cell_size_m)));
 const o=(r*e.width_cells+c)*8,elevation=extendedQuery.getFloat32(o,true),slope=extendedQuery.getFloat32(o+4,true);
 return Number.isFinite(elevation)?{status:'valid',elevation,relative:elevation-meta.landing.absolute_elevation_m,slope,resolution_m:e.cell_size_m}:{status:'nodata'};
}
window.REDLINE={setAstronaut(x_m,y_m){if(!Number.isFinite(x_m)||!Number.isFinite(y_m))throw Error('Expected metre coordinates');astronautXY=[x_m,y_m];place(astronaut,x_m,y_m)},setEnvelope,terrainAt,resetView:reset};
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(base)[0];if(!hit){const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),point=new THREE.Vector3();if(raycaster.ray.intersectPlane(plane,point)){const status=terrainAt(point.x,point.z).status;readout.textContent=status==='nodata'?'DEM nodata':status==='outside'?'Outside processed terrain':'No terrain intersection at this view'}else readout.textContent='No terrain intersection at this view';return}const x=hit.point.x,z=hit.point.z,t=terrainAt(x,z),rad=180/Math.PI,lon=(meta.landing.projected_x_m+x)/meta.mars_radius_m*rad,lat=(meta.landing.projected_y_m+z)/meta.mars_radius_m*rad;
 readout.innerHTML=`E ${x.toFixed(0)} m · N ${z.toFixed(0)} m<br>${Math.abs(lat).toFixed(5)}°${lat<0?'S':'N'} · ${lon.toFixed(5)}°E<br>${t.status==='valid'?`Elevation ${t.elevation.toFixed(1)} m · Relative ${t.relative>=0?'+':''}${t.relative.toFixed(1)} m<br>Slope ${Number.isFinite(t.slope)?t.slope.toFixed(1)+'°':'unavailable'}`:t.status==='nodata'?'DEM nodata':'Outside processed terrain'}`
});
$('exaggeration').onchange=e=>{const factor=Number(e.target.value);world.scale.y=factor;$('warning').textContent=factor===1?'':`${factor}× vertical exaggeration · heights visually amplified`};
$('wire').onchange=e=>{baseMaterial.wireframe=e.target.checked;imagery.visible=!e.target.checked};
$('top').onclick=()=>{camera.position.set(0,36000,1);controls.target.set(0,0,0);controls.update()};$('reset').onclick=reset;
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
readout.textContent='Click the terrain to inspect coordinates, elevation, and slope.';
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}animate();
