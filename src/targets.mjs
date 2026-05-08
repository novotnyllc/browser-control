export const EXTENSION_ID = "hehggadaopoacecdllhhajmbjkdcmajg";
export const NATIVE_HOST_NAME = "com.openai.codexextension";

const commonExtensionDiscovery = {
  profileSelection:
    "Read Local State profile.last_used, then profile.profiles_order, then profiles with Preferences. Check Extensions/<extension-id> and Local Extension Settings/<extension-id> under the selected profile.",
  extensionId: EXTENSION_ID,
};

export const TARGETS = {
  "chrome-stable": {
    id: "chrome-stable",
    family: "chrome",
    channel: "stable",
    displayName: "Google Chrome",
    mention: "@chrome-stable",
    macos: {
      bundleId: "com.google.Chrome",
      appName: "Google Chrome.app",
      profileRoot: ["Library", "Application Support", "Google", "Chrome"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts"
      ],
      processNames: ["Google Chrome", "Google Chrome Helper"]
    },
    windows: {
      executable: "chrome.exe",
      appPathSegments: ["Google", "Chrome", "Application", "chrome.exe"],
      profileRootSegments: ["Google", "Chrome", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
      processNames: ["chrome.exe"]
    },
    linux: {
      commands: ["google-chrome", "chrome"],
      profileRoot: [".config", "google-chrome"],
      nativeMessagingHostDir: [".config", "google-chrome", "NativeMessagingHosts"],
      processNames: ["chrome", "google-chrome"]
    },
    extensionDiscovery: commonExtensionDiscovery
  },
  "chrome-beta": {
    id: "chrome-beta",
    family: "chrome",
    channel: "beta",
    displayName: "Google Chrome Beta",
    mention: "@chrome-beta",
    macos: {
      bundleId: "com.google.Chrome.beta",
      appName: "Google Chrome Beta.app",
      profileRoot: ["Library", "Application Support", "Google", "Chrome Beta"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Google",
        "Chrome Beta",
        "NativeMessagingHosts"
      ],
      processNames: ["Google Chrome Beta", "Google Chrome Helper"]
    },
    windows: {
      executable: "chrome.exe",
      appPathSegments: ["Google", "Chrome Beta", "Application", "chrome.exe"],
      profileRootSegments: ["Google", "Chrome Beta", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
      processNames: ["chrome.exe"]
    },
    linux: {
      commands: ["google-chrome-beta"],
      profileRoot: [".config", "google-chrome-beta"],
      nativeMessagingHostDir: [
        ".config",
        "google-chrome-beta",
        "NativeMessagingHosts"
      ],
      processNames: ["google-chrome-beta"]
    },
    extensionDiscovery: commonExtensionDiscovery
  },
  "chrome-dev": {
    id: "chrome-dev",
    family: "chrome",
    channel: "dev",
    displayName: "Google Chrome Dev",
    mention: "@chrome-dev",
    macos: {
      bundleId: "com.google.Chrome.dev",
      appName: "Google Chrome Dev.app",
      profileRoot: ["Library", "Application Support", "Google", "Chrome Dev"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Google",
        "Chrome Dev",
        "NativeMessagingHosts"
      ],
      processNames: ["Google Chrome Dev", "Google Chrome Helper"]
    },
    windows: {
      executable: "chrome.exe",
      appPathSegments: ["Google", "Chrome Dev", "Application", "chrome.exe"],
      profileRootSegments: ["Google", "Chrome Dev", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
      processNames: ["chrome.exe"]
    },
    linux: {
      commands: ["google-chrome-unstable"],
      profileRoot: [".config", "google-chrome-unstable"],
      nativeMessagingHostDir: [
        ".config",
        "google-chrome-unstable",
        "NativeMessagingHosts"
      ],
      processNames: ["google-chrome-unstable"]
    },
    extensionDiscovery: commonExtensionDiscovery
  },
  "chrome-canary": {
    id: "chrome-canary",
    family: "chrome",
    channel: "canary",
    displayName: "Google Chrome Canary",
    mention: "@chrome-canary",
    macos: {
      bundleId: "com.google.Chrome.canary",
      appName: "Google Chrome Canary.app",
      profileRoot: ["Library", "Application Support", "Google", "Chrome Canary"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Google",
        "Chrome Canary",
        "NativeMessagingHosts"
      ],
      processNames: ["Google Chrome Canary", "Google Chrome Helper"]
    },
    windows: {
      executable: "chrome.exe",
      appPathSegments: ["Google", "Chrome SxS", "Application", "chrome.exe"],
      profileRootSegments: ["Google", "Chrome SxS", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
      processNames: ["chrome.exe"]
    },
    linux: {
      commands: ["google-chrome-canary", "google-chrome-unstable"],
      profileRoot: [".config", "google-chrome-canary"],
      nativeMessagingHostDir: [
        ".config",
        "google-chrome-canary",
        "NativeMessagingHosts"
      ],
      processNames: ["google-chrome-canary", "google-chrome-unstable"]
    },
    extensionDiscovery: commonExtensionDiscovery
  },
  "edge-stable": {
    id: "edge-stable",
    family: "edge",
    channel: "stable",
    displayName: "Microsoft Edge",
    mention: "@edge-stable",
    macos: {
      bundleId: "com.microsoft.edgemac",
      appName: "Microsoft Edge.app",
      profileRoot: ["Library", "Application Support", "Microsoft Edge"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Microsoft Edge",
        "NativeMessagingHosts"
      ],
      processNames: ["Microsoft Edge", "Microsoft Edge Helper"]
    },
    windows: {
      executable: "msedge.exe",
      appPathSegments: ["Microsoft", "Edge", "Application", "msedge.exe"],
      profileRootSegments: ["Microsoft", "Edge", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
      processNames: ["msedge.exe"]
    },
    linux: {
      commands: ["microsoft-edge", "msedge"],
      profileRoot: [".config", "microsoft-edge"],
      nativeMessagingHostDir: [
        ".config",
        "microsoft-edge",
        "NativeMessagingHosts"
      ],
      processNames: ["microsoft-edge", "msedge"]
    },
    extensionDiscovery: commonExtensionDiscovery
  },
  "edge-beta": {
    id: "edge-beta",
    family: "edge",
    channel: "beta",
    displayName: "Microsoft Edge Beta",
    mention: "@edge-beta",
    macos: {
      bundleId: "com.microsoft.edgemac.Beta",
      appName: "Microsoft Edge Beta.app",
      profileRoot: ["Library", "Application Support", "Microsoft Edge Beta"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Microsoft Edge Beta",
        "NativeMessagingHosts"
      ],
      processNames: ["Microsoft Edge Beta", "Microsoft Edge Helper"]
    },
    windows: {
      executable: "msedge.exe",
      appPathSegments: ["Microsoft", "Edge Beta", "Application", "msedge.exe"],
      profileRootSegments: ["Microsoft", "Edge Beta", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
      processNames: ["msedge.exe"]
    },
    linux: {
      commands: ["microsoft-edge-beta"],
      profileRoot: [".config", "microsoft-edge-beta"],
      nativeMessagingHostDir: [
        ".config",
        "microsoft-edge-beta",
        "NativeMessagingHosts"
      ],
      processNames: ["microsoft-edge-beta"]
    },
    extensionDiscovery: commonExtensionDiscovery
  },
  "edge-dev": {
    id: "edge-dev",
    family: "edge",
    channel: "dev",
    displayName: "Microsoft Edge Dev",
    mention: "@edge-dev",
    macos: {
      bundleId: "com.microsoft.edgemac.Dev",
      appName: "Microsoft Edge Dev.app",
      profileRoot: ["Library", "Application Support", "Microsoft Edge Dev"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Microsoft Edge Dev",
        "NativeMessagingHosts"
      ],
      processNames: ["Microsoft Edge Dev", "Microsoft Edge Helper"]
    },
    windows: {
      executable: "msedge.exe",
      appPathSegments: ["Microsoft", "Edge Dev", "Application", "msedge.exe"],
      profileRootSegments: ["Microsoft", "Edge Dev", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
      processNames: ["msedge.exe"]
    },
    linux: {
      commands: ["microsoft-edge-dev"],
      profileRoot: [".config", "microsoft-edge-dev"],
      nativeMessagingHostDir: [
        ".config",
        "microsoft-edge-dev",
        "NativeMessagingHosts"
      ],
      processNames: ["microsoft-edge-dev"]
    },
    extensionDiscovery: commonExtensionDiscovery
  },
  "edge-canary": {
    id: "edge-canary",
    family: "edge",
    channel: "canary",
    displayName: "Microsoft Edge Canary",
    mention: "@edge-canary",
    macos: {
      bundleId: "com.microsoft.edgemac.Canary",
      appName: "Microsoft Edge Canary.app",
      profileRoot: ["Library", "Application Support", "Microsoft Edge Canary"],
      nativeMessagingHostDir: [
        "Library",
        "Application Support",
        "Microsoft Edge Canary",
        "NativeMessagingHosts"
      ],
      processNames: ["Microsoft Edge Canary", "Microsoft Edge Helper"]
    },
    windows: {
      executable: "msedge.exe",
      appPathSegments: ["Microsoft", "Edge SxS", "Application", "msedge.exe"],
      profileRootSegments: ["Microsoft", "Edge SxS", "User Data"],
      nativeMessagingRegistryKey:
        "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
      processNames: ["msedge.exe"]
    },
    linux: {
      commands: ["microsoft-edge-canary"],
      profileRoot: [".config", "microsoft-edge-canary"],
      nativeMessagingHostDir: [
        ".config",
        "microsoft-edge-canary",
        "NativeMessagingHosts"
      ],
      processNames: ["microsoft-edge-canary"]
    },
    extensionDiscovery: commonExtensionDiscovery
  }
};

export function targetIds() {
  return Object.keys(TARGETS);
}

export function getTarget(targetId) {
  const target = TARGETS[targetId];
  if (!target) {
    throw new Error(`Unknown browser target: ${targetId}`);
  }
  return target;
}
