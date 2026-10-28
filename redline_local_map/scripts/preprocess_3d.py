#!/usr/bin/env python3
"""Build a larger display-only DEM mesh and registered HiRISE texture."""
from pathlib import Path
import json
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.vrt import WarpedVRT
from rasterio.windows import from_bounds
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'web'
terrain=json.loads((ROOT/'data/processed/terrain_meta.json').read_text())
landing=terrain['landing']
# 28 km is within the DEM on all four sides of Bradbury (the eastern edge
# limits a centered square to about 28.3 km). Leave 12 km routing arrays intact.
SIZE_M=28000
N=769
STEP=SIZE_M/(N-1)
TEXTURE_SIZE=4096
cx,cy=landing['projected_x_m'],landing['projected_y_m']
left,top=cx-SIZE_M/2,cy+SIZE_M/2
# Raster cell centers, rather than pixel corners, are exactly at mesh vertices.
mesh_transform=from_origin(left-STEP/2,top+STEP/2,STEP,STEP)
with rasterio.open(ROOT/'data/raw/gale_dem_1m.tif') as ds:
    assert left>=ds.bounds.left and left+SIZE_M<=ds.bounds.right
    assert top<=ds.bounds.top and top-SIZE_M>=ds.bounds.bottom
    assert abs(float(ds.read(1,window=((landing['source_row'],landing['source_row']+1),(landing['source_column'],landing['source_column']+1)))[0,0])-landing['absolute_elevation_m'])<.001
    elevation=np.full((N,N),np.nan,np.float32)
    reproject(rasterio.band(ds,1),elevation,src_transform=ds.transform,src_crs=ds.crs,
              src_nodata=ds.nodata,dst_transform=mesh_transform,dst_crs=ds.crs,
              dst_nodata=np.nan,resampling=Resampling.bilinear,init_dest_nodata=True)
    mask=np.isfinite(elevation)
    relative=np.where(mask,elevation-landing['absolute_elevation_m'],np.nan).astype('<f4')
    relative.tofile(WEB/'terrain3d.bin')
    slope=np.full((N,N),np.nan,np.float32)
    good=mask[1:-1,1:-1]&mask[:-2,1:-1]&mask[2:,1:-1]&mask[1:-1,:-2]&mask[1:-1,2:]
    dz_e=(elevation[1:-1,2:]-elevation[1:-1,:-2])/(2*STEP)
    dz_n=(elevation[:-2,1:-1]-elevation[2:,1:-1])/(2*STEP)
    slope_mid=np.degrees(np.arctan(np.hypot(dz_e,dz_n)))
    slope[1:-1,1:-1][good]=slope_mid[good]
    np.stack((elevation,slope),axis=-1).astype('<f4').tofile(WEB/'terrain3d_query.bin')
texture_transform=from_origin(left,top,SIZE_M/TEXTURE_SIZE,SIZE_M/TEXTURE_SIZE)
with rasterio.open(ROOT/'data/raw/gale_hirise_color.tif') as ds:
    assert abs(ds.crs.to_wkt().count('3396190'))>0
    with WarpedVRT(ds,crs=ds.crs,transform=texture_transform,width=TEXTURE_SIZE,height=TEXTURE_SIZE,resampling=Resampling.bilinear) as vrt:
        rgb=np.moveaxis(vrt.read([1,2,3]),0,-1)
        # WarpedVRT can report a full-opaque mask outside source bounds when
        # the source has no explicit nodata. Build footprint and source-mask
        # coverage in projected space instead.
    mpp=SIZE_M/TEXTURE_SIZE
    east=left+(np.arange(TEXTURE_SIZE)+.5)*mpp
    north=top-(np.arange(TEXTURE_SIZE)+.5)*mpp
    cols=np.flatnonzero((east>=ds.bounds.left)&(east<ds.bounds.right))
    rows=np.flatnonzero((north<=ds.bounds.top)&(north>ds.bounds.bottom))
    alpha=np.zeros((TEXTURE_SIZE,TEXTURE_SIZE),np.uint8)
    if len(cols) and len(rows):
        c0,c1=cols[0],cols[-1]+1;r0,r1=rows[0],rows[-1]+1
        dest_left=left+c0*mpp;dest_right=left+c1*mpp
        dest_top=top-r0*mpp;dest_bottom=top-r1*mpp
        src_window=from_bounds(dest_left,dest_bottom,dest_right,dest_top,ds.transform)
        alpha[r0:r1,c0:c1]=ds.read_masks(1,window=src_window,out_shape=(r1-r0,c1-c0),resampling=Resampling.nearest)
    rgba=np.dstack((rgb,alpha))
    Image.fromarray(rgba,'RGBA').save(WEB/'hirise_registered.webp','WEBP',quality=88,method=6)
    imagery_bounds={'left':ds.bounds.left,'right':ds.bounds.right,'top':ds.bounds.top,'bottom':ds.bounds.bottom}
meta={'mesh':{'vertices_per_axis':N,'step_m':STEP,'size_m':SIZE_M,'local_left_m':-SIZE_M/2,'local_top_m':SIZE_M/2,
              'encoding':'little-endian float32 relative elevation; NaN invalid','file':'terrain3d.bin'},
      'texture':{'file':'hirise_registered.webp','size_px':TEXTURE_SIZE,'projected_left_m':left,'projected_top_m':top,
                 'metres_per_pixel':SIZE_M/TEXTURE_SIZE,'source_projected_bounds':imagery_bounds},
      'landing':landing,'mars_radius_m':3396190,'terrain_query':{'file':'terrain3d_query.bin','encoding':'little-endian float32 interleaved elevation_m,slope_deg',
                    'width_cells':N,'height_cells':N,'cell_size_m':STEP,'local_left_m':-SIZE_M/2,'local_top_m':SIZE_M/2},
      'validation':{'valid_vertices':int(mask.sum()),'total_vertices':N*N,'texture_alpha_coverage':float(np.count_nonzero(alpha)/alpha.size),
                    'bradbury_mesh_relative_m':float(relative[N//2,N//2])}}
(WEB/'terrain3d_meta.json').write_text(json.dumps(meta,indent=2))
print(f'{SIZE_M/1000:g} km × {SIZE_M/1000:g} km, mesh {N} × {N}, valid {mask.sum()}/{N*N}')
print('Bradbury DEM:',landing['absolute_elevation_m'],'mesh relative:',float(relative[N//2,N//2]))
print('HiRISE coverage:',meta['validation']['texture_alpha_coverage'])
for name in ('terrain3d.bin','terrain3d_query.bin','hirise_registered.webp'):
    print(name,(WEB/name).stat().st_size)
