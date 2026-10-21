#!/usr/bin/env python3
"""Export a three-file, credential-bearing Docker deployment (stdlib only)."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
IMAGE = 'oantuti-worker-python:bundled'
URLS = {
    'BACKEND_URL': 'https://oantuti-backend.vercel.app',
    'FRONTEND_URL': 'https://oantuti-three.vercel.app',
}


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    output = HERE / 'portable'
    if output.exists():
        raise SystemExit(f'{output} đã tồn tại. Đổi tên/di chuyển gói cũ trước khi export lại.')
    config = (HERE / '.env').read_text()
    for key, value in URLS.items():
        config, count = re.subn(rf'(?m)^\s*(?:export\s+)?{key}\s*=.*$',
                                f'{key}={value}', config)
        if not count:
            config += f'\n{key}={value}\n'
    # Machine identity belongs to the receiving installation, never the sender.
    config = re.sub(r'(?m)^\s*(?:export\s+)?(?:MACHINE_ID|WORKER_MACHINE_ID_FILE)\s*=.*\n?', '', config)
    print('Giữ cấu hình/secrets từ .env; dùng backend/frontend Vercel. Image chứa secrets.', flush=True)
    with tempfile.TemporaryDirectory(prefix='oantuti-export-') as temporary:
        secret = Path(temporary) / '.env'
        secret.touch(mode=0o600)
        secret.write_text(config)
        run('docker', 'build', '--target', 'bundled', '--build-arg',
            'WORKER_ENV_SHA256=' + hashlib.sha256(config.encode()).hexdigest(),
            '--secret', f'id=worker_env,src={secret}', '-f', str(HERE / 'Dockerfile'),
            '-t', IMAGE, str(ROOT))
    run('docker', 'compose', '-f', str(HERE / 'compose.bundled.yaml'),
        'run', '--rm', '--no-deps', '--pull', 'never', 'worker-python', '--check')
    platform = subprocess.check_output(
        ['docker', 'image', 'inspect', IMAGE, '--format', '{{.Os}}/{{.Architecture}}'], text=True).strip()
    # Stage beside the destination: a failed save never leaves a usable-looking bundle.
    with tempfile.TemporaryDirectory(prefix='.portable-', dir=HERE) as temporary:
        stage = Path(temporary)
        archive = stage / 'worker-image.tar.gz'
        # docker save is streamed, without keeping an uncompressed duplicate on disk.
        with archive.open('wb') as handle:
            os.chmod(archive, 0o600)
            save = subprocess.Popen(['docker', 'save', IMAGE], stdout=subprocess.PIPE)
            try:
                compressed = subprocess.run(['gzip', '-9', '-n'], stdin=save.stdout, stdout=handle)
            finally:
                save.stdout.close()
            saved = save.wait()
            if saved or compressed.returncode:
                raise SystemExit('Không xuất/nén được image; chưa tạo folder portable.')
        hasher = hashlib.sha256()
        with archive.open('rb') as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                hasher.update(chunk)
        digest = hasher.hexdigest()
        shutil.copyfile(HERE / 'compose.bundled.yaml', stage / 'compose.yaml')
        guide = (HERE / 'PORTABLE.md').read_text()
        guide += f'\n## Thông tin gói này\n\n- Platform: `{platform}`\n- Image: `{IMAGE}`\n- SHA256 `worker-image.tar.gz`: `{digest}`\n'
        (stage / 'README.md').write_text(guide)
        output.mkdir(mode=0o700)
        for file in stage.iterdir():
            file.rename(output / file.name)
    print(f'Đã xuất: {output}\nPlatform: {platform}\nDung lượng: {archive.name} ~{(output / archive.name).stat().st_size / 1024**2:.1f} MiB')


if __name__ == '__main__':
    main()
