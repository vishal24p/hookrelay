import os
import shutil
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class ComposeFailFastTests(unittest.TestCase):
    def test_docker_compose_refuses_missing_database_env(self):
        if shutil.which("docker") is None:
            self.skipTest("docker not available")

        env = os.environ.copy()
        for var in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DATABASE_URL"):
            env.pop(var, None)
        env["COMPOSE_DISABLE_ENV_FILE"] = "1"

        result = subprocess.run(
            ["docker", "compose", "-f", str(REPO_ROOT / "docker-compose.yml"), "config"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, msg=f"compose config should fail: {output!r}")
        self.assertIn("must be set", output)


if __name__ == "__main__":
    unittest.main()
