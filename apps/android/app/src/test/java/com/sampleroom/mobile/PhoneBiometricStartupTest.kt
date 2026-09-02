package com.sampleroom.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneBiometricStartupTest {
    @Test
    fun coldStartUsesBiometricEntryWhenQuickLoginIsAvailable() {
        assertEquals(
            PhoneStartupDestination.BIOMETRIC_ENTRY,
            phoneStartupDestination(
                appWasInitialized = false,
                biometricQuickLoginEnabled = true
            )
        )
    }

    @Test
    fun firstUseWithoutQuickLoginStartsFromExplicitPasswordEntry() {
        assertEquals(
            PhoneStartupDestination.PASSWORD_ENTRY,
            phoneStartupDestination(
                appWasInitialized = false,
                biometricQuickLoginEnabled = false
            )
        )
    }

    @Test
    fun configurationRecreationKeepsAnAlreadyOpenedWorkspace() {
        assertEquals(
            PhoneStartupDestination.RESTORE_OPEN_APP,
            phoneStartupDestination(
                appWasInitialized = true,
                biometricQuickLoginEnabled = true
            )
        )
        assertEquals(
            PhoneStartupDestination.RESTORE_OPEN_APP,
            phoneStartupDestination(
                appWasInitialized = true,
                biometricQuickLoginEnabled = false
            )
        )
    }
}
