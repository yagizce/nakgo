"""Exercise trusted replay selection and application without a network or GitHub."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('prepare_replay', HERE/'prepare-replay.py')
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


class TrustedReplayTest(unittest.TestCase):
    def test_candidate_cannot_supply_tests_or_patch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base, candidate = root/'base', root/'candidate'
            base.mkdir()
            legacy = "assert open('app.txt').read().strip() == 'legacy'\n"
            product = legacy.replace("'legacy'", "'product'")
            overlay = ('diff --git a/tests/check.py b/tests/check.py\n'
                       '--- a/tests/check.py\n+++ b/tests/check.py\n'
                       '@@ -1 +1 @@\n-' + legacy + '+' + product)
            project = (HERE.parents[1]/'tools/project.js').read_bytes().replace(b'\r\n', b'\n')
            if replay.dispatch.INBOX not in project:
                project = project.replace(replay.dispatch.ROAD_MAP, replay.dispatch.INBOX + replay.dispatch.ROAD_MAP)

            def write(repo, name, contents):
                file = repo/name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(contents if isinstance(contents, bytes) else contents.encode())

            def git(repo, *args):
                return subprocess.check_output(['git', '-C', str(repo), '-c', 'core.autocrlf=false', *args],
                                               stderr=subprocess.PIPE).decode().strip()

            def commit(repo):
                git(repo, 'add', '--all')
                git(repo, '-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@invalid',
                    '-c', 'commit.gpgsign=false', 'commit', '-m', 'Replay fixture')
                return git(repo, 'rev-parse', 'HEAD')

            git(base, 'init')
            for name, content in {'tools/project.js': project, 'tests/check.py': legacy,
                                  'tests/gate/legacy-browser.py': '# legacy\n',
                                  'tests/gate/product-browser.py': '# product\n',
                                  'tests/gate/product-replay.patch': overlay,
                                  'supabase/tests/check.sql': 'select false;\n',
                                  '.github/control': 'trusted\n'}.items():
                write(base, name, content)
            base_sha = commit(base)
            git(root, 'clone', '-c', 'core.autocrlf=false', str(base), str(candidate))
            replay.prepare(candidate, base_sha, base_sha, root/'legacy.patch', base)
            self.assertEqual((root/'legacy.patch').read_bytes(), b'')

            write(candidate, 'tools/project.js', project.replace(replay.dispatch.INBOX, b''))
            write(candidate, 'tests/check.py', 'raise SystemExit(0)\n')
            write(candidate, 'tests/added.py', 'raise SystemExit(0)\n')
            write(candidate, 'tests/gate/product-replay.patch', 'candidate payload\n')
            write(candidate, 'app.txt', 'regression\n')
            head_sha = commit(candidate)
            patch = root/'product.patch'

            write(base, 'tests/gate/product-replay.patch', 'tampered patch\n')
            with self.assertRaisesRegex(ValueError, 'untrusted_browser_fixture'):
                replay.prepare(candidate, base_sha, head_sha, patch, base)
            self.assertFalse(patch.exists())
            write(base, 'tests/gate/product-replay.patch', overlay)

            write(candidate, 'tools/project.js', project)
            with self.assertRaisesRegex(ValueError, 'untrusted_browser_fixture'):
                replay.prepare(candidate, base_sha, head_sha, patch, base)
            git(candidate, 'restore', '--worktree', '--', 'tools/project.js')
            with self.assertRaisesRegex(ValueError, 'unexpected_base_sha'):
                replay.prepare(candidate, base_sha, base_sha, patch, base)

            replay.prepare(candidate, base_sha, head_sha, patch, base)
            self.assertEqual(patch.read_bytes(), overlay.encode())
            git(candidate, 'restore', '--source='+base_sha, '--worktree', '--', 'tests', 'supabase/tests', 'tools', '.github')
            git(candidate, 'apply', '--check', str(patch))
            git(candidate, 'apply', str(patch))
            self.assertFalse((candidate/'tests/added.py').exists())
            self.assertEqual((candidate/'supabase/tests/check.sql').read_text(), 'select false;\n')
            self.assertEqual((candidate/'tests/check.py').read_text(), product)
            def run():
                return subprocess.run([sys.executable, 'tests/check.py'], cwd=candidate, capture_output=True)
            self.assertIn(b'AssertionError', run().stderr)
            write(candidate, 'app.txt', 'product\n')
            self.assertEqual(run().returncode, 0)

            # Once the product tests are in main, never reapply the legacy patch.
            write(base, 'tools/project.js', project.replace(replay.dispatch.INBOX, b''))
            write(base, 'tests/check.py', product)
            product_base = commit(base)
            git(candidate, 'restore', '--worktree', '--', 'tools/project.js')
            replay.prepare(candidate, product_base, head_sha, root/'native-product.patch', base)
            self.assertEqual((root/'native-product.patch').read_bytes(), b'')
            git(candidate, 'restore', '--source='+base_sha, '--worktree', '--', 'tools/project.js')
            legacy_head = commit(candidate)
            with self.assertRaisesRegex(ValueError, 'unsupported_replay_contract_transition'):
                replay.prepare(candidate, product_base, legacy_head, root/'downgrade.patch', base)


if __name__ == '__main__':
    unittest.main()
