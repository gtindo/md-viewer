// electron-builder afterPack hook for Linux:
//  1. Hardens the Electron binary with fuses: no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS,
//     no --inspect flags, and the app may only load from its asar archive.
//  2. Puts a small launcher in front of the binary. Inside an AppImage the chrome-sandbox
//     helper cannot be setuid root, so Chromium relies on unprivileged user namespaces.
//     Where the kernel forbids them (Ubuntu 23.10+ AppArmor policy, some hardened kernels)
//     or when running as root, the launcher passes --no-sandbox instead of letting the
//     app abort on start. Everywhere else the sandbox stays on.
const fs = require("node:fs/promises");
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

const LAUNCHER = `#!/bin/sh
# MDView launcher: keeps Chromium's sandbox on where the kernel allows it.
HERE="$(dirname "$(readlink -f "$0")")"
NO_SANDBOX=""
if [ "$(id -u)" = "0" ]; then
  NO_SANDBOX=1
elif [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ]; then
  NO_SANDBOX=1
elif [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ]; then
  NO_SANDBOX=1
elif [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = "0" ]; then
  NO_SANDBOX=1
fi
if [ -n "$NO_SANDBOX" ]; then
  exec "$HERE/mdview-bin" --no-sandbox "$@"
fi
exec "$HERE/mdview-bin" "$@"
`;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;
  const exe = path.join(context.appOutDir, context.packager.executableName);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  const bin = path.join(context.appOutDir, "mdview-bin");
  await fs.rename(exe, bin);
  await fs.writeFile(exe, LAUNCHER, { mode: 0o755 });
};
