"""Run the shared strict Google/SDK flow-id acceptance on local Workers."""
import os, runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
os.environ.setdefault('NAKGO_AUTH_TEST_URL','http://127.0.0.1:8787/')
assert os.environ['NAKGO_AUTH_TEST_URL'].startswith('http://127.0.0.1:')
runpy.run_path(str(ROOT/'tests/auth_google_browser.py'),run_name='__main__')
