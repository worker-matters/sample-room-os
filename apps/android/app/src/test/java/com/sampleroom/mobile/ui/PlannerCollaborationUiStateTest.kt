package com.sampleroom.mobile.ui

import com.sampleroom.mobile.data.PlannerSewingCollaboration
import com.sampleroom.mobile.data.PlannerSewingParticipation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlannerCollaborationUiStateTest {
    private val active = PlannerSewingParticipation(
        id = "active-1",
        workerName = "缝制员工二号",
        joinedAt = "2026-08-29T14:17:00Z",
        targetPieces = 3,
        status = "active"
    )
    private val completed = PlannerSewingParticipation(
        id = "completed-1",
        workerName = "缝制员工一号",
        joinedAt = "2026-08-29T14:00:00Z",
        status = "completed",
        completedPieces = 4,
        completedAt = "2026-08-29T14:16:00Z"
    )

    @Test
    fun expansionDefaultsPrioritizeOngoingAndKeepSectionsIndependent() {
        val initial = PlannerCollaborationExpansionState()
        assertTrue(initial.ongoingExpanded)
        assertFalse(initial.completedExpanded)
        assertFalse(initial.warningExpanded)

        val bothExpanded = initial.copy(completedExpanded = true)
        assertTrue(bothExpanded.ongoingExpanded)
        assertTrue(bothExpanded.completedExpanded)

        val bothCollapsed = bothExpanded.copy(ongoingExpanded = false, completedExpanded = false)
        assertFalse(bothCollapsed.ongoingExpanded)
        assertFalse(bothCollapsed.completedExpanded)
    }

    @Test
    fun dirtyCountOnlyIncludesChangedPositiveTargetsForActiveParticipants() {
        val collaboration = collaboration(listOf(active, completed))
        assertTrue(changedPlannerTargets(collaboration, mapOf("active-1" to 3)).isEmpty())
        assertEquals(listOf("active-1" to 4), changedPlannerTargets(collaboration, mapOf("active-1" to 4)))
        assertTrue(changedPlannerTargets(collaboration, mapOf("active-1" to 0)).isEmpty())
        assertTrue(changedPlannerTargets(collaboration, mapOf("completed-1" to 8)).isEmpty())
    }

    @Test
    fun performanceWarningOnlyAppearsWhenReportedPiecesReachQuantityAndWorkRemains() {
        assertTrue(plannerPerformanceNeedsReview(collaboration(listOf(active, completed))))
        assertFalse(plannerPerformanceNeedsReview(collaboration(listOf(completed), activeCount = 0)))
        assertFalse(plannerPerformanceNeedsReview(collaboration(listOf(active, completed), completedPieces = 3)))
    }

    private fun collaboration(
        participants: List<PlannerSewingParticipation>,
        activeCount: Int = 1,
        completedPieces: Int = 4
    ) = PlannerSewingCollaboration(
        orderId = "order-1",
        quantity = 4,
        revision = "revision-1",
        plannedPieces = 3,
        unallocatedPieces = 1,
        completedPieces = completedPieces,
        activeParticipantCount = activeCount,
        effectiveParticipantCount = participants.count { it.status == "completed" },
        sewingGateSatisfied = activeCount == 0,
        participants = participants
    )
}
