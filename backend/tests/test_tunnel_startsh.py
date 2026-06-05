import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
START_SH = REPO_ROOT / "tunnel" / "start.sh"


@unittest.skipIf(not START_SH.exists(), "tunnel/start.sh not present")
class TunnelStartShTests(unittest.TestCase):
    def setUp(self):
        if shutil.which("sh") is None:
            self.skipTest("sh not available")

    def _base_env(self, tmp_path: Path) -> dict[str, str]:
        env = os.environ.copy()
        env.update(
            {
                "TUNNEL_URL_FILE": (tmp_path / "tunnel_url.txt").as_posix(),
                "TUNNEL_STATUS_FILE": (tmp_path / "tunnel_status.json").as_posix(),
                "TUNNEL_LOG_FILE": (tmp_path / "tunnel.log").as_posix(),
                "QUICK_TUNNEL_TIMEOUT_SECONDS": "1",
            }
        )
        return env

    def test_fails_fast_when_token_set_and_hostname_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            env = self._base_env(tmp_path)
            env.update({"CLOUDFLARE_TUNNEL_TOKEN": "fake-token", "TUNNEL_HOSTNAME": ""})

            result = subprocess.run(
                ["sh", str(START_SH)],
                capture_output=True,
                text=True,
                env=env,
                timeout=10,
            )

            self.assertEqual(result.returncode, 1, msg=f"stdout={result.stdout!r} stderr={result.stderr!r}")
            status = (tmp_path / "tunnel_status.json").read_text(encoding="utf-8")
            self.assertIn('"status":"error"', status)
            self.assertIn("CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty", status)

    def test_warns_when_hostname_set_without_token_before_quick_tunnel(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            env = self._base_env(tmp_path)
            env.update(
                {
                    "CLOUDFLARE_TUNNEL_TOKEN": "",
                    "TUNNEL_HOSTNAME": "hooks.example.com",
                    "PATH": tmp_path.as_posix() + ":" + env.get("PATH", ""),
                }
            )
            cloudflared_path = tmp_path / "cloudflared"
            cloudflared_path.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            cloudflared_path.chmod(0o755)

            result = subprocess.run(
                ["sh", str(START_SH)],
                capture_output=True,
                text=True,
                env=env,
                timeout=10,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("TUNNEL_HOSTNAME is set without CLOUDFLARE_TUNNEL_TOKEN", result.stderr)
            self.assertTrue((tmp_path / "tunnel_status.json").exists())


if __name__ == "__main__":
    unittest.main()
