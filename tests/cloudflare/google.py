"""Run existing Google acceptance on Workers; validate the SDK flow-id query too.
The upstream fixture assumes a bare redirect URL. SDK 2.117.3 adds sb_flow_id.
No protected fixture or production application source is changed.
"""
import os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
os.environ.setdefault('NAKGO_AUTH_TEST_URL','http://127.0.0.1:8787/')
assert os.environ['NAKGO_AUTH_TEST_URL'].startswith('http://127.0.0.1:')
p=ROOT/'tests/auth_google_browser.py'
s=p.read_text(encoding='utf-8')
needle="assert q['provider']==['google'] and q['redirect_to']==[BASE]"
replacement="""assert q['provider']==['google'] and len(q['redirect_to'])==1
                    redirect=urllib.parse.urlparse(q['redirect_to'][0]);base=urllib.parse.urlparse(BASE)
                    assert redirect._replace(query='')==base
                    flow=urllib.parse.parse_qs(redirect.query)
                    assert set(flow)=={'sb_flow_id'} and len(flow['sb_flow_id'])==1
                    assert len(flow['sb_flow_id'][0])==32 and all(c in '0123456789abcdef' for c in flow['sb_flow_id'][0])"""
assert s.count(needle)==1,'Inspect changed upstream fixture before adapting'
exec(compile(s.replace(needle,replacement),str(p),'exec'),{'__file__':str(p),'__name__':'__main__'})
