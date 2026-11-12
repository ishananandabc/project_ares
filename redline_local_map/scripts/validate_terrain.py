#!/usr/bin/env python3
"""Check REDLINE's published terrain build; raw-data checks run when available."""
from pathlib import Path
import hashlib,json,math,sys
import numpy as np
from PIL import Image
import rasterio

ROOT=Path(__file__).resolve().parents[1];WEB=ROOT/'web'
m=json.loads((WEB/'terrain_build.json').read_text())
e=m['extent'];d=m['display'];landing=m['landing']
assert m['schema']==1 and len(m['build_id'])==12
assert abs(landing['projected_x_m']-8146815.194589)<.001
assert abs(landing['projected_y_m']+272041.224283)<.001
assert abs(landing['absolute_elevation_m']+4501.0283)<.01
assert (e['local_left_m'],e['local_right_m'],e['local_top_m'],e['local_bottom_m'])==(-18800,14150,27250,-30150)
assert e['width_m']==32950 and e['height_m']==57400
assert d['three_axes']=={'x':'east metres','y':'elevation relative to Bradbury metres','z':'north metres'}
for name,item in m['files'].items():
    p=WEB/item['file'];assert p.is_file(),p
    assert p.stat().st_size==item['bytes']
    assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'],p
h,w=d['height_vertices'],d['width_vertices'];cell=d['cell_size_m']
mesh=np.fromfile(WEB/m['files']['mesh']['file'],dtype='<f4').reshape(h,w)
query=np.fromfile(WEB/m['files']['query']['file'],dtype='<f4').reshape(h,w,2)
assert mesh.shape==(1149,660) and query.shape==(1149,660,2)
valid=np.isfinite(query[:,:,0]);assert np.array_equal(valid,np.isfinite(mesh))
assert np.allclose(mesh[valid],query[:,:,0][valid]-landing['absolute_elevation_m'],atol=.001)
assert abs(float(mesh[545,376]))<2
assert np.isnan(query[:,:,1]).sum()>0 and (~valid).sum()>0
# One step right means 50 m east; one step down means 50 m south.
assert e['local_left_m']+376*cell==0 and e['local_top_m']-545*cell==0
assert e['local_left_m']+377*cell==50 and e['local_top_m']-546*cell==-50
for name in ('neutral','elevation','slope','hirise'):
    im=Image.open(WEB/m['files'][name]['file']);assert im.mode=='RGBA'
assert Image.open(WEB/m['files']['hirise']['file']).getpixel((0,0))[3]==0
# Recompute a few display slopes from their four valid neighbours.
rng=np.random.default_rng(20261112)
interior=np.argwhere(valid[1:-1,1:-1]&valid[:-2,1:-1]&valid[2:,1:-1]&valid[1:-1,:-2]&valid[1:-1,2:])
for k in rng.choice(len(interior),min(30,len(interior)),replace=False):
    row,col=interior[k]+1
    dx=(query[row,col+1,0]-query[row,col-1,0])/(2*cell)
    dn=(query[row-1,col,0]-query[row+1,col,0])/(2*cell)
    expected=math.degrees(math.atan(math.hypot(dx,dn)))
    assert abs(float(query[row,col,1])-expected)<.001
raw=ROOT/'data/raw/gale_dem_1m.tif'
if raw.exists():
    regional=ROOT/'data/processed'
    elevation10=np.load(regional/'regional_elevation_m.npy',mmap_mode='r')
    relative10=np.load(regional/'regional_relative_elevation_m.npy',mmap_mode='r')
    slope10=np.load(regional/'regional_slope_deg.npy',mmap_mode='r')
    mask10=np.load(regional/'regional_valid_mask.npy',mmap_mode='r')
    assert elevation10.shape==(5740,3295)
    assert np.array_equal(np.isfinite(elevation10),mask10)
    for rr,cc in [(100,100),(2000,1000),(3000,2000),(5000,3000)]:
        if mask10[rr,cc]:
            assert abs(float(relative10[rr,cc])-(float(elevation10[rr,cc])-landing['absolute_elevation_m']))<.001
            if np.isfinite(slope10[rr,cc]):assert 0<=slope10[rr,cc]<90
    with rasterio.open(raw) as ds:
        assert ds.bounds.left<=e['projected_left_m']<e['projected_right_m']<=ds.bounds.right
        assert ds.bounds.bottom<=e['projected_bottom_m']<e['projected_top_m']<=ds.bounds.top
        row,col=ds.index(landing['projected_x_m'],landing['projected_y_m'])
        assert (row,col)==(27260,18821)
        assert abs(float(ds.read(1,window=((row,row+1),(col,col+1)))[0,0])-landing['absolute_elevation_m'])<.001
        chosen=interior[rng.choice(len(interior),30,replace=False)]+1
        coords=[(landing['projected_x_m']+e['local_left_m']+int(c)*cell,
                 landing['projected_y_m']+e['local_top_m']-int(r)*cell) for r,c in chosen]
        values=list(ds.sample(coords))
        for (r,c),sample in zip(chosen,values):
            assert abs(float(query[r,c,0])-float(sample[0]))<.001,(r,c,query[r,c,0],sample[0])
    print('Raw DEM: Bradbury and 30 random mesh samples matched')
else:print('Raw DEM absent; published asset checks passed')
print(f"Build {m['build_id']}: {w}×{h}, valid {valid.sum()}/{valid.size}, extent {e['width_m']/1000}×{e['height_m']/1000} km")
print('Asset hashes, nodata, slope, axes, source bounds: PASS')
