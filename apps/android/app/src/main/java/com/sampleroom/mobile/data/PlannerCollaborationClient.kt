package com.sampleroom.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class PlannerCollaborationClient {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun get(session: Session, orderId: String): PlannerSewingCollaboration =
        withContext(Dispatchers.IO) {
            parseCollaboration(
                execute(
                    session,
                    "/api/planner/orders/$orderId/sewing-collaboration"
                ).getJSONObject("collaboration")
            )
        }

    suspend fun updateTargets(
        session: Session,
        orderId: String,
        expectedRevision: String,
        updates: List<Pair<String, Int>>
    ): PlannerSewingCollaboration = withContext(Dispatchers.IO) {
        require(updates.isNotEmpty() && updates.all { it.second > 0 }) { "计划件数必须大于 0" }
        parseCollaboration(execute(
            session,
            "/api/planner/orders/$orderId/sewing-collaboration/targets",
            "PATCH",
            JSONObject()
                .put("expectedRevision", expectedRevision)
                .put("updates", org.json.JSONArray(updates.map { (id, pieces) ->
                    JSONObject().put("participationId", id).put("targetPieces", pieces)
                }))
        ).getJSONObject("collaboration"))
    }

    suspend fun cancelParticipation(
        session: Session,
        orderId: String,
        participationId: String,
        expectedRevision: String
    ) = withContext(Dispatchers.IO) {
        val result = execute(
            session,
            "/api/planner/orders/$orderId/sewing-collaboration/$participationId/cancel",
            "POST",
            JSONObject().put("expectedRevision", expectedRevision)
        )
        val participation = result.getJSONObject("participation")
        PlannerParticipationCancellation(
            sewingMode = participation.optString("sewingMode"),
            collaboration = parseCollaboration(participation)
        )
    }

    private fun execute(
        session: Session,
        path: String,
        method: String = "GET",
        body: JSONObject = JSONObject()
    ): JSONObject {
        val builder = Request.Builder()
            .url("${session.endpoint.baseUrl.trimEnd('/')}$path")
            .header("Authorization", "Bearer ${session.token}")
        val requestBody = body.toString().toRequestBody(jsonMediaType)
        when (method) {
            "PATCH" -> builder.patch(requestBody)
            "POST" -> builder.post(requestBody)
        }
        return client.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) {
                throw IllegalStateException(
                    json.optString("message", json.optString("error", "协作分配请求失败（${response.code}）"))
                )
            }
            json
        }
    }

    private fun parseCollaboration(json: JSONObject) = PlannerSewingCollaboration(
        orderId = json.optString("orderId"),
        quantity = json.optInt("quantity"),
        revision = json.optString("revision"),
        plannedPieces = json.optInt("plannedPieces"),
        unallocatedPieces = json.optInt("unallocatedPieces"),
        completedPieces = json.optInt("completedPieces"),
        activeParticipantCount = json.optInt("activeParticipantCount"),
        effectiveParticipantCount = json.optInt("effectiveParticipantCount"),
        sewingGateSatisfied = json.optBoolean("sewingGateSatisfied"),
        participants = json.optJSONArray("participants")?.let { array ->
            (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                PlannerSewingParticipation(
                    id = item.optString("id"),
                    workerName = item.optString("workerName"),
                    joinedAt = item.optString("joinedAt"),
                    targetPieces = if (item.has("targetPieces") && !item.isNull("targetPieces")) {
                        item.optInt("targetPieces")
                    } else null,
                    status = item.optString("status"),
                    completedPieces = if (item.has("completedPieces") && !item.isNull("completedPieces")) {
                        item.optInt("completedPieces")
                    } else null,
                    completedAt = item.optString("completedAt"),
                    cancelledAt = item.optString("cancelledAt")
                )
            }
        }.orEmpty()
    )
}
