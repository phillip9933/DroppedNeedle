"""Mirror an existing signed Android release during OtoHari's repository move."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

LEGACY = "phillip9933/DroppedNeedle"
DESTINATION = "phillip9933/OtoHari"
SIGNER = "d3af5297ea72c7b0a4494b7bbffad0af33e265ea281b120572190721e9331883"
FIRST_APK = "8096285ffacc804dbaeb3bf2b74a29d912179e4c2cae4279c774daf1a508b5c4"
MAX_APK_BYTES = 512 * 1024 * 1024
BUILD_TOOLS_VERSION = "36.0.0"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def api(endpoint, method="GET", body=None):
    command = ["gh", "api", "--method", method, endpoint]
    if body is not None:
        command += ["-H", "Content-Type: application/json", "--input", "-"]
    raw = subprocess.check_output(command, input=json.dumps(body).encode() if body is not None else None)
    return json.loads(raw)


def version_for(tag):
    match = re.fullmatch(r"android-v(0\.9\.(?:0|[1-9][0-9]*)|1\.0\.0)(?:-(?:alpha|beta|rc)\.[1-9][0-9]*)?", tag)
    require(match and len(tag) <= 64 and not tag.startswith("android-v0.9.0-"),
            "Choose an Android tag from 0.9.0 through 1.0.0.")
    return tag.removeprefix("android-v")


def tag_object(repo, tag):
    ref = api(f"repos/{repo}/git/ref/tags/{tag}")
    require(ref["ref"] == f"refs/tags/{tag}", "Unexpected Git tag.")
    obj = ref["object"]
    if obj["type"] == "commit":
        return obj["sha"], None
    require(obj["type"] == "tag", "Expected a release tag pointing to a commit.")
    entry = api(f"repos/{repo}/git/tags/{obj['sha']}")
    require(entry["tag"] == tag and entry["object"]["type"] == "commit", "Invalid annotated release tag.")
    return entry["object"]["sha"], entry["message"]


def check_tags(tag):
    source, _ = tag_object(LEGACY, tag)
    target, message = tag_object(DESTINATION, tag)
    trailers = re.findall(r"^Legacy-Source: ([0-9a-f]{40})$", message or "", re.MULTILINE)
    require(trailers == [source], "The destination tag must record the legacy tag commit in Legacy-Source.")
    return source, target


def find_destination(tag):
    # A matching draft can be invisible to the public GET-by-tag endpoint.
    for page in range(1, 101):
        batch = api(f"repos/{DESTINATION}/releases?per_page=100&page={page}")
        found = [r for r in batch if r["tag_name"] == tag]
        require(len(found) <= 1, "Multiple releases have this tag. Inspect them on GitHub.")
        if found:
            return found[0]
        if len(batch) < 100:
            return None
    raise ValueError("Could not inspect the full destination release list.")


def assets_by_name(release):
    assets = {a["name"]: a for a in release["assets"]}
    require(len(assets) == len(release["assets"]), "Duplicate asset names on the release.")
    return assets


def source_assets(release, tag, apk_name):
    require(release["tag_name"] == tag and not release["draft"] and release["published_at"],
            "Publish the legacy release before mirroring it.")
    if "-" in version_for(tag):
        require(release["prerelease"], "An alpha, beta or release candidate tag must be a prerelease.")
    assets = assets_by_name(release)
    selected = {}
    for name, limit in ((apk_name, MAX_APK_BYTES), (apk_name + ".sha256", 512)):
        asset = assets.get(name)
        require(asset and asset["state"] == "uploaded" and 0 < asset["size"] <= limit
                and re.fullmatch(r"sha256:[0-9a-f]{64}", asset.get("digest") or ""),
                f"Missing or invalid published asset: {name}")
        selected[name] = asset
    return selected


def download(asset, path):
    with path.open("xb") as output:
        subprocess.run(["gh", "api", "-H", "Accept: application/octet-stream",
                        f"repos/{LEGACY}/releases/assets/{int(asset['id'])}"], stdout=output, check=True)
    require(path.stat().st_size == asset["size"], f"Wrong size for {path.name}.")
    with path.open("rb") as data:
        digest = hashlib.file_digest(data, "sha256").hexdigest()
    require(asset["digest"] == f"sha256:{digest}", f"Wrong GitHub asset digest for {path.name}.")
    return digest


def verify_apk(apk, version, digest, tools):
    checksum = apk.with_suffix(".apk.sha256").read_text(encoding="ascii").splitlines()
    require(len(checksum) == 1 and checksum[0] in (f"{digest}  {apk.name}", f"{digest} *{apk.name}"),
            "The published checksum must identify this exact APK and digest.")
    if version == "0.9.0":
        require(digest == FIRST_APK, "The historical 0.9.0 APK does not match the pinned public release.")
    certs = subprocess.check_output([tools / "apksigner", "verify", "--print-certs", apk], text=True)
    signers = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$", certs, re.MULTILINE)
    require(signers == [SIGNER],
            f"Unexpected APK signer in SDK {BUILD_TOOLS_VERSION}: {', '.join(signers) or 'no signer digest reported'}.")
    info = subprocess.check_output([tools / "aapt", "dump", "badging", apk], text=True)
    pkg = next((line for line in info.splitlines() if line.startswith("package:")), "")
    require(" name='app.droppedneedle.mobile'" in pkg and f" versionName='{version}'" in pkg
            and re.search(r" versionCode='[1-9][0-9]*'", pkg) and " split=" not in pkg
            and not re.search(r"^(application-debuggable|uses-split:)", info, re.MULTILINE),
            "APK package, version or release build configuration does not match the tag.")


def missing_assets(release, expected, prerelease):
    require(release["prerelease"] == prerelease, "The destination release channel differs.")
    current = assets_by_name(release)
    require(current.keys() <= expected.keys(), "Unexpected assets on the destination release.")
    for name, a in current.items():
        require(a["state"] == "uploaded" and (a["digest"], a["size"]) == (expected[name]["digest"], expected[name]["size"]),
                f"Existing destination asset differs: {name}. Inspect the release on GitHub.")
    missing = expected.keys() - current.keys()
    require(not missing or release["draft"], "Published destination release is incomplete. Inspect it on GitHub.")
    return sorted(missing)


def mirror(tag, folder, tools):
    version = version_for(tag)
    apk = folder / f"droppedneedle-android-{version}.apk"
    tagged = check_tags(tag)
    source = api(f"repos/{LEGACY}/releases/tags/{tag}")
    selected = source_assets(source, tag, apk.name)
    apk_digest = download(selected[apk.name], apk)
    download(selected[apk.name + ".sha256"], apk.with_suffix(".apk.sha256"))
    verify_apk(apk, version, apk_digest, tools)
    dest = find_destination(tag)
    if dest is None:
        # The verified tag already exists. target_commitish is for creating a new tag.
        dest = api(f"repos/{DESTINATION}/releases", "POST", {
            "tag_name": tag, "name": source["name"] or tag, "body": source["body"] or "",
            "draft": True, "prerelease": source["prerelease"], "make_latest": "false",
        })
    endpoint = f"repos/{DESTINATION}/releases/{int(dest['id'])}"
    if dest["draft"]:
        require((dest["name"], dest["body"] or "") == (source["name"] or tag, source["body"] or ""),
                "The existing draft has different release notes. Inspect it on GitHub.")
    for name in missing_assets(dest, selected, source["prerelease"]):
        subprocess.run(["gh", "api", "--method", "POST", "--silent", "-H", "Content-Type: application/octet-stream",
                        "--input", folder / name, f"https://uploads.github.com/repos/{DESTINATION}/releases/{int(dest['id'])}/assets?name={name}"], check=True)
    if dest["draft"]:
        draft = api(endpoint)
        require(draft["draft"] and draft["tag_name"] == tag, "The destination release was modified during upload.")
        require(not missing_assets(draft, selected, source["prerelease"]), "The mirror draft is incomplete.")
        require(check_tags(tag) == tagged, "A release tag moved during verification.")
        current = api(f"repos/{LEGACY}/releases/tags/{tag}")
        latest = source_assets(current, tag, apk.name)
        require((current["id"], current["prerelease"]) == (source["id"], source["prerelease"])
                and all(latest[n]["digest"] == a["digest"] and latest[n]["id"] == a["id"] for n, a in selected.items()),
                "The legacy release changed during the mirror.")
        api(endpoint, "PATCH", {"draft": False, "prerelease": source["prerelease"], "make_latest": "false"})
        published = api(endpoint)
        require(not published["draft"] and published["tag_name"] == tag
                and not missing_assets(published, selected, source["prerelease"]), "The published release could not be verified.")
    print(f"Verified release at https://github.com/{DESTINATION}/releases/tag/{tag}")


def build_tools():
    sdk = os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"]
    tools = Path(sdk) / "build-tools" / BUILD_TOOLS_VERSION
    require(all((tools / binary).is_file() for binary in ("apksigner", "aapt")),
            f"Install Android SDK Build Tools {BUILD_TOOLS_VERSION} to verify release assets.")
    return tools


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2, "Usage: mirror-android-release.py android-v<VERSION>")
        with tempfile.TemporaryDirectory() as temp:
            mirror(sys.argv[1], Path(temp), build_tools())
    except (KeyError, ValueError, OSError, subprocess.SubprocessError) as exc:
        sys.exit(str(exc))
