"""Reuse existing admin acceptance assertions against local Workers Static Assets.
Only the page URL is substituted; RPC responses remain synthetic fixtures.
"""
import os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
url=os.environ.get('NAKGO_CF_URL','http://127.0.0.1:8787/')
assert url.startswith('http://127.0.0.1:'), 'Local runtime tests only'
for relative in ['tests/admin_panel_browser.py','tests/whatsapp/browser.py']:
    filename=ROOT/relative
    source=filename.read_text(encoding='utf-8')
    needle="(ROOT/'index.html').as_uri()"
    assert source.count(needle)==1, 'Fixture URL changed; inspect before adapting'
    source=source.replace(needle,repr(url))
    exec(compile(source,str(filename),'exec'),{'__file__':str(filename),'__name__':'__main__'})
print('Existing admin + WhatsApp browser fixtures passed on Workers Static Assets')
