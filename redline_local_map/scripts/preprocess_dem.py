#!/usr/bin/env python3
"""Build a Bradbury-centered terrain grid and compact browser sampling grid."""
from pathlib import Path
import argparse
import json
import sys
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject

sys.path.insert(0, str(Path(__file__).parent))
from _mars_common import LANDING_LON, LANDING_LAT, landing_xy

ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', type=Path, default=ROOT / 'data/raw/gale_dem_1m.tif')
    p.add_argument('--width-km', type=float, default=12)
    p.add_argument('--height-km', type=float, default=12)
    p.add_argument('--cell-m', type=float, default=5)
    p.add_argument('--browser-cell-m', type=float, default=20)
    a = p.parse_args()
    if min(a.width_km, a.height_km, a.cell_m, a.browser_cell_m) <= 0:
        p.error('dimensions and cell sizes must be positive')
    width_m, height_m = a.width_km*1000, a.height_km*1000
    w, h = round(width_m/a.cell_m), round(height_m/a.cell_m)
    if not np.isclose(w*a.cell_m, width_m) or not np.isclose(h*a.cell_m, height_m):
        p.error('operating area must be an integer number of terrain cells')
    out = ROOT / 'data/processed'
    out.mkdir(parents=True, exist_ok=True)
    with rasterio.open(a.input) as ds:
        cx, cy = landing_xy(ds)
        expected_x, expected_y = 8146815.1945889965, -272041.2242832139
        if abs(cx-expected_x) > .1 or abs(cy-expected_y) > .1:
            raise RuntimeError(f'DEM CRS places Bradbury at {(cx,cy)}, expected {(expected_x,expected_y)}')
        row, col = ds.index(cx, cy)
        landing_elevation = float(ds.read(1, window=((row,row+1),(col,col+1)))[0,0])
        if abs(landing_elevation - (-4501.0283)) > .02:
            raise RuntimeError(f'Unexpected Bradbury elevation: {landing_elevation}')
        left, top = cx-width_m/2, cy+height_m/2
        if left < ds.bounds.left or left+width_m > ds.bounds.right or top > ds.bounds.top or top-height_m < ds.bounds.bottom:
            raise RuntimeError('Requested area extends beyond DEM coverage')
        transform = from_origin(left, top, a.cell_m, a.cell_m)
        elevation = np.full((h,w), np.nan, np.float32)
        reproject(rasterio.band(ds,1), elevation, src_transform=ds.transform, src_crs=ds.crs,
                  src_nodata=ds.nodata, dst_transform=transform, dst_crs=ds.crs,
                  dst_nodata=np.nan, resampling=Resampling.bilinear, init_dest_nodata=True)
        # Require the full interpolation footprint to be valid. This keeps the
        # resampler from bridging source voids or the edge of coverage.
        source_valid = ds.read_masks(1)
        coverage = np.zeros((h,w), np.float32)
        reproject(source_valid.astype(np.float32)/255, coverage, src_transform=ds.transform,
                  src_crs=ds.crs, dst_transform=transform, dst_crs=ds.crs,
                  resampling=Resampling.bilinear)
        valid = np.isfinite(elevation) & (coverage >= .999)
        elevation[~valid] = np.nan
        relative = elevation - landing_elevation
        slope = np.full((h,w), np.nan, np.float32)
        interior = valid[1:-1,1:-1] & valid[:-2,1:-1] & valid[2:,1:-1] & valid[1:-1,:-2] & valid[1:-1,2:]
        dzdx = (elevation[1:-1,2:] - elevation[1:-1,:-2])/(2*a.cell_m)
        dzdy = (elevation[:-2,1:-1] - elevation[2:,1:-1])/(2*a.cell_m)
        local_slope = np.degrees(np.arctan(np.hypot(dzdx,dzdy))).astype(np.float32)
        slope[1:-1,1:-1][interior] = local_slope[interior]
        for name, arr in [('elevation_m',elevation),('relative_elevation_m',relative),('slope_deg',slope),('valid_mask',valid)]:
            np.save(out / f'{name}.npy', arr)
        bw, bh = round(width_m/a.browser_cell_m), round(height_m/a.browser_cell_m)
        if not np.isclose(bw*a.browser_cell_m,width_m) or not np.isclose(bh*a.browser_cell_m,height_m):
            p.error('operating area must be an integer number of browser cells')
        browser_transform = from_origin(left,top,a.browser_cell_m,a.browser_cell_m)
        browser = np.full((2,bh,bw),np.nan,np.float32)
        for i, arr in enumerate((elevation,slope)):
            reproject(arr,browser[i],src_transform=transform,src_crs=ds.crs,src_nodata=np.nan,
                      dst_transform=browser_transform,dst_crs=ds.crs,dst_nodata=np.nan,
                      resampling=Resampling.nearest)
        browser.transpose(1,2,0).astype('<f4').tofile(ROOT / 'web/terrain.bin')
        meta = {
            'source': str(a.input.relative_to(ROOT)), 'source_crs_wkt': ds.crs.to_wkt(),
            'landing': {'longitude_deg_east':LANDING_LON,'latitude_deg':LANDING_LAT,
                        'projected_x_m':cx,'projected_y_m':cy,'source_row':row,'source_column':col,
                        'absolute_elevation_m':landing_elevation},
            'grid': {'width_cells':w,'height_cells':h,'cell_size_m':a.cell_m,
                     'local_left_m':-width_m/2,'local_top_m':height_m/2,
                     'projected_left_m':left,'projected_top_m':top,
                     'row_direction':'south','column_direction':'east',
                     'cell_coordinates':'center'},
            'arrays': {'elevation_m':'elevation_m.npy','relative_elevation_m':'relative_elevation_m.npy',
                       'slope_deg':'slope_deg.npy','valid_mask':'valid_mask.npy'},
            'browser': {'file':'terrain.bin','encoding':'little-endian float32 interleaved elevation_m,slope_deg',
                        'width_cells':bw,'height_cells':bh,'cell_size_m':a.browser_cell_m,
                        'local_left_m':-width_m/2,'local_top_m':height_m/2},
            'validation': {'valid_cells':int(valid.sum()),'slope_valid_cells':int(np.isfinite(slope).sum())}
        }
        (out/'terrain_meta.json').write_text(json.dumps(meta,indent=2))
        (ROOT/'web/terrain_meta.json').write_text(json.dumps({'landing':meta['landing'],'browser':meta['browser'],'grid':meta['grid']},indent=2))
        assert np.isclose(meta['landing']['projected_x_m']+0,cx) and np.isclose(meta['landing']['projected_y_m']+0,cy)
        print(f'Bradbury DEM cell ({col}, {row}): {landing_elevation:.4f} m')
        print(f'Local (0,0) -> projected ({cx:.6f}, {cy:.6f})')
        print(f'Grid {w}x{h}, valid {valid.sum()}/{w*h}, slope valid {np.isfinite(slope).sum()}')
        print(f'Browser {bw}x{bh}, {ROOT / "web/terrain.bin"}')

if __name__ == '__main__':
    main()
