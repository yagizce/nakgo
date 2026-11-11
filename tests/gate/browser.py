"""Run only trusted, committed legacy or Ara/WhatsApp browser contracts."""
import argparse
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('trusted_browser_dispatch', ROOT/'tests/gate/browser-dispatch.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(ROOT))
    parser.add_argument('--base-sha')
    options = parser.parse_args()
    fixture, source = module.select_fixture(options.root, base_sha=options.base_sha)
    sys.argv = [str(fixture), '--root', options.root]
    exec(compile(source, str(fixture), 'exec'), {'__file__': str(fixture), '__name__': '__main__'})
