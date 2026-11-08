"""Select a committed, trusted fixture for the known browser contracts."""
import subprocess
from pathlib import Path

TRUSTED_ROOT = Path(__file__).resolve().parents[2]
INBOX = b'  "src/js/screens/inbox.js",\n'
ROAD_MAP = b'  "src/js/screens/road-map.js",\n'

def read_regular(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('invalid_control_file')
    return path.read_bytes().replace(b'\r\n', b'\n')

def read_trusted(root, relative, limit):
    source = read_regular(root/relative, limit)
    try:
        committed = subprocess.check_output(
            ['git', '--no-replace-objects', '-C', str(root), 'show', f'HEAD:{relative}'],
            stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError('invalid_trusted_checkout') from error
    if source != committed.replace(b'\r\n', b'\n'):
        raise ValueError('untrusted_browser_fixture')
    return source

def select_fixture(candidate_root, trusted_root=TRUSTED_ROOT):
    candidate_root = Path(candidate_root).resolve()
    trusted_root = Path(trusted_root).resolve()
    if (candidate_root/'tools').is_symlink():
        raise ValueError('invalid_candidate_tools')
    # Candidate manifest bytes select a known contract; candidate code is never loaded.
    trusted = read_trusted(trusted_root, 'tools/project.js', 65536)
    if trusted.count(INBOX) > 1 or trusted.count(ROAD_MAP) != 1:
        raise ValueError('ambiguous_contract')
    legacy = trusted if INBOX in trusted else trusted.replace(ROAD_MAP, INBOX + ROAD_MAP, 1)
    candidate = read_regular(candidate_root/'tools/project.js', 65536)
    if candidate == legacy:
        name = 'legacy-browser.py'
    elif candidate == legacy.replace(INBOX, b'', 1):
        name = 'product-browser.py'
    else:
        raise ValueError('unknown_product_contract')
    relative = f'tests/gate/{name}'
    return trusted_root/relative, read_trusted(trusted_root, relative, 131072)
