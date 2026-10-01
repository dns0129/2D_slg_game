"""Download public raw elevation tiles for the isolated map preview."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import math, subprocess, time

ROOT = Path(__file__).parent / 'source' / 'terrain'

def tile(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

jobs = set()
for west, south, east, north, z in [(65, -12, 148, 62, 6), (117, 26, 124.6, 33.3, 10)]:
    x0, y0 = tile(west, north, z)
    x1, y1 = tile(east, south, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            jobs.add((z, x, y))

def get(job):
    z, x, y = job
    path = ROOT / str(z) / str(x) / f'{y}.png'
    if path.exists() and path.stat().st_size > 100:
        return 'cached'
    path.parent.mkdir(parents=True, exist_ok=True)
    url = f'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'
    for attempt in range(4):
        try:
            payload = subprocess.run(['curl','-L','--fail','--silent','--max-time','35',url],check=True,capture_output=True).stdout
            if not payload.startswith(b'\x89PNG'):
                raise ValueError('Expected PNG elevation tile')
            path.write_bytes(payload)
            return 'downloaded'
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)

with ThreadPoolExecutor(max_workers=16) as pool:
    done = 0
    for future in as_completed([pool.submit(get, job) for job in sorted(jobs)]):
        future.result()
        done += 1
        if done % 30 == 0 or done == len(jobs):
            print(f'Elevation tiles: {done}/{len(jobs)}', flush=True)
