"""Negative trust-boundary tests, no browser/network or candidate execution."""
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('dispatch', ROOT/'tests/gate/browser-dispatch.py')
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)

class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'tools').mkdir()
    def project(self):
        # Works in shallow CI checkouts and in either reviewed application tree.
        data = (ROOT/'tools/project.js').read_bytes().replace(b'\r\n',b'\n')
        if b'  "src/js/screens/inbox.js",\n' not in data:
            data=data.replace(b'  "src/js/screens/road-map.js",\n',b'  "src/js/screens/inbox.js",\n  "src/js/screens/road-map.js",\n')
        (self.root/'tools/project.js').write_bytes(data)
    def test_legacy_uses_trusted_fixture(self):
        self.project()
        self.assertEqual(dispatch.select_fixture(self.root)[0].name, 'legacy-browser.py')
    def test_product_uses_trusted_fixture(self):
        self.project()
        project=self.root/'tools/project.js'
        project.write_bytes(project.read_bytes().replace(b'\r\n',b'\n').replace(b'  "src/js/screens/inbox.js",\n',b''))
        (self.root/'tests/gate').mkdir(parents=True)
        (self.root/'tests/gate/browser.py').write_text("raise Exception('must never execute candidate tests')")
        self.assertEqual(dispatch.select_fixture(self.root)[0].parent, ROOT/'tests/gate')
        self.assertEqual(dispatch.select_fixture(self.root)[0].name, 'product-browser.py')
    def test_candidate_ledger_cannot_approve_unknown_contract(self):
        (self.root/'tools/project.js').write_text('unreviewed')
        (self.root/'.github').mkdir()
        (self.root/'.github/reviewed-controls.json').write_text('{"version":1,"reviews":[]}')
        with self.assertRaisesRegex(ValueError,'unknown_product_contract'):
            dispatch.select_fixture(self.root)
    def test_empty_contract_rejected(self):
        (self.root/'tools/project.js').write_text('')
        with self.assertRaises(ValueError):dispatch.select_fixture(self.root)
    def test_missing_contract_rejected(self):
        with self.assertRaises(ValueError):dispatch.select_fixture(self.root)
    def test_trusted_fixture_tampering_rejected(self):
        self.project()
        trusted=self.root/'trusted'
        for name in ['tools/project.js','tests/gate/legacy-browser.py']:
            dest=trusted/name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((ROOT/name).read_bytes())
        def git(*args):
            subprocess.run(['git','-C',str(trusted),*args],check=True,capture_output=True)
        git('init','--initial-branch=main')
        git('add','--all')
        git('-c','user.name=Synthetic fixture','-c','user.email=fixture@invalid',
            '-c','commit.gpgsign=false','commit','-m','Trusted browser fixture')
        (trusted/'tests/gate/legacy-browser.py').write_text('print("silently skip security checks")')
        with self.assertRaisesRegex(ValueError,'untrusted_browser_fixture'):
            dispatch.select_fixture(self.root,trusted)

    def test_foreign_git_environment_cannot_replace_trusted_blob(self):
        self.project()
        relative = 'tests/gate/legacy-browser.py'
        trusted, foreign = self.root/'trusted', self.root/'foreign'
        marker = b'print("synthetic success")\n'
        for repo, content in [(trusted, (ROOT/relative).read_bytes()), (foreign, marker)]:
            fixture = repo/relative
            fixture.parent.mkdir(parents=True)
            fixture.write_bytes(content)
            def git(*args):
                return subprocess.check_output(['git','-C',str(repo),*args], stderr=subprocess.DEVNULL)
            git('init')
            git('add','--all')
            git('-c','user.name=Synthetic fixture','-c','user.email=fixture@invalid',
                '-c','commit.gpgsign=false','commit','-m','Synthetic checkout')
        trusted_sha = subprocess.check_output(['git','-C',str(trusted),'rev-parse','HEAD']).decode().strip()
        foreign_sha = subprocess.check_output(['git','-C',str(foreign),'rev-parse','HEAD']).decode().strip()
        (trusted/relative).write_bytes(marker)
        with patch.dict('os.environ', {'GIT_DIR': str(foreign/'.git'), 'GIT_WORK_TREE': str(foreign),
                                       'GIT_COMMON_DIR': str(foreign/'.git'),
                                       'GIT_OBJECT_DIRECTORY': str(foreign/'.git/objects')}):
            with self.assertRaisesRegex(ValueError, 'unexpected_base_sha'):
                dispatch.checked_base(trusted, foreign_sha)
            base_sha = dispatch.checked_base(trusted, trusted_sha)
            with self.assertRaisesRegex(ValueError, 'untrusted_browser_fixture'):
                dispatch.read_trusted(trusted, relative, 131072, base_sha)

if __name__ == '__main__':unittest.main()
