plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val sampleRoomDefaultPublicEndpoint =
    System.getenv("SAMPLE_ROOM_DEFAULT_PUBLIC_BASE_URL")?.trim().orEmpty()
val sampleRoomDefaultPublicEndpointLiteral =
    "\"" + sampleRoomDefaultPublicEndpoint.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
val jingchenSdkEnabled = providers.gradleProperty("enableJingchenSdk").orNull == "true"
val jingchenSdkDirectory = layout.projectDirectory.dir("vendor/jingchen")

if (jingchenSdkEnabled) {
    val requiredSdkFiles = listOf("4.1.1-release.aar", "image-1.9.5.aar")
    val missingSdkFiles = requiredSdkFiles.filterNot { jingchenSdkDirectory.file(it).asFile.isFile }
    check(missingSdkFiles.isEmpty()) {
        "Jingchen SDK is enabled but missing: ${missingSdkFiles.joinToString()}. See vendor/jingchen/README.md."
    }
}

android {
    flavorDimensions += "printerSdk"
    productFlavors {
        create("openSource") { dimension = "printerSdk" }
        create("jingchen") { dimension = "printerSdk" }
    }
    namespace = "com.sampleroom.tablet"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sampleroom.tablet"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "0.3.2-update-test"
        buildConfigField("String", "DEFAULT_REMOTE_ENDPOINT", sampleRoomDefaultPublicEndpointLiteral)

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

androidComponents {
    beforeVariants(selector().withFlavor("printerSdk" to "jingchen")) { variantBuilder ->
        if (!jingchenSdkEnabled) variantBuilder.enable = false
    }
}

dependencies {
    if (jingchenSdkEnabled) {
        "jingchenImplementation"(files(
            jingchenSdkDirectory.file("4.1.1-release.aar"),
            jingchenSdkDirectory.file("image-1.9.5.aar")
        ))
    }
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.json:json:20240303")
}
