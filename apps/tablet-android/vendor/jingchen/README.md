# Jingchen / NIIMBOT B1 optional SDK

Sample Room OS keeps a real Jingchen B1 integration as a reference implementation, but does not redistribute the Jingchen Android SDK.

To build the optional Jingchen Pad variant:

1. Obtain the official SDK directly from Jingchen/NIIMBOT under terms that allow your use.
2. Put `4.1.1-release.aar` and `image-1.9.5.aar` in this directory. These files are ignored by Git.
3. Run Gradle with `-PenableJingchenSdk=true` and select the `jingchen` variant, for example `./gradlew.bat assembleJingchenRelease`.

Without that property, the default `openSource` variant builds and tests normally, but reports that the B1 SDK must be installed when native B1 printing is requested.
