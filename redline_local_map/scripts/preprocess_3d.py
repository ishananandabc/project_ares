#!/usr/bin/env python3
"""Build a larger display-only DEM mesh and registered HiRISE texture."""
from pathlib import Path
import json
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.windows import from_bounds
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'web'
terrain=json.loads((ROOT/'data/processed/terrain_meta.json').read_text())
landing=terrain['landing']
# The eastern DEM edge limits a Bradbury-centered square to about 28.3 km.
# Shift the western edge out to show a modestly larger rectangle while keeping
# Bradbury at local (0, 0). The 12 km routing arrays remain untouched.
WIDTH_M=32000
HEIGHT_M=40000
LOCAL_LEFT_M=-18000
LOCAL_TOP_M=20000
STEP=40
COLS=WIDTH_M//STEP+1
ROWS=HEIGHT_M//STEP+1
TEXTURE_WIDTH=3200
TEXTURE_HEIGHT=4000
cx,cy=landing['projected_x_m'],landing['projected_y_m']
left,top=cx+LOCAL_LEFT_M,cy+LOCAL_TOP_M
# Raster cell centers, rather than pixel corners, are exactly at mesh vertices.
mesh_transform=from_origin(left-STEP/2,top+STEP/2,STEP,STEP)
with rasterio.open(ROOT/'data/raw/gale_dem_1m.tif') as ds:
    assert left>=ds.bounds.left and left+WIDTH_M<=ds.bounds.right
    assert top<=ds.bounds.top and top-HEIGHT_M>=ds.bounds.bottom
    assert abs(float(ds.read(1,window=((landing['source_row'],landing['source_row']+1),(landing['source_column'],landing['source_column']+1)))[0,0])-landing['absolute_elevation_m'])<.001
    elevation=np.full((ROWS,COLS),np.nan,np.float32)
    reproject(rasterio.band(ds,1),elevation,src_transform=ds.transform,src_crs=ds.crs,
              src_nodata=ds.nodata,dst_transform=mesh_transform,dst_crs=ds.crs,
              dst_nodata=np.nan,resampling=Resampling.bilinear,init_dest_nodata=True)
    mask=np.isfinite(elevation)
    relative=np.where(mask,elevation-landing['absolute_elevation_m'],np.nan).astype('<f4')
    relative.tofile(WEB/'terrain3d.bin')
    slope=np.full((ROWS,COLS),np.nan,np.float32)
    good=mask[1:-1,1:-1]&mask[:-2,1:-1]&mask[2:,1:-1]&mask[1:-1,:-2]&mask[1:-1,2:]
    dz_e=(elevation[1:-1,2:]-elevation[1:-1,:-2])/(2*STEP)
    dz_n=(elevation[:-2,1:-1]-elevation[2:,1:-1])/(2*STEP)
    slope_mid=np.degrees(np.arctan(np.hypot(dz_e,dz_n)))
    slope[1:-1,1:-1][good]=slope_mid[good]
    np.stack((elevation,slope),axis=-1).astype('<f4').tofile(WEB/'terrain3d_query.bin')
with rasterio.open(ROOT/'data/raw/gale_hirise_color.tif') as ds:
    assert abs(ds.crs.to_wkt().count('3396190'))>0
    # Both rasters use the same projected metres. Read only the HiRISE window
    # overlapping this texture grid; its remaining pixels stay transparent.
    mpp=STEP/4
    east=left+(np.arange(TEXTURE_WIDTH)+.5)*mpp
    north=top-(np.arange(TEXTURE_HEIGHT)+.5)*mpp
    cols=np.flatnonzero((east>=ds.bounds.left)&(east<ds.bounds.right))
    rows=np.flatnonzero((north<=ds.bounds.top)&(north>ds.bounds.bottom))
    alpha=np.zeros((TEXTURE_HEIGHT,TEXTURE_WIDTH),np.uint8)
    rgb=np.zeros((TEXTURE_HEIGHT,TEXTURE_WIDTH,3),np.uint8)
    if len(cols) and len(rows):
        c0,c1=cols[0],cols[-1]+1;r0,r1=rows[0],rows[-1]+1
        dest_left=left+c0*mpp;dest_right=left+c1*mpp
        dest_top=top-r0*mpp;dest_bottom=top-r1*mpp
        src_window=from_bounds(dest_left,dest_bottom,dest_right,dest_top,ds.transform)
        shape=(r1-r0,c1-c0)
        rgb[r0:r1,c0:c1]=np.moveaxis(ds.read([1,2,3],window=src_window,out_shape=(3,*shape),resampling=Resampling.bilinear,boundless=True),0,-1)
        alpha[r0:r1,c0:c1]=ds.read_masks(1,window=src_window,out_shape=shape,resampling=Resampling.nearest,boundless=True)
    rgba=np.dstack((rgb,alpha))
    Image.fromarray(rgba,'RGBA').save(WEB/'hirise_registered.png','PNG',compress_level=1)
    imagery_bounds={'left':ds.bounds.left,'right':ds.bounds.right,'top':ds.bounds.top,'bottom':ds.bounds.bottom}
meta={'mesh':{'width_vertices':COLS,'height_vertices':ROWS,'step_m':STEP,'width_m':WIDTH_M,'height_m':HEIGHT_M,'local_left_m':LOCAL_LEFT_M,'local_top_m':LOCAL_TOP_M,
              'encoding':'little-endian float32 relative elevation; NaN invalid','file':'terrain3d.bin'},
      'texture':{'file':'hirise_registered.png','width_px':TEXTURE_WIDTH,'height_px':TEXTURE_HEIGHT,'projected_left_m':left,'projected_top_m':top,
                 'metres_per_pixel':mpp,'source_projected_bounds':imagery_bounds},
      'landing':landing,'mars_radius_m':3396190,'terrain_query':{'file':'terrain3d_query.bin','encoding':'little-endian float32 interleaved elevation_m,slope_deg',
                    'width_cells':COLS,'height_cells':ROWS,'cell_size_m':STEP,'local_left_m':LOCAL_LEFT_M,'local_top_m':LOCAL_TOP_M},
      'validation':{'valid_vertices':int(mask.sum()),'total_vertices':ROWS*COLS,'texture_alpha_coverage':float(np.count_nonzero(alpha)/alpha.size),
                    'bradbury_mesh_relative_m':float(relative[LOCAL_TOP_M//STEP,-LOCAL_LEFT_M//STEP])}}
(WEB/'terrain3d_meta.json').write_text(json.dumps(meta,indent=2))
print(f'{WIDTH_M/1000:g} km × {HEIGHT_M/1000:g} km, mesh {COLS} × {ROWS}, valid {mask.sum()}/{ROWS*COLS}')
print('Bradbury DEM:',landing['absolute_elevation_m'],'mesh relative:',float(relative[LOCAL_TOP_M//STEP,-LOCAL_LEFT_M//STEP]))
print('HiRISE coverage:',meta['validation']['texture_alpha_coverage'])
for name in ('terrain3d.bin','terrain3d_query.bin','hirise_registered.png'):
    print(name,(WEB/name).stat().st_size)
