// Shared terrain manifest and query contract for the 2D and 3D viewers.
export async function loadTerrainBuild() {
  const response=await fetch('./terrain_build.json',{cache:'no-store'});
  if(!response.ok)throw Error(`Terrain manifest HTTP ${response.status}`);
  const manifest=await response.json();
  if(manifest.schema!==1||!manifest.build_id||!manifest.files?.mesh||!manifest.files?.query)throw Error('Unsupported terrain manifest');
  const url=name=>'./'+manifest.files[name].file;
  const read=async name=>{
    const r=await fetch(url(name),{cache:'no-cache'});
    if(!r.ok)throw Error(`${name} HTTP ${r.status}`);
    const data=await r.arrayBuffer();
    if(data.byteLength!==manifest.files[name].bytes)throw Error(`${name} size mismatch for build ${manifest.build_id}`);
    const digest=await crypto.subtle.digest('SHA-256',data);
    const hex=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    if(hex!==manifest.files[name].sha256)throw Error(`${name} checksum mismatch for build ${manifest.build_id}`);
    return data;
  };
  const [meshBuffer,queryBuffer]=await Promise.all([read('mesh'),read('query')]);
  const {width_vertices:w,height_vertices:h}=manifest.display;
  if(meshBuffer.byteLength!==w*h*4||queryBuffer.byteLength!==w*h*8)throw Error('Terrain grid dimensions disagree with assets');
  return {manifest,url,mesh:new Float32Array(meshBuffer),query:new DataView(queryBuffer)};
}

export function sampleTerrain(manifest,query,east,north) {
  const e=manifest.extent,d=manifest.display;
  const projectedX=manifest.landing.projected_x_m+east,projectedY=manifest.landing.projected_y_m+north;
  const source=manifest.source_dem.bounds;
  if(projectedX<source[0]||projectedX>=source[2]||projectedY<=source[1]||projectedY>source[3])return {status:'outside_dataset'};
  if(east<e.local_left_m||east>e.local_right_m||north<e.local_bottom_m||north>e.local_top_m)return {status:'outside_processed'};
  const c=Math.min(d.width_vertices-1,Math.max(0,Math.round((east-e.local_left_m)/d.cell_size_m)));
  const r=Math.min(d.height_vertices-1,Math.max(0,Math.round((e.local_top_m-north)/d.cell_size_m)));
  const off=(r*d.width_vertices+c)*8;
  const elevation=query.getFloat32(off,true),slope=query.getFloat32(off+4,true);
  if(!Number.isFinite(elevation))return {status:'nodata'};
  return {status:'valid',elevation,relative:elevation-manifest.landing.absolute_elevation_m,slope,
          resolution_m:d.cell_size_m};
}
