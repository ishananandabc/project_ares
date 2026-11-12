#!/usr/bin/env python3
"""Build REDLINE regional terrain from the raw Gale DEM and HiRISE GeoTIFFs.

Outputs ignored 10 m computational arrays and committed, content-addressed web assets.
Run from any directory: .venv/bin/python scripts/build_terrain.py
"""
from __future__ import annotations
import hashlib
import json
import math
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw'
PROCESSED = ROOT / 'data/processed'
WEB = ROOT / 'web'
DEM = RAW / 'gale_dem_1m.tif'
HIRISE = RAW / 'gale_hirise_color.tif'
RADIUS = 3_396_190.0
LON, LAT = 137.4417, -4.5895
X0, Y0 = RADIUS * math.radians(LON), RADIUS * math.radians(LAT)
BRADBURY_Z = -4501.0283
# Keep a 20-30 m margin inside the native DEM footprint. Bradbury stays (0,0).
LEFT, RIGHT, TOP, BOTTOM = -18800.0, 14150.0, 27250.0, -30150.0
COMPUTE_M, DISPLAY_M = 10.0, 50.0
CW, CH = int((RIGHT-LEFT)/COMPUTE_M), int((TOP-BOTTOM)/COMPUTE_M)
VW, VH = int((RIGHT-LEFT)/DISPLAY_M)+1, int((TOP-BOTTOM)/DISPLAY_M)+1
TEX_W, TEX_H = 3072, round(3072*(TOP-BOTTOM)/(RIGHT-LEFT))


def read_dem(ds, width, height, cell, centers_are_vertices=False):
    x = X0 + LEFT - (cell/2 if centers_are_vertices else 0)
    y = Y0 + TOP + (cell/2 if centers_are_vertices else 0)
    dst = np.full((height,width), np.nan, np.float32)
    reproject(rasterio.band(ds,1), dst, src_transform=ds.transform, src_crs=ds.crs,
              src_nodata=ds.nodata, dst_transform=from_origin(x,y,cell,cell),
              dst_crs=ds.crs, dst_nodata=np.nan, init_dest_nodata=True,
              resampling=Resampling.nearest)
    return dst


def slope_from_elevation(elevation, cell):
    valid = np.isfinite(elevation)
    slope = np.full(elevation.shape, np.nan, np.float32)
    four = (valid[1:-1,1:-1] & valid[:-2,1:-1] & valid[2:,1:-1]
            & valid[1:-1,:-2] & valid[1:-1,2:])
    dx = (elevation[1:-1,2:] - elevation[1:-1,:-2]) / (2*cell)
    dn = (elevation[:-2,1:-1] - elevation[2:,1:-1]) / (2*cell)
    inner = np.degrees(np.arctan(np.hypot(dx,dn))).astype(np.float32)
    slope[1:-1,1:-1][four] = inner[four]
    return slope


def terrain_colors(elevation, slope, landing_z):
    valid = np.isfinite(elevation)
    # Real DEM lighting only; missing heights remain transparent.
    z = np.where(valid,elevation,0)
    dn, de = np.gradient(z,DISPLAY_M,DISPLAY_M)
    good = valid.copy()
    good[1:] &= valid[:-1]; good[:-1] &= valid[1:]
    good[:,1:] &= valid[:,:-1]; good[:,:-1] &= valid[:,1:]
    shade = np.clip(.72 + (-de*.8 + dn*.55), .30, 1.25)
    shade[~good] = .72
    neutral = np.zeros((*z.shape,4),np.uint8)
    for k,base in enumerate((142,119,102)):
        neutral[:,:,k] = np.clip(base*shade,0,255).astype(np.uint8)
    neutral[:,:,3] = np.where(valid,255,0).astype(np.uint8)
    relative = np.clip((elevation-landing_z+500)/1800,0,1)
    tint = np.zeros_like(neutral)
    tint[:,:,0] = np.nan_to_num(70+185*relative).astype(np.uint8)
    tint[:,:,1] = np.nan_to_num(85+105*relative).astype(np.uint8)
    tint[:,:,2] = np.nan_to_num(155-110*relative).astype(np.uint8)
    tint[:,:,3] = neutral[:,:,3]
    steep = np.clip(np.nan_to_num(slope,nan=0)/30,0,1)
    slope_tint = np.zeros_like(neutral)
    slope_tint[:,:,0] = (60+195*steep).astype(np.uint8)
    slope_tint[:,:,1] = (180*(1-steep)+45).astype(np.uint8)
    slope_tint[:,:,2] = (80*(1-steep)+35).astype(np.uint8)
    slope_tint[:,:,3] = neutral[:,:,3]
    return neutral,tint,slope_tint


def imagery(ds):
    rgba = np.zeros((TEX_H,TEX_W,4),np.uint8)
    minx,maxx = X0+LEFT,X0+RIGHT
    maxy,miny = Y0+TOP,Y0+BOTTOM
    assert ds.bounds.left < maxx and ds.bounds.right > minx
    mx=(maxx-minx)/TEX_W; my=(maxy-miny)/TEX_H
    east=minx+(np.arange(TEX_W)+.5)*mx
    north=maxy-(np.arange(TEX_H)+.5)*my
    cols=np.flatnonzero((east>=ds.bounds.left)&(east<ds.bounds.right))
    rows=np.flatnonzero((north<=ds.bounds.top)&(north>ds.bounds.bottom))
    if not len(cols) or not len(rows): return rgba
    c0,c1=cols[0],cols[-1]+1;r0,r1=rows[0],rows[-1]+1
    window=from_bounds(minx+c0*mx,maxy-r1*my,minx+c1*mx,maxy-r0*my,ds.transform)
    shape=(r1-r0,c1-c0)
    rgba[r0:r1,c0:c1,:3] = np.moveaxis(ds.read([1,2,3],window=window,out_shape=(3,*shape),resampling=Resampling.bilinear,boundless=True),0,-1)
    rgba[r0:r1,c0:c1,3] = ds.read_masks(1,window=window,out_shape=shape,resampling=Resampling.nearest,boundless=True)
    return rgba


def file_sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(4*1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def main():
    PROCESSED.mkdir(parents=True,exist_ok=True);WEB.mkdir(parents=True,exist_ok=True)
    if not DEM.exists() or not HIRISE.exists():
        raise SystemExit('Missing raw GeoTIFFs. Run bash scripts/download_data.sh all')
    assert abs(X0-8146815.194589)<.001 and abs(Y0+272041.224283)<.001
    with rasterio.open(DEM) as ds:
        assert ds.count==1 and ds.nodata==-32767 and ds.res==(1,1)
        assert X0+LEFT>=ds.bounds.left and X0+RIGHT<=ds.bounds.right
        assert Y0+TOP<=ds.bounds.top and Y0+BOTTOM>=ds.bounds.bottom
        row,col=ds.index(X0,Y0)
        landing_z=float(ds.read(1,window=((row,row+1),(col,col+1)))[0,0])
        assert (row,col)==(27260,18821) and abs(landing_z-BRADBURY_Z)<.01
        compute = read_dem(ds,CW,CH,COMPUTE_M)
        display = read_dem(ds,VW,VH,DISPLAY_M,True)
        dem_source={'file':'data/raw/gale_dem_1m.tif','url':'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif',
                    'width':ds.width,'height':ds.height,'nodata':ds.nodata,'transform':list(ds.transform)[:6],
                    'bounds':list(ds.bounds),'resolution_m':1,'crs_wkt':ds.crs.to_wkt()}
    valid=np.isfinite(compute)
    np.save(PROCESSED/'regional_elevation_m.npy',compute)
    np.save(PROCESSED/'regional_relative_elevation_m.npy',(compute-landing_z).astype(np.float32))
    np.save(PROCESSED/'regional_slope_deg.npy',slope_from_elevation(compute,COMPUTE_M))
    np.save(PROCESSED/'regional_valid_mask.npy',valid)
    display_slope=slope_from_elevation(display,DISPLAY_M)
    compute=None;valid=None
    with rasterio.open(HIRISE) as ds:
        assert ds.res==(.25,.25)
        assert ds.index(X0,Y0)==(8164,27260)
        color=imagery(ds)
        image_source={'file':'data/raw/gale_hirise_color.tif','url':'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif',
                      'width':ds.width,'height':ds.height,'transform':list(ds.transform)[:6],
                      'bounds':list(ds.bounds),'resolution_m':.25,'crs_wkt':ds.crs.to_wkt()}
    neutral,elevation_tint,slope_tint=terrain_colors(display,display_slope,landing_z)
    with tempfile.TemporaryDirectory(prefix='.terrain-build-',dir=WEB) as tmpdir:
        tmp=Path(tmpdir)
        (tmp/'mesh.bin').write_bytes(np.where(np.isfinite(display),display-landing_z,np.nan).astype('<f4').tobytes())
        (tmp/'query.bin').write_bytes(np.stack((display,display_slope),axis=-1).astype('<f4').tobytes())
        for name,arr in [('neutral.png',neutral),('elevation.png',elevation_tint),('slope.png',slope_tint),('hirise.png',color)]:
            Image.fromarray(arr,'RGBA').save(tmp/name,'PNG',compress_level=1)
        logical=['mesh.bin','query.bin','neutral.png','elevation.png','slope.png','hirise.png']
        hashes={name:file_sha(tmp/name) for name in logical}
        version=hashlib.sha256((''.join(hashes.values())+str((LEFT,RIGHT,TOP,BOTTOM,COMPUTE_M,DISPLAY_M))).encode()).hexdigest()[:12]
        files={}
        for name in logical:
            stem,ext=name.rsplit('.',1)
            target=f'terrain-{stem}-{version}.{ext}'
            (tmp/name).replace(WEB/target)
            files[stem]={'file':target,'sha256':hashes[name],'bytes':(WEB/target).stat().st_size}
    manifest={
       'schema':1,'build_id':version,'source_dem':dem_source,'source_imagery':image_source,
       'landing':{'name':'Bradbury Landing','longitude_deg_east':LON,'latitude_deg':LAT,
                  'projected_x_m':X0,'projected_y_m':Y0,'absolute_elevation_m':landing_z,
                  'source_row':row,'source_column':col},
       'mars_radius_m':RADIUS,
       'extent':{'local_left_m':LEFT,'local_right_m':RIGHT,'local_top_m':TOP,'local_bottom_m':BOTTOM,
                 'projected_left_m':X0+LEFT,'projected_right_m':X0+RIGHT,'projected_top_m':Y0+TOP,'projected_bottom_m':Y0+BOTTOM,
                 'width_m':RIGHT-LEFT,'height_m':TOP-BOTTOM},
       'computational':{'cell_size_m':COMPUTE_M,'width_cells':CW,'height_cells':CH,'grid_cell':'center','row_direction':'south','arrays':{
           'elevation_m':'regional_elevation_m.npy','relative_elevation_m':'regional_relative_elevation_m.npy',
           'slope_deg':'regional_slope_deg.npy','valid_mask':'regional_valid_mask.npy'}},
       'display':{'cell_size_m':DISPLAY_M,'width_vertices':VW,'height_vertices':VH,'grid_vertex':'projected left/top plus column/row times cell size',
                  'row_direction':'south','three_axes':{'x':'east metres','y':'elevation relative to Bradbury metres','z':'north metres'},
                  'query_encoding':'little-endian float32 interleaved absolute_elevation_m,slope_deg; NaN invalid'},
       'texture':{'width_px':TEX_W,'height_px':TEX_H,'coverage_fraction':float(np.count_nonzero(color[:,:,3])/color[:,:,3].size)},
       'files':files,'validation':{'valid_display_vertices':int(np.isfinite(display).sum()),'total_display_vertices':VW*VH,
                                   'bradbury_display_relative_m':float(display[int(TOP/DISPLAY_M),int(-LEFT/DISPLAY_M)]-landing_z)}
    }
    encoded=json.dumps(manifest,indent=2).encode()+b'\n'
    (WEB/'terrain_build.json.tmp').write_bytes(encoded)
    (WEB/'terrain_build.json.tmp').replace(WEB/'terrain_build.json')
    (PROCESSED/'regional_meta.json').write_bytes(encoded)
    print(f'Build {version}: {(RIGHT-LEFT)/1000:g} × {(TOP-BOTTOM)/1000:g} km, {VW} × {VH} display vertices')
    print(f'Bradbury source elevation {landing_z:.4f} m, local (0,0) = ({X0:.3f},{Y0:.3f}) projected m')
    print(f'Valid display vertices {manifest["validation"]["valid_display_vertices"]}/{VW*VH}, imagery coverage {manifest["texture"]["coverage_fraction"]:.3%}')
    for entry in files.values(): print(entry['file'],entry['bytes'])

if __name__=='__main__': main()
