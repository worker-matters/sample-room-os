# Jingchen / NIIMBOT B1 integration

Sample Room OS retains Jingchen/NIIMBOT B1 as its first real printer integration and reference implementation. The integration code remains in this repository; vendor binaries do not.

## PC browser printing

The Web receiver print flow talks only to the local Jingchen desktop service at `ws://127.0.0.1:37989`. Obtain and install the driver/desktop service directly from Jingchen/NIIMBOT. Sample Room OS does not distribute the installer. After installation, connect the B1 by USB, open the receiver print settings, and select the detected printer.

## Pad Bluetooth printing

The native Pad implementation is kept in `apps/tablet-android/app/src/jingchen/`. It is built only when the local user supplies the official Android SDK and passes `-PenableJingchenSdk=true`. See `apps/tablet-android/vendor/jingchen/README.md` for the required local files and build command.

The default `openSource` Pad variant deliberately does not include the SDK. It builds and tests normally, while native B1 printing reports that the official SDK must be installed.

## Redistribution

Do not add Jingchen installers, `.aar`, `.jar`, `.dll`, or native libraries to this repository unless Worker Matters has written permission to redistribute the exact files. If permission is later obtained, record the license/source/version and add the files as an explicitly optional vendor dependency rather than a default build input.
