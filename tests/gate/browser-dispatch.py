"""Select only trusted fixtures, using the independently accepted contract hashes."""
import hashlib
import json
from pathlib import Path

TRUSTED_ROOT = Path(__file__).resolve().parents[2]

def read_regular(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('invalid_control_file')
    return path.read_bytes().replace(b'\r\n', b'\n')

def select_fixture(candidate_root, trusted_root=TRUSTED_ROOT):
    candidate_root = Path(candidate_root).resolve()
    trusted_root = Path(trusted_root).resolve()
    if (candidate_root/'tools').is_symlink():
        raise ValueError('invalid_candidate_tools')
    # The candidate's ledger, browser tests, flags and environment are never read.
    ledger = json.loads(read_regular(trusted_root/'.github/reviewed-controls.json', 65536))
    if ledger.get('version') != 1:
        raise ValueError('invalid_review_ledger')
    reviews = [r for r in ledger.get('reviews', []) if r.get('id') == 'listing-lifecycle-contract-v1']
    if len(reviews) != 1:
        raise ValueError('ambiguous_contract')
    files = reviews[0]['files']
    project_hash = hashlib.sha256(read_regular(candidate_root/'tools/project.js', 65536)).hexdigest()
    project = files['tools/project.js']
    if project['before'] == project['after']:
        raise ValueError('ambiguous_contract')
    mode = 'before' if project_hash == project['before'] else 'after' if project_hash == project['after'] else None
    if mode is None:
        raise ValueError('unreviewed_product_contract')
    fixture = trusted_root/'tests/gate'/('legacy-browser.py' if mode == 'before' else 'product-browser.py')
    source = read_regular(fixture, 131072)
    if hashlib.sha256(source).hexdigest() != files['tests/gate/browser.py'][mode]:
        raise ValueError('unreviewed_browser_fixture')
    return fixture, source
