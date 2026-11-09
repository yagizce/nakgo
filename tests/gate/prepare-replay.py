"""Select main's committed fixture before CI restores the trusted tests."""
import argparse
import importlib.util
from pathlib import Path

DISPATCHER = Path(__file__).with_name('browser-dispatch.py')
spec = importlib.util.spec_from_file_location('trusted_browser_dispatch', DISPATCHER)
dispatch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)


def prepare(root, base_sha, head_sha, output, trusted_root=dispatch.TRUSTED_ROOT):
    root = Path(root).resolve()
    trusted_root = Path(trusted_root).resolve()
    dispatch.checked_base(root, head_sha)
    dispatch.read_trusted(root, 'tools/project.js', 65536, head_sha)
    fixture, _ = dispatch.select_fixture(root, trusted_root, base_sha=base_sha)
    base_project = dispatch.read_trusted(trusted_root, 'tools/project.js', 65536, base_sha)
    base_is_legacy = dispatch.INBOX in base_project
    product = fixture.name == 'product-browser.py'
    if not base_is_legacy and not product:
        raise ValueError('unsupported_replay_contract_transition')
    overlay = b''
    if base_is_legacy and product:
        overlay = dispatch.read_trusted(trusted_root, 'tests/gate/product-replay.patch', 262144, base_sha)
        if not overlay:
            raise ValueError('missing_product_replay')
    with Path(output).open('xb') as patch:
        patch.write(overlay)
    print(f'Trusted regression contract: {fixture.stem}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--base-sha', required=True)
    parser.add_argument('--head-sha', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    prepare(args.root, args.base_sha, args.head_sha, args.output)
