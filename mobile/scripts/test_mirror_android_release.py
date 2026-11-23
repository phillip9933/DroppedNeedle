"""Offline release-mirror checks. Run with python3 mobile/scripts/test_mirror_android_release.py."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("mirror", Path(__file__).with_name("mirror-android-release.py"))
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


class MirrorTests(unittest.TestCase):
    tag = "android-v0.9.1"
    name = "droppedneedle-android-0.9.1.apk"

    def setUp(self):
        self.source = {
            "id": 10, "tag_name": self.tag, "prerelease": True, "draft": False, "published_at": "now",
            "name": "OtoHari 0.9.1 beta", "body": "Update notes",
            "assets": [{"id": i, "name": name, "size": 100, "state": "uploaded", "digest": "sha256:" + "1" * 64}
                       for i, name in enumerate([self.name, self.name + ".sha256"], 20)],
        }
        self.dest = None
        self.posts = []
        self.uploads = []
        self.fail_upload = None

    def api(self, endpoint, method="GET", body=None):
        if endpoint.startswith("repos/" + mirror.LEGACY + "/releases/tags/"):
            return deepcopy(self.source)
        if method == "POST":
            self.posts.append(deepcopy(body))
            self.dest = dict(body, assets=[], id=47)
        elif method == "PATCH":
            self.assertEqual(self.dest["draft"], True)
            self.assertEqual(body["make_latest"], "false")
            self.dest.update(body)
        return deepcopy(self.dest)

    def upload(self, args, check):
        name = args[-1].split("?name=")[-1]
        if name == self.fail_upload:
            raise OSError("interrupted")
        self.dest["assets"] += [deepcopy(next(a for a in self.source["assets"] if a["name"] == name))]
        self.uploads.append(name)

    def run_mirror(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(mirror, "api", self.api), \
                patch.object(mirror, "check_tags", return_value=("a" * 40, "b" * 40)), \
                patch.object(mirror, "find_destination", side_effect=lambda _: deepcopy(self.dest)), \
                patch.object(mirror, "download", return_value="1" * 64), \
                patch.object(mirror, "verify_apk"), patch.object(mirror.subprocess, "run", self.upload):
            mirror.mirror(self.tag, Path(tmp), Path(tmp))

    def test_cutover_range(self):
        for version in ["0.9.0", "0.9.1", "0.9.1-beta.2", "1.0.0-rc.1", "1.0.0"]:
            self.assertEqual(mirror.version_for("android-v" + version), version)
        for tag in ["android-v0.8.9", "android-v0.9.0-beta.1", "android-v1.0.1", "android-v1.1.0",
                    "android-v1.0.0+local", "android-v0.9.x", "ios-v0.9.1", "android-v1.0.0/extra"]:
            with self.assertRaises(ValueError):
                mirror.version_for(tag)

    def test_retry_after_partial_upload_and_published_replay(self):
        self.fail_upload = self.name + ".sha256"
        with self.assertRaises(OSError):
            self.run_mirror()
        self.assertTrue(self.dest["draft"])
        self.assertEqual(self.uploads, [self.name])
        self.fail_upload = None
        self.run_mirror()
        self.run_mirror()
        self.assertFalse(self.dest["draft"])
        self.assertTrue(self.dest["prerelease"])
        self.assertEqual(self.uploads, [self.name, self.name + ".sha256"])
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0]["make_latest"], "false")

    def test_existing_release_cannot_be_repaired_or_overwritten(self):
        self.run_mirror()
        self.dest["assets"][0]["digest"] = "sha256:" + "b" * 64
        with self.assertRaises(ValueError):
            self.run_mirror()
        self.dest["assets"].pop(0)
        with self.assertRaises(ValueError):
            self.run_mirror()
        self.assertEqual(self.uploads, [self.name, self.name + ".sha256"])

    def test_fail_closed_on_wrong_source_binding(self):
        wanted = "a" * 40
        for note in [None, "unrelated", "Legacy-Source: " + "b" * 40,
                     f"Legacy-Source: {wanted}\nLegacy-Source: {wanted}"]:
            with patch.object(mirror, "tag_object", side_effect=[(wanted, None), ("c" * 40, note)]):
                with self.assertRaises(ValueError):
                    mirror.check_tags(self.tag)
        with patch.object(mirror, "tag_object", side_effect=[(wanted, None), ("c" * 40, "Legacy-Source: " + wanted)]):
            self.assertEqual(mirror.check_tags(self.tag), (wanted, "c" * 40))

    def test_wrong_sidecar_or_signer(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp) / self.name
            apk.touch()
            sha = "1" * 64
            for sidecar in [sha + "  other.apk", "0" * 64 + "  " + apk.name, sha + "  " + apk.name + "\nextra"]:
                apk.with_suffix(".apk.sha256").write_text(sidecar)
                with self.assertRaisesRegex(ValueError, "checksum"):
                    mirror.verify_apk(apk, "0.9.1", sha, Path(tmp))
            apk.with_suffix(".apk.sha256").write_text(sha + "  " + apk.name)
            with patch.object(mirror.subprocess, "check_output",
                              return_value="Signer #1 certificate SHA-256 digest: " + "b" * 64):
                with self.assertRaisesRegex(ValueError, "signer"):
                    mirror.verify_apk(apk, "0.9.1", sha, Path(tmp))


if __name__ == "__main__":
    unittest.main()
