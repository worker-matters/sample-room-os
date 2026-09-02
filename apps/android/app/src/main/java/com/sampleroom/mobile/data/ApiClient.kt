package com.sampleroom.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiClient {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun login(
        endpoint: SelectedEndpoint,
        loginId: String,
        password: String
    ): Session = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put(loginPayloadKey(loginId), loginId.trim())
            .put("password", password)
            .put("clientType", "android")
        val json = execute(endpoint.baseUrl, "/api/auth/login", "POST", body = body)
        Session(
            token = json.getString("token"),
            expiresAt = json.getString("expiresAt"),
            identity = parseIdentity(json.getJSONObject("user")),
            endpoint = endpoint
        )
    }

    suspend fun restore(endpoint: SelectedEndpoint, token: String): Session = withContext(Dispatchers.IO) {
        val json = execute(endpoint.baseUrl, "/api/auth/me", token = token)
        Session(token, "", parseIdentity(json.getJSONObject("user")), endpoint)
    }

    suspend fun logout(session: Session) = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/auth/logout", "POST", token = session.token, body = JSONObject())
        Unit
    }

    suspend fun listOrders(session: Session): List<MobileOrder> = withContext(Dispatchers.IO) {
        val path = when (session.identity.homeRoute) {
            "/receiver/home", "/pages/receiver/home" -> "/api/miniapp/receiver/orders"
            "/planner/home", "/pages/planner/home" -> "/api/miniapp/planner/orders"
            "/client/home", "/pages/client/orders" -> "/api/miniapp/client/orders"
            else -> throw IllegalStateException("当前账号没有移动订单入口")
        }
        val json = execute(session.endpoint.baseUrl, path, token = session.token)
        json.getJSONArray("orders").mapObjects(::parseOrder)
    }

    suspend fun resolveOrder(session: Session, payload: String): ScanResult = withContext(Dispatchers.IO) {
        val parsed = OrderQrParser.parse(payload)
        val json = execute(
            session.endpoint.baseUrl,
            "/api/scan/resolve",
            "POST",
            session.token,
            JSONObject().put("payload", payload)
        )
        parseWorkerScanState(parsed.token, json.getJSONObject("state"))
    }

    suspend fun startWorkerScan(session: Session, current: ScanResult): ScanResult = withContext(Dispatchers.IO) {
        val json = execute(
            session.endpoint.baseUrl,
            "/api/scan/${current.token}/start",
            "POST",
            session.token,
            JSONObject()
        )
        parseWorkerScanState(current.token, json.getJSONObject("state"))
    }

    suspend fun completeWorkerScan(
        session: Session,
        current: ScanResult,
        completion: WorkerScanCompletion,
        onUploadProgress: ((uploaded: Int, total: Int) -> Unit)? = null
    ): ScanResult = withContext(Dispatchers.IO) {
        val action = "complete"
        val fields = linkedMapOf(
            "pieces" to completion.pieces.toString(),
            "note" to completion.note
        )
        completion.workHours?.let { fields["workHours"] = it.toString() }
        completion.qualityResult?.let { fields["qualityResult"] = it }
        completion.qualityScore?.let { fields["qualityScore"] = it.toString() }
        if (current.collaborationParticipationId.isNotBlank() && current.collaborationRevision.isNotBlank()) {
            fields["expectedParticipationId"] = current.collaborationParticipationId
            fields["expectedCollaborationRevision"] = current.collaborationRevision
        }
        if (current.entrySource == "sewing_task") {
            val json = execute(
                session.endpoint.baseUrl,
                "/api/miniapp/me/sewing-tasks/${current.orderId}/complete",
                "POST",
                session.token,
                JSONObject(fields as Map<*, *>)
            )
            return@withContext parseWorkerScanState(
                "",
                json.getJSONObject("state"),
                current.orderId,
                "sewing_task"
            )
        }
        if (current.entrySource == "qc_rework") {
            val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            fields.forEach { (key, value) -> multipart.addFormDataPart(key, value) }
            if (completion.photos.isNotEmpty()) {
                multipart.addFormDataPart(
                    "attachmentMetadata",
                    JSONArray(completion.photos.map { mapOf("category" to (it.category ?: "qc_sample_photo")) }).toString()
                )
                completion.photos.forEach { photo ->
                    multipart.addFormDataPart(
                        "files",
                        photo.fileName,
                        photo.bytes.toRequestBody(photo.mimeType.toMediaType())
                    )
                }
            }
            val json = executeRequest(
                Request.Builder()
                    .url("${session.endpoint.baseUrl}/api/qc/me/orders/${current.orderId}/reinspect")
                    .header("Authorization", "Bearer ${session.token}")
                    .post(multipart.build())
                    .build()
            )
            onUploadProgress?.invoke(completion.photos.size, completion.photos.size)
            return@withContext parseWorkerScanState(
                "",
                json.getJSONObject("state"),
                current.orderId,
                "qc_rework"
            )
        }
        val path = "/api/scan/${current.token}/$action"
        val json = if (completion.photos.isNotEmpty()) {
            val batchId = execute(
                session.endpoint.baseUrl,
                "/api/scan/${current.token}/qc-evidence-batches",
                "POST",
                session.token,
                JSONObject().put("action", action)
            ).getString("batchId")
            completion.photos.forEachIndexed { index, photo ->
                uploadMultipart(
                    session,
                    "/api/scan/${current.token}/qc-evidence-batches/$batchId/files",
                    photo,
                    photo.category?.let { mapOf("category" to it) }.orEmpty()
                )
                onUploadProgress?.invoke(index + 1, completion.photos.size)
            }
            execute(
                session.endpoint.baseUrl,
                path,
                "POST",
                session.token,
                JSONObject(fields as Map<*, *>).put("qcEvidenceBatchId", batchId)
            )
        } else {
            execute(
                session.endpoint.baseUrl,
                path,
                "POST",
                session.token,
                JSONObject(fields as Map<*, *>)
            )
        }
        parseWorkerScanState(current.token, json.getJSONObject("state"))
    }

    suspend fun takeoverWorkerScan(
        session: Session,
        current: ScanResult,
        reason: String
    ): ScanResult = withContext(Dispatchers.IO) {
        val expectedWorkerId = current.activeTaskWorkerId
            ?: throw IllegalStateException("当前任务负责人已变化，请重新扫码")
        val json = execute(
            session.endpoint.baseUrl,
            "/api/scan/${current.token}/sewing-takeover",
            "POST",
            session.token,
            JSONObject()
                .put("expectedActiveWorkerId", expectedWorkerId)
                .put("reason", reason)
        )
        parseWorkerScanState(current.token, json.getJSONObject("state"))
    }

    suspend fun joinCollaborativeSewing(
        session: Session,
        current: ScanResult
    ): ScanResult = withContext(Dispatchers.IO) {
        val json = execute(
            session.endpoint.baseUrl,
            "/api/scan/${current.token}/sewing-collaboration",
            "POST",
            session.token,
            JSONObject()
                .put("expectedCollaborationRevision", current.collaborationRevision)
        )
        parseWorkerScanState(current.token, json.getJSONObject("state"))
    }

    private fun parseWorkerScanState(
        token: String,
        json: JSONObject,
        orderId: String = "",
        entrySource: String = "scan"
    ): ScanResult {
        val safe = json.getJSONObject("order")
        val resolvedOrderId = orderId.ifBlank { safe.optString("id") }
        val order = MobileOrder(
            id = "",
            orderNo = "",
            styleNo = safe.optString("styleNo"),
            styleName = safe.optString("styleName"),
            customerName = safe.optString("customerName"),
            salespersonName = safe.optString("salespersonName"),
            quantity = safe.optInt("quantity"),
            deliveryDate = "",
            stageLabel = json.optString("stageLabel"),
            sampleType = safe.optString("sampleType"),
            sampleRound = safe.optString("sampleRound"),
            remark = "",
            thumbnailUrl = safe.optString("thumbnailUrl"),
            recordSubmittedAt = safe.optString("recordSubmittedAt")
        )
        val activeTask = json.optJSONObject("activeTask")
        val collaboration = json.optJSONObject("collaboration")
        val latestRework = json.optJSONObject("latestRework")
        return ScanResult(
            token = token,
            orderId = resolvedOrderId,
            entrySource = entrySource,
            order = order,
            currentStageLabel = json.optString("stageLabel", "暂无可处理工序"),
            statusMessage = json.optString("message", "订单状态已更新"),
            stage = json.optString("stage").takeIf { it.isNotBlank() },
            allowedAction = json.optString("allowedAction", "blocked"),
            blockedReason = json.optString("blockedReason").takeIf { it.isNotBlank() },
            defaultPieces = if (json.has("defaultPieces")) json.optInt("defaultPieces") else null,
            activeTaskWorkerId = activeTask?.optString("workerId")?.takeIf { it.isNotBlank() },
            activeTaskWorkerName = activeTask?.optString("workerName")?.takeIf { it.isNotBlank() },
            collaborationTargetPieces = collaboration?.optInt("targetPieces")?.takeIf { collaboration.has("targetPieces") },
            collaborationCurrentParticipantCount = collaboration?.optInt("currentParticipantCount") ?: 0,
            collaborationUnallocatedPieces = collaboration?.optInt("unallocatedPieces") ?: 0,
            collaborationParticipationId = collaboration?.optString("participationId").orEmpty(),
            collaborationRevision = collaboration?.optString("revision").orEmpty(),
            collaborationExpectedActiveWorkerIds = collaboration?.optJSONArray("expectedActiveWorkerIds")?.let { array ->
                (0 until array.length()).map { index -> array.optString(index) }
            } ?: emptyList(),
            latestRework = latestRework?.let { rework ->
                QcReworkRecord(
                    note = rework.optString("note"),
                    eventTime = rework.optString("eventTime"),
                    workerName = rework.optString("workerName"),
                    photos = rework.optJSONArray("photos")?.mapObjects { photo ->
                        QcReworkPhoto(
                            id = photo.optString("id"),
                            fileName = photo.optString("fileName"),
                            previewUrl = photo.optString("previewUrl").ifBlank {
                                if (resolvedOrderId.isBlank()) ""
                                else "/api/qc/me/orders/$resolvedOrderId/photos/${photo.optString("id")}/download"
                            }
                        )
                    }.orEmpty()
                )
            }
        )
    }

    suspend fun listOwnSewingTasks(session: Session): List<SewingTask> = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/miniapp/me/sewing-tasks", token = session.token)
            .optJSONArray("tasks")?.mapObjects { item ->
                SewingTask(
                    orderId = item.optString("orderId"),
                    styleNo = item.optString("styleNo"),
                    styleName = item.optString("styleName"),
                    sampleType = item.optString("sampleType"),
                    sampleRound = item.optString("sampleRound"),
                    quantity = item.optInt("quantity"),
                    startedAt = item.optString("startedAt"),
                    thumbnailUrl = item.optString("thumbnailUrl"),
                    previousReworkReason = item.optString("previousReworkReason"),
                    collaboration = item.optBoolean("collaboration"),
                    participationId = item.optString("participationId"),
                    targetPieces = item.optInt("targetPieces").takeIf { item.has("targetPieces") },
                    collaborationRevision = item.optString("collaborationRevision")
                )
            }.orEmpty()
    }

    suspend fun getOwnSewingTask(session: Session, orderId: String): ScanResult = withContext(Dispatchers.IO) {
        val json = execute(
            session.endpoint.baseUrl,
            "/api/miniapp/me/sewing-tasks/$orderId",
            token = session.token
        )
        parseWorkerScanState("", json.getJSONObject("state"), orderId, "sewing_task")
    }

    suspend fun listQcReworkTasks(
        session: Session,
        query: String = "",
        dateFrom: String = "",
        dateTo: String = ""
    ): List<QcPerformanceRecord> = withContext(Dispatchers.IO) {
        val params = listOfNotNull(
            query.takeIf { it.isNotBlank() }?.let { "q=${java.net.URLEncoder.encode(it, "UTF-8")}" },
            dateFrom.takeIf { it.isNotBlank() }?.let { "dateFrom=$it" },
            dateTo.takeIf { it.isNotBlank() }?.let { "dateTo=$it" }
        ).joinToString("&")
        parseQcRecords(execute(
            session.endpoint.baseUrl,
            "/api/qc/me/rework-orders${if (params.isBlank()) "" else "?$params"}",
            token = session.token
        ))
    }

    suspend fun getQcReworkTask(session: Session, orderId: String): ScanResult = withContext(Dispatchers.IO) {
        val order = execute(
            session.endpoint.baseUrl,
            "/api/qc/me/orders/$orderId",
            token = session.token
        ).getJSONObject("order")
        val state = order.getJSONObject("state")
        state.getJSONObject("order")
            .put("sampleType", order.optString("sampleType"))
            .put("recordSubmittedAt", order.optString("eventTime"))
            .put("thumbnailUrl", order.optString("thumbnailUrl"))
        order.optJSONObject("latestRework")?.let { state.put("latestRework", it) }
        parseWorkerScanState("", state, orderId, "qc_rework")
    }

    suspend fun uploadReceiverMaterialRecord(session: Session, orderId: String, upload: UploadPayload) =
        withContext(Dispatchers.IO) {
            val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("category", "receiver_material_record")
                .addFormDataPart("visibility", "internal_only")
                .addFormDataPart("files", upload.fileName, upload.bytes.toRequestBody(upload.mimeType.toMediaType()))
                .build()
            executeRequest(
                Request.Builder()
                    .url("${session.endpoint.baseUrl}/api/miniapp/receiver/orders/${orderId}/attachments")
                    .header("Authorization", "Bearer ${session.token}")
                    .post(multipart)
                    .build()
            )
            Unit
        }

    suspend fun listReceiverSelfEntryOptions(session: Session): List<ReceiverCustomer> =
        withContext(Dispatchers.IO) {
            val json = execute(
                session.endpoint.baseUrl,
                "/api/miniapp/receiver/self-entry-options",
                token = session.token
            )
            json.getJSONArray("customers").mapObjects { customer ->
                ReceiverCustomer(
                    id = customer.optString("id"),
                    name = customer.optString("name"),
                    clientUsers = customer.optJSONArray("clientUsers")?.mapObjects { user ->
                        ReceiverClientUser(
                            id = user.optString("id"),
                            customerId = user.optString("customerId"),
                            displayName = user.optString("displayName")
                        )
                    }.orEmpty()
                )
            }
        }

    suspend fun createReceiverIntake(
        session: Session,
        draft: ReceiverIntakeDraft,
        uploads: List<UploadPayload>,
        thumbnail: UploadPayload?,
        quick: Boolean
    ): MobileOrder = withContext(Dispatchers.IO) {
        require(uploads.isNotEmpty()) { "请先拍照或选择打样单附件" }
        val fields = linkedMapOf(
            "customerId" to draft.customerId,
            "clientUserId" to draft.clientUserId,
            "category" to "receiver_quick_photo",
            "visibility" to "client_visible"
        )
        if (!quick || draft.styleNo.isNotBlank()) fields["styleNo"] = draft.styleNo.trim()
        if (!quick || draft.styleName.isNotBlank()) fields["styleName"] = draft.styleName.trim()
        if (!quick || draft.quantity.isNotBlank()) fields["quantity"] = draft.quantity
        if (!quick || draft.sampleType.isNotBlank()) fields["sampleType"] = draft.sampleType
        if (!quick || draft.sampleRound.isNotBlank()) fields["sampleRound"] = draft.sampleRound
        if (!quick || draft.deliveryDate.isNotBlank()) fields["deliveryDate"] = draft.deliveryDate
        if (draft.remark.isNotBlank()) fields["remark"] = draft.remark.trim()
        if (!quick) {
            fields["patternStatus"] = "none"
            fields["fabricStatus"] = draft.fabricStatus
            fields["trimStatus"] = draft.trimStatus
            fields["sampleRequestItems"] = JSONArray(draft.sampleRequestItems).toString()
        }
        val requestUploads = if (thumbnail == null) uploads else uploads + thumbnail
        if (thumbnail != null) fields["thumbnailAttachmentIndex"] = uploads.size.toString()
        val response = uploadMultipartMany(
            session,
            if (quick) "/api/miniapp/receiver/quick-photo" else "/api/miniapp/receiver/intake",
            requestUploads,
            fields
        )
        parseOrder(response.getJSONObject("order"))
    }

    suspend fun listOrderCharges(session: Session, orderId: String): List<ReceiverCharge> =
        withContext(Dispatchers.IO) {
            val rolePath = when (session.identity.role) {
                "receiver" -> "receiver"
                "planner" -> "planner"
                else -> throw IllegalStateException("当前账号不能查看其他费用")
            }
            val json = execute(
                session.endpoint.baseUrl,
                "/api/miniapp/$rolePath/orders/$orderId/charges",
                token = session.token
            )
            json.optJSONArray("charges")?.mapObjects(::parseCharge).orEmpty()
        }

    suspend fun renameOrderCharge(
        session: Session,
        orderId: String,
        chargeId: String,
        name: String
    ): List<ReceiverCharge> = withContext(Dispatchers.IO) {
        val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/$rolePath/orders/$orderId/charges/$chargeId/display-name",
            "POST",
            session.token,
            JSONObject().put("name", name.trim())
        )
        listOrderCharges(session, orderId)
    }

    suspend fun deleteOwnOrderCharge(
        session: Session,
        orderId: String,
        chargeId: String
    ): List<ReceiverCharge> = withContext(Dispatchers.IO) {
        val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/$rolePath/orders/$orderId/charges/$chargeId/void",
            "POST",
            session.token,
            JSONObject()
        )
        listOrderCharges(session, orderId)
    }

    suspend fun updateOrderCharge(
        session: Session,
        orderId: String,
        chargeId: String,
        name: String,
        amount: Double,
        explanation: String
    ): List<ReceiverCharge> = withContext(Dispatchers.IO) {
        val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/$rolePath/orders/$orderId/charges/$chargeId/display-name",
            "POST",
            session.token,
            JSONObject().put("name", name.trim()).put("amount", amount).put("explanation", explanation.trim())
        )
        listOrderCharges(session, orderId)
    }

    suspend fun renameChargeAttachment(
        session: Session,
        orderId: String,
        chargeId: String,
        attachmentId: String,
        displayName: String
    ): List<ReceiverCharge> = withContext(Dispatchers.IO) {
        val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/$rolePath/orders/$orderId/charges/$chargeId/attachments/$attachmentId/display-name",
            "PATCH",
            session.token,
            JSONObject().put("displayName", displayName.trim())
        )
        listOrderCharges(session, orderId)
    }

    suspend fun deleteChargeAttachment(
        session: Session,
        orderId: String,
        chargeId: String,
        attachmentId: String
    ): List<ReceiverCharge> = withContext(Dispatchers.IO) {
        val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/$rolePath/orders/$orderId/charges/$chargeId/attachments/$attachmentId",
            "DELETE",
            session.token
        )
        listOrderCharges(session, orderId)
    }

    suspend fun resolveReceiverScanCharge(session: Session, payload: String): ReceiverScanChargeContext =
        withContext(Dispatchers.IO) {
            val token = OrderQrParser.parse(payload).token
            val json = execute(
                session.endpoint.baseUrl,
                "/api/miniapp/receiver/scan-charge/resolve",
                "POST",
                session.token,
                JSONObject().put("token", token)
            )
            parseReceiverScanChargeContext(json)
        }

    suspend fun createReceiverScanCharge(
        session: Session,
        payload: String,
        name: String,
        amount: Double,
        explanation: String,
        uploads: List<UploadPayload>
    ): ReceiverScanChargeContext = withContext(Dispatchers.IO) {
        val token = OrderQrParser.parse(payload).token
        val created = execute(
            session.endpoint.baseUrl,
            "/api/miniapp/receiver/scan-charge/charges",
            "POST",
            session.token,
            JSONObject().put("token", token).put(
                "charge",
                JSONObject()
                    .put("name", name.trim())
                    .put("amount", amount)
                    .put("explanation", explanation.trim())
                    .put("sourceScene", "receiver_mobile_scan")
            )
        )
        val orderId = created.getString("orderId")
        val chargeId = created.getJSONObject("charge").getString("id")
        uploads.forEach { upload ->
            uploadMultipart(
                session,
                "/api/miniapp/receiver/orders/$orderId/charges/$chargeId/attachments",
                upload,
                mapOf("category" to "order_charge", "visibility" to "internal_only")
            )
        }
        val refreshed = execute(
            session.endpoint.baseUrl,
            "/api/miniapp/receiver/scan-charge/resolve",
            "POST",
            session.token,
            JSONObject().put("token", token)
        )
        parseReceiverScanChargeContext(refreshed)
    }

    suspend fun resolvePlannerScanCharge(session: Session, payload: String): ReceiverScanChargeContext =
        withContext(Dispatchers.IO) {
            val token = OrderQrParser.parse(payload).token
            parseReceiverScanChargeContext(
                execute(
                    session.endpoint.baseUrl,
                    "/api/miniapp/planner/scan-charge/resolve",
                    "POST",
                    session.token,
                    JSONObject().put("token", token)
                )
            )
        }

    suspend fun createPlannerScanCharge(
        session: Session,
        payload: String,
        name: String,
        amount: Double,
        explanation: String,
        uploads: List<UploadPayload>
    ): ReceiverScanChargeContext = withContext(Dispatchers.IO) {
        val token = OrderQrParser.parse(payload).token
        val created = execute(
            session.endpoint.baseUrl,
            "/api/miniapp/planner/scan-charge/charges",
            "POST",
            session.token,
            JSONObject().put("token", token).put(
                "charge",
                JSONObject()
                    .put("name", name.trim())
                    .put("amount", amount)
                    .put("explanation", explanation.trim())
                    .put("sourceScene", "planner_mobile_scan")
            )
        )
        val orderId = created.getString("orderId")
        val chargeId = created.getJSONObject("charge").getString("id")
        uploads.forEach { upload ->
            uploadMultipart(
                session,
                "/api/miniapp/planner/orders/$orderId/charges/$chargeId/attachments",
                upload,
                mapOf("category" to "order_charge", "visibility" to "internal_only")
            )
        }
        parseReceiverScanChargeContext(
            execute(
                session.endpoint.baseUrl,
                "/api/miniapp/planner/scan-charge/resolve",
                "POST",
                session.token,
                JSONObject().put("token", token)
            )
        )
    }

    suspend fun getPlannerOrderChargeContext(
        session: Session,
        order: MobileOrder
    ): ReceiverScanChargeContext = withContext(Dispatchers.IO) {
        val summary = execute(
            session.endpoint.baseUrl,
            "/api/miniapp/planner/orders/${order.id}/charges",
            token = session.token
        )
        ReceiverScanChargeContext(
            order = order,
            chargeLocked = summary.optBoolean("chargeLocked"),
            charges = summary.optJSONArray("charges")?.mapObjects(::parseCharge).orEmpty()
        )
    }

    suspend fun createPlannerOrderCharge(
        session: Session,
        order: MobileOrder,
        name: String,
        amount: Double,
        explanation: String,
        uploads: List<UploadPayload>
    ): ReceiverScanChargeContext = withContext(Dispatchers.IO) {
        val created = execute(
            session.endpoint.baseUrl,
            "/api/miniapp/planner/orders/${order.id}/charges",
            "POST",
            session.token,
            JSONObject().put(
                "charge",
                JSONObject()
                    .put("name", name.trim())
                    .put("amount", amount)
                    .put("explanation", explanation.trim())
                    .put("sourceScene", "planner_mobile_order_list")
            )
        )
        val chargeId = created.getJSONObject("charge").getString("id")
        uploads.forEach { upload ->
            uploadMultipart(
                session,
                "/api/miniapp/planner/orders/${order.id}/charges/$chargeId/attachments",
                upload,
                mapOf("category" to "order_charge", "visibility" to "internal_only")
            )
        }
        getPlannerOrderChargeContext(session, order)
    }

    suspend fun listReceiverAttachments(session: Session, orderId: String): List<MobileAttachment> =
        withContext(Dispatchers.IO) {
            val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
            val json = execute(
                session.endpoint.baseUrl,
                "/api/miniapp/$rolePath/orders/$orderId/attachments",
                token = session.token
            )
            json.getJSONArray("attachments").mapObjects { attachment ->
                MobileAttachment(
                    id = attachment.optString("id"),
                    orderId = attachment.optString("orderId"),
                    fileName = attachment.optString("fileName"),
                    mimeType = attachment.optString("mimeType"),
                    category = attachment.optString("category"),
                    uploadedByName = attachment.optString("uploadedByName"),
                    uploadedByRole = attachment.optString("uploadedByRole"),
                    createdAt = attachment.optString("createdAt"),
                    size = attachment.optLong("size"),
                    visibility = attachment.optString("visibility", "internal_only"),
                    orderChargeId = attachment.optString("orderChargeId"),
                    hasFile = attachment.optBoolean("hasFile", true),
                    canRename = attachment.optBoolean("canRename"),
                    canDelete = attachment.optBoolean("canDelete")
                )
            }
        }

    suspend fun renameAttachment(session: Session, orderId: String, attachmentId: String, displayName: String): List<MobileAttachment> =
        withContext(Dispatchers.IO) {
            val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
            parseAttachments(execute(
                session.endpoint.baseUrl,
                "/api/miniapp/$rolePath/orders/$orderId/attachments/$attachmentId/display-name",
                "POST",
                session.token,
                JSONObject().put("displayName", displayName.trim())
            ))
        }

    suspend fun deleteAttachment(session: Session, orderId: String, attachmentId: String): List<MobileAttachment> =
        withContext(Dispatchers.IO) {
            val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
            parseAttachments(execute(
                session.endpoint.baseUrl,
                "/api/miniapp/$rolePath/orders/$orderId/attachments/$attachmentId",
                "DELETE",
                session.token
            ))
        }

    suspend fun updateAttachment(
        session: Session,
        orderId: String,
        attachmentId: String,
        displayName: String,
        visibility: String
    ): List<MobileAttachment> = withContext(Dispatchers.IO) {
        renameAttachment(session, orderId, attachmentId, displayName)
        val rolePath = if (session.identity.role == "planner") "planner" else "receiver"
        parseAttachments(execute(
            session.endpoint.baseUrl,
            "/api/miniapp/$rolePath/orders/$orderId/attachments/$attachmentId/visibility",
            "POST",
            session.token,
            JSONObject().put("visibility", visibility)
        ))
    }

    suspend fun listBossPricing(session: Session): List<BossPricingRow> = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/miniapp/boss/pricing/orders", token = session.token)
            .optJSONArray("rows")?.mapObjects(::parseBossPricingRow).orEmpty()
    }

    suspend fun getBossPricing(session: Session, orderId: String): BossPricingDetail = withContext(Dispatchers.IO) {
        parseBossPricingDetail(
            execute(session.endpoint.baseUrl, "/api/miniapp/boss/orders/$orderId/pricing", token = session.token)
        )
    }

    suspend fun initializeBossPricing(session: Session, orderId: String): BossPricingDetail = withContext(Dispatchers.IO) {
        parseBossPricingDetail(
            execute(
                session.endpoint.baseUrl,
                "/api/miniapp/boss/orders/$orderId/pricing/initialize",
                "POST",
                session.token,
                JSONObject()
            )
        )
    }

    suspend fun createBossCustomerCharge(
        session: Session,
        orderId: String,
        item: BossCustomerChargeItem
    ) = withContext(Dispatchers.IO) {
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/boss/orders/$orderId/pricing/customer-charges",
            "POST",
            session.token,
            customerChargePayload(item)
        )
    }

    suspend fun updateBossCustomerCharge(
        session: Session,
        orderId: String,
        item: BossCustomerChargeItem
    ) = withContext(Dispatchers.IO) {
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/boss/orders/$orderId/pricing/customer-charges/${item.id}/update",
            "POST",
            session.token,
            customerChargePayload(item)
        )
    }

    suspend fun deleteBossCustomerCharge(session: Session, orderId: String, itemId: String) = withContext(Dispatchers.IO) {
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/boss/orders/$orderId/pricing/customer-charges/$itemId",
            "DELETE",
            session.token
        )
    }

    suspend fun createBossInternalCost(
        session: Session,
        orderId: String,
        item: BossInternalCostItem
    ) = withContext(Dispatchers.IO) {
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/boss/orders/$orderId/pricing/internal-costs",
            "POST",
            session.token,
            internalCostPayload(item)
        )
    }

    suspend fun updateBossInternalCost(
        session: Session,
        orderId: String,
        item: BossInternalCostItem
    ) = withContext(Dispatchers.IO) {
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/boss/orders/$orderId/pricing/internal-costs/${item.id}/update",
            "POST",
            session.token,
            internalCostPayload(item)
        )
    }

    suspend fun deleteBossInternalCost(session: Session, orderId: String, itemId: String) = withContext(Dispatchers.IO) {
        execute(
            session.endpoint.baseUrl,
            "/api/miniapp/boss/orders/$orderId/pricing/internal-costs/$itemId",
            "DELETE",
            session.token
        )
    }

    suspend fun confirmBossQuotation(session: Session, orderId: String) = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/miniapp/boss/orders/$orderId/pricing/confirm", "POST", session.token, JSONObject())
    }

    suspend fun beginBossQuotationUpdate(session: Session, orderId: String) = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/miniapp/boss/orders/$orderId/pricing/begin-update", "POST", session.token, JSONObject())
    }

    suspend fun listBossOrderCharges(session: Session, orderId: String): List<BossOrderCharge> = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/miniapp/boss/orders/$orderId/charges", token = session.token)
            .optJSONArray("charges")?.mapObjects(::parseBossOrderCharge).orEmpty()
    }

    suspend fun createBossOrderCharge(session: Session, orderId: String, name: String, amount: Double) =
        withContext(Dispatchers.IO) {
            execute(
                session.endpoint.baseUrl,
                "/api/miniapp/boss/orders/$orderId/charges",
                "POST",
                session.token,
                JSONObject()
                    .put("name", name.trim())
                    .put("amount", amount)
                    .put("sourceScene", "boss_mobile")
            )
        }

    suspend fun confirmBossOrderCharge(session: Session, orderId: String, chargeId: String) =
        withContext(Dispatchers.IO) {
            execute(
                session.endpoint.baseUrl,
                "/api/miniapp/boss/orders/$orderId/charges/$chargeId/confirm",
                "POST",
                session.token,
                JSONObject()
            )
        }

    suspend fun deleteBossOrderCharge(session: Session, orderId: String, chargeId: String) =
        withContext(Dispatchers.IO) {
            execute(
                session.endpoint.baseUrl,
                "/api/miniapp/boss/orders/$orderId/charges/$chargeId",
                "DELETE",
                session.token
            )
        }

    suspend fun listStatements(session: Session): List<ReconciliationStatement> = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/miniapp/boss/reconciliation-statements?includeReturned=true", token = session.token)
            .optJSONArray("statements")?.mapObjects(::parseStatement).orEmpty()
    }

    suspend fun createStatement(session: Session, orderIds: List<String>): ReconciliationStatement = withContext(Dispatchers.IO) {
        val ids = JSONArray().apply { orderIds.forEach(::put) }
        parseStatement(execute(session.endpoint.baseUrl, "/api/miniapp/boss/reconciliation-statements", "POST", session.token,
            JSONObject().put("orderIds", ids)).getJSONObject("statement"))
    }

    suspend fun returnStatement(session: Session, statementId: String): ReconciliationStatement = withContext(Dispatchers.IO) {
        parseStatement(execute(session.endpoint.baseUrl, "/api/miniapp/boss/reconciliation-statements/$statementId/return", "POST", session.token, JSONObject()).getJSONObject("statement"))
    }

    suspend fun returnStatementItem(session: Session, statementId: String, itemId: String): ReconciliationStatement = withContext(Dispatchers.IO) {
        parseStatement(execute(session.endpoint.baseUrl, "/api/miniapp/boss/reconciliation-statements/$statementId/items/$itemId/return", "POST", session.token, JSONObject()).getJSONObject("statement"))
    }

    suspend fun markStatementPaid(session: Session, statementId: String): ReconciliationStatement = withContext(Dispatchers.IO) {
        parseStatement(
            execute(
                session.endpoint.baseUrl,
                "/api/miniapp/boss/reconciliation-statements/$statementId/mark-paid",
                "POST",
                session.token,
                JSONObject()
            ).getJSONObject("statement")
        )
    }

    suspend fun undoStatementPaid(session: Session, statementId: String): ReconciliationStatement = withContext(Dispatchers.IO) {
        parseStatement(
            execute(
                session.endpoint.baseUrl,
                "/api/miniapp/boss/reconciliation-statements/$statementId/undo-paid",
                "POST",
                session.token,
                JSONObject()
            ).getJSONObject("statement")
        )
    }

    suspend fun getOwnPerformance(session: Session, dateFrom: String = "", dateTo: String = ""): WorkerPerformance = withContext(Dispatchers.IO) {
        val query = listOfNotNull(
            dateFrom.takeIf { it.isNotBlank() }?.let { "dateFrom=$it" },
            dateTo.takeIf { it.isNotBlank() }?.let { "dateTo=$it" }
        ).joinToString("&")
        val path = "/api/miniapp/me/performance${if (query.isBlank()) "" else "?$query"}"
        val json = execute(session.endpoint.baseUrl, path, token = session.token)
        val worker = json.optJSONObject("worker") ?: JSONObject()
        val summary = json.optJSONObject("summary") ?: JSONObject()
        val totalHours = summary.optDouble("totalHours")
        val completedPieces = summary.optInt("completedPieces")
        WorkerPerformance(
            workerName = worker.optString("displayName"),
            workerType = worker.optString("workerType"),
            completedOrders = summary.optInt("completedOrders"),
            completedPieces = completedPieces,
            totalHours = totalHours,
            averageHoursPerPiece = summary.optDouble("averageHoursPerPiece"),
            hourlyOutput = summary.optDoubleOrNull("hourlyOutput")
                ?: if (totalHours > 0) completedPieces / totalHours else 0.0,
            averageQualityScore = summary.optDoubleOrNull("averageQualityScore"),
            unratedOrders = summary.optInt("unratedOrders"),
            checkedPieces = summary.optInt("checkedPieces"),
            complaintOrders = summary.optInt("complaintOrders"),
            complaintRate = summary.optDoubleOrNull("complaintRate") ?: 0.0,
            records = json.optJSONArray("records")?.mapObjects {
                WorkerPerformanceRecord(
                    orderId = it.optString("orderId"),
                    scanRecordId = it.optString("scanRecordId"),
                    styleNo = it.optString("styleNo"),
                    styleName = it.optString("styleName"),
                    completedAt = it.optString("completedAt"),
                    pieces = it.optInt("pieces"),
                    workHours = it.optDouble("workHours"),
                    qualityScore = it.optDoubleOrNull("qualityScore"),
                    complaintCount = it.optInt("complaintCount")
                )
            }.orEmpty()
        )
    }

    suspend fun listQcPerformanceRecords(
        session: Session,
        dateFrom: String = "",
        dateTo: String = ""
    ): List<QcPerformanceRecord> = withContext(Dispatchers.IO) {
        val query = listOfNotNull(
            dateFrom.takeIf { it.isNotBlank() }?.let { "dateFrom=$it" },
            dateTo.takeIf { it.isNotBlank() }?.let { "dateTo=$it" }
        ).joinToString("&").let { if (it.isBlank()) "" else "?$it" }
        parseQcRecords(execute(
            session.endpoint.baseUrl,
            "/api/qc/me/completed-orders$query",
            token = session.token
        )).sortedByDescending(QcPerformanceRecord::eventTime)
    }

    suspend fun getQcRecordDetail(session: Session, orderId: String): QcRecordDetail = withContext(Dispatchers.IO) {
        val order = execute(
            session.endpoint.baseUrl,
            "/api/qc/me/orders/$orderId",
            token = session.token
        ).getJSONObject("order")
        val reworkPhotoIds = order.optJSONObject("latestRework")
            ?.optJSONArray("photos")
            ?.mapObjects { it.optString("id") }
            .orEmpty()
            .toSet()
        QcRecordDetail(
            record = parseQcRecord(order),
            photos = order.optJSONArray("attachments")?.mapObjects { parseQcRecordPhoto(it, orderId) }
                .orEmpty()
                .filterNot { it.category == "qc_issue_photo" || it.id in reworkPhotoIds }
                .sortedByDescending(QcRecordPhoto::createdAt)
        )
    }

    suspend fun addQcRecordPhotos(session: Session, orderId: String, uploads: List<UploadPayload>): List<QcRecordPhoto> =
        withContext(Dispatchers.IO) {
            val json = uploadMultipartMany(
                session,
                "/api/qc/me/orders/$orderId/photos",
                uploads,
                mapOf(
                    "attachmentMetadata" to JSONArray(
                        uploads.map { upload ->
                            JSONObject().put("category", upload.category ?: "qc_sample_photo")
                        }
                    ).toString()
                )
            )
            json.optJSONArray("attachments")?.mapObjects { parseQcRecordPhoto(it, orderId) }.orEmpty()
        }

    suspend fun updateQcRecordPhoto(
        session: Session,
        orderId: String,
        photoId: String,
        displayName: String,
        category: String
    ): List<QcRecordPhoto> = withContext(Dispatchers.IO) {
        val json = execute(
            session.endpoint.baseUrl,
            "/api/qc/me/orders/$orderId/photos/$photoId",
            "PATCH",
            session.token,
            JSONObject().put("displayName", displayName.trim()).put("category", category)
        )
        json.optJSONArray("attachments")?.mapObjects { parseQcRecordPhoto(it, orderId) }.orEmpty()
    }

    suspend fun deleteQcRecordPhoto(session: Session, orderId: String, photoId: String): List<QcRecordPhoto> =
        withContext(Dispatchers.IO) {
            val json = execute(
                session.endpoint.baseUrl,
                "/api/qc/me/orders/$orderId/photos/$photoId",
                "DELETE",
                session.token
            )
            json.optJSONArray("attachments")?.mapObjects { parseQcRecordPhoto(it, orderId) }.orEmpty()
        }

    suspend fun downloadQcRecordPhoto(session: Session, orderId: String, photoId: String): ByteArray =
        withContext(Dispatchers.IO) {
            client.newCall(
                Request.Builder()
                    .url("${session.endpoint.baseUrl.trimEnd('/')}/api/qc/me/orders/$orderId/photos/$photoId/download")
                    .header("Authorization", "Bearer ${session.token}")
                    .build()
            ).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("照片读取失败（${response.code}）")
                response.body?.bytes() ?: throw IllegalStateException("照片内容为空")
            }
        }

    private fun parseQcRecords(json: JSONObject): List<QcPerformanceRecord> =
        json.optJSONArray("orders")?.mapObjects { item ->
            parseQcRecord(item)
        }.orEmpty()

    private fun parseQcRecord(item: JSONObject) = QcPerformanceRecord(
        orderId = item.optString("orderId"),
        styleNo = item.optString("styleNo"),
        styleName = item.optString("styleName"),
        status = item.optString("qualityResult"),
        quantity = item.optInt("quantity"),
        score = item.optDoubleOrNull("qualityScore"),
        eventTime = item.optString("eventTime"),
        thumbnailUrl = item.optString("thumbnailUrl"),
        sampleType = item.optString("sampleType"),
        reworkReason = item.optString("note")
    )

    private fun parseQcRecordPhoto(item: JSONObject, orderId: String) = QcRecordPhoto(
        id = item.optString("id"),
        fileName = item.optString("fileName"),
        mimeType = item.optString("mimeType"),
        category = item.optString("category", "qc_sample_photo"),
        createdAt = item.optString("createdAt"),
        previewUrl = "/api/qc/me/orders/$orderId/photos/${item.optString("id")}/download",
        canRename = item.optBoolean("canRename", true),
        canDelete = item.optBoolean("canDelete", true)
    )

    suspend fun getAccountSecurity(session: Session): AccountSecurityProfile = withContext(Dispatchers.IO) {
        parseAccountProfile(execute(session.endpoint.baseUrl, "/api/auth/account-security", token = session.token).getJSONObject("profile"))
    }

    suspend fun updateAccountSecurity(session: Session, username: String, displayName: String, phoneNumber: String, currentPassword: String): Pair<AccountSecurityProfile, Boolean> =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("displayName", displayName.trim()).put("phoneNumber", phoneNumber.trim())
            if (session.identity.accountType == "business") body.put("username", username.trim())
            if (currentPassword.isNotBlank()) body.put("currentPassword", currentPassword)
            val response = execute(session.endpoint.baseUrl, "/api/auth/account-security/profile", "POST", session.token, body)
            parseAccountProfile(response.getJSONObject("profile")) to response.optBoolean("signedOut")
        }

    suspend fun changePassword(session: Session, currentPassword: String, newPassword: String, confirmPassword: String) = withContext(Dispatchers.IO) {
        execute(session.endpoint.baseUrl, "/api/auth/change-password", "POST", session.token,
            JSONObject().put("currentPassword", currentPassword).put("newPassword", newPassword).put("confirmPassword", confirmPassword))
    }

    private fun execute(
        baseUrl: String,
        path: String,
        method: String = "GET",
        token: String? = null,
        body: JSONObject? = null
    ): JSONObject {
        val builder = Request.Builder().url("${baseUrl.trimEnd('/')}$path")
        token?.let { builder.header("Authorization", "Bearer $it") }
        val requestBody = (body ?: JSONObject()).toString().toRequestBody(jsonMediaType)
        when (method) {
            "POST" -> builder.post(requestBody)
            "PUT" -> builder.put(requestBody)
            "PATCH" -> builder.patch(requestBody)
            "DELETE" -> builder.delete()
        }
        return executeRequest(builder.build())
    }

    private fun parseAttachments(json: JSONObject): List<MobileAttachment> =
        json.optJSONArray("attachments")?.mapObjects { attachment ->
            MobileAttachment(
                id = attachment.optString("id"),
                orderId = attachment.optString("orderId"),
                fileName = attachment.optString("fileName"),
                mimeType = attachment.optString("mimeType"),
                category = attachment.optString("category"),
                uploadedByName = attachment.optString("uploadedByName"),
                uploadedByRole = attachment.optString("uploadedByRole"),
                createdAt = attachment.optString("createdAt"),
                size = attachment.optLong("size"),
                visibility = attachment.optString("visibility", "internal_only"),
                orderChargeId = attachment.optString("orderChargeId"),
                hasFile = attachment.optBoolean("hasFile", true),
                canRename = attachment.optBoolean("canRename"),
                canDelete = attachment.optBoolean("canDelete")
            )
        }.orEmpty()

    private fun parseBossPricingRow(json: JSONObject): BossPricingRow {
        val order = json.optJSONObject("order") ?: JSONObject()
        val summary = json.optJSONObject("summary") ?: JSONObject()
        return BossPricingRow(
            order = parseOrder(order),
            receivableTotal = summary.optDouble("receivableTotal"),
            customerQuoteSubtotal = summary.optDouble("customerQuoteSubtotal"),
            confirmedOtherChargeTotal = summary.optDouble("confirmedOtherChargeTotal"),
            internalTotalCost = summary.optDouble("internalTotalCost"),
            quotationStatus = summary.optString("quotationStatus"),
            quotationChanged = json.optBoolean("quotationHasUnconfirmedChanges"),
            eligible = json.optJSONObject("reconciliationEligibility")?.optBoolean("eligible") == true,
            tasks = json.optJSONArray("orderTasks")?.mapObjects { it.optString("label") }.orEmpty()
        )
    }

    private fun parseBossPricingDetail(json: JSONObject): BossPricingDetail {
        val pricing = json.optJSONObject("pricing")
        return BossPricingDetail(
            row = parseBossPricingRow(json),
            customerCharges = pricing?.optJSONArray("customerChargeItems")
                ?.mapObjects(::parseCustomerCharge)
                ?.filter { it.id.isNotBlank() && it.archivedAt.isBlank() }
                .orEmpty(),
            internalCosts = pricing?.optJSONArray("internalCostItems")
                ?.mapObjects(::parseInternalCost)
                ?.filter { it.id.isNotBlank() && it.archivedAt.isBlank() }
                .orEmpty(),
            recommendationsInitialized = !pricing?.optString("recommendationsInitializedAt").isNullOrBlank(),
            hasConfirmedQuotation = json.optJSONObject("confirmedQuotation") != null
        )
    }

    private fun parseCustomerCharge(json: JSONObject) = BossCustomerChargeItem(
        id = json.optString("id"),
        name = json.optString("name"),
        pricingMethod = json.optString("pricingMethod", "fixed"),
        unitPrice = json.optDoubleOrNull("unitPrice"),
        quantity = json.optDoubleOrNull("quantity"),
        amount = json.optDouble("amount"),
        sourceType = json.optString("sourceType", "manual"),
        sourceTask = json.optString("sourceTask"),
        note = json.optString("note"),
        archivedAt = json.optString("archivedAt")
    )

    private fun parseInternalCost(json: JSONObject) = BossInternalCostItem(
        id = json.optString("id"),
        name = json.optString("name"),
        category = json.optString("category", "other"),
        amount = json.optDouble("amount"),
        sourceType = json.optString("sourceType", "manual"),
        sourceTask = json.optString("sourceTask"),
        note = json.optString("note"),
        archivedAt = json.optString("archivedAt")
    )

    private fun parseBossOrderCharge(json: JSONObject) = BossOrderCharge(
        id = json.optString("id"),
        name = json.optString("name"),
        amount = json.optDouble("amount"),
        creatorName = json.optString("creatorName"),
        creatorRole = json.optString("creatorRole"),
        status = json.optString("status"),
        archivedAt = json.optString("archivedAt"),
        createdAt = json.optString("createdAt")
    )

    private fun parseStatement(json: JSONObject) = ReconciliationStatement(
        id = json.optString("id"),
        statementNo = json.optString("statementNo"),
        customerName = json.optString("customerName"),
        salespersonName = json.optString("salespersonName"),
        billingPeriod = json.optString("billingPeriod"),
        orderCount = json.optInt("orderCount"),
        receivableAmount = json.optDouble("receivableAmount"),
        paidAmount = json.optDouble("paidAmount"),
        status = json.optString("status"),
        generatedAt = json.optString("generatedAt"),
        items = json.optJSONArray("items")?.mapObjects {
            StatementItem(
                id = it.optString("id"), orderId = it.optString("orderId"),
                orderNo = it.optString("orderNo"),
                styleNo = it.optString("styleNo"), styleName = it.optString("styleName"),
                customerName = it.optString("customerName"), salespersonName = it.optString("salespersonName"),
                quantity = it.optInt("quantity"),
                sampleAmount = it.optDouble("sampleAmount"),
                patternFeeTotal = it.optDouble("patternFeeTotal", it.optDouble("customerPatternFee")),
                otherChargeTotal = it.optDouble("otherChargeTotal"),
                receivableTotal = it.optDouble("receivableTotal"), returnedAt = it.optString("returnedAt")
            )
        }.orEmpty()
    )

    private fun customerChargePayload(item: BossCustomerChargeItem) = JSONObject()
        .put("name", item.name)
        .put("pricingMethod", item.pricingMethod)
        .put("sourceTask", item.sourceTask)
        .put("note", item.note)
        .apply {
            if (item.pricingMethod == "unit_quantity") {
                put("unitPrice", item.unitPrice ?: 0.0)
                put("quantity", item.quantity ?: 0.0)
            } else {
                put("amount", item.amount)
            }
        }

    private fun internalCostPayload(item: BossInternalCostItem) = JSONObject()
        .put("name", item.name)
        .put("category", item.category)
        .put("amount", item.amount)
        .put("sourceTask", item.sourceTask)
        .put("note", item.note)

    private fun parseAccountProfile(json: JSONObject) = AccountSecurityProfile(
        accountType = json.optString("accountType"),
        username = json.optString("username"),
        phoneNumber = json.optString("phoneNumber"),
        displayName = json.optString("displayName"),
        roleLabel = json.optString("roleLabel")
    )

    private fun executeRequest(request: Request): JSONObject = client.newCall(request).execute().use { response ->
        val raw = response.body?.string().orEmpty()
        val json = runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
        if (!response.isSuccessful) {
            throw IllegalStateException(json.optString("error", json.optString("message", "API ${response.code}")))
        }
        json
    }

    private fun uploadMultipart(
        session: Session,
        path: String,
        upload: UploadPayload,
        fields: Map<String, String>
    ): JSONObject {
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
        fields.forEach { (key, value) -> multipart.addFormDataPart(key, value) }
        multipart.addFormDataPart(
            "files",
            upload.fileName,
            upload.bytes.toRequestBody(upload.mimeType.toMediaType())
        )
        return executeRequest(
            Request.Builder()
                .url("${session.endpoint.baseUrl.trimEnd('/')}$path")
                .header("Authorization", "Bearer ${session.token}")
                .post(multipart.build())
                .build()
        )
    }

    private fun uploadMultipartMany(
        session: Session,
        path: String,
        uploads: List<UploadPayload>,
        fields: Map<String, String>
    ): JSONObject {
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
        fields.forEach { (key, value) -> multipart.addFormDataPart(key, value) }
        uploads.forEach { upload ->
            multipart.addFormDataPart(
                "files",
                upload.fileName,
                upload.bytes.toRequestBody(upload.mimeType.toMediaType())
            )
        }
        return executeRequest(
            Request.Builder()
                .url("${session.endpoint.baseUrl.trimEnd('/')}$path")
                .header("Authorization", "Bearer ${session.token}")
                .post(multipart.build())
                .build()
        )
    }

    private fun parseReceiverScanChargeContext(json: JSONObject): ReceiverScanChargeContext {
        val orderJson = json.getJSONObject("order")
        val order = MobileOrder(
            id = orderJson.optString("id"),
            orderNo = orderJson.optString("orderNo"),
            styleNo = orderJson.optString("styleNo"),
            styleName = orderJson.optString("styleName"),
            customerName = orderJson.optString("customerName"),
            salespersonName = orderJson.optString("salespersonName"),
            quantity = orderJson.optInt("quantity"),
            deliveryDate = "",
            stageLabel = "",
            sampleType = "",
            sampleRound = "",
            remark = ""
        )
        return ReceiverScanChargeContext(
            order = order,
            chargeLocked = json.optBoolean("chargeLocked"),
            charges = json.optJSONArray("charges")?.mapObjects(::parseCharge).orEmpty()
        )
    }

    private fun parseCharge(charge: JSONObject) = ReceiverCharge(
        id = charge.optString("id"),
        orderId = charge.optString("orderId"),
        name = charge.optString("name"),
        amount = charge.optDouble("amount"),
        explanation = charge.optString("explanation"),
        creatorName = charge.optString("creatorName"),
        creatorRole = charge.optString("creatorRole"),
        createdAt = charge.optString("createdAt"),
        canRename = charge.optBoolean("canRename"),
        canVoid = charge.optBoolean("canVoid"),
        attachments = charge.optJSONArray("attachments")?.mapObjects { attachment ->
            ReceiverChargeAttachment(
                id = attachment.optString("id"),
                fileName = attachment.optString("fileName"),
                mimeType = attachment.optString("mimeType"),
                size = attachment.optLong("size"),
                visibility = attachment.optString("visibility", "internal_only"),
                canRename = attachment.optBoolean("canRename"),
                canDelete = attachment.optBoolean("canDelete")
            )
        }.orEmpty()
    )

    private fun parseIdentity(json: JSONObject) = AccountIdentity(
        accountId = json.optString("accountId", json.optString("id")),
        accountType = json.optString("accountType"),
        role = json.optString("role"),
        homeRoute = json.optString("homeRoute"),
        displayName = json.optString("displayName", json.optString("role")),
        activeWorkerProfileId = json.optNullableString("activeWorkerProfileId"),
        activeWorkerType = json.optNullableString("activeWorkerType"),
        mustChangePassword = json.optBoolean("mustChangePassword")
    )

    private fun parseOrder(json: JSONObject): MobileOrder {
        val tasks = json.optJSONArray("orderTasks")?.mapObjects {
            OrderTask(it.optString("label"), it.optBoolean("completed"))
        }.orEmpty()
        val patternTask = json.optJSONObject("patternTask")
        val activeWorker = json.optJSONObject("activeWorker")
        return MobileOrder(
            id = json.optString("id"),
            orderNo = json.optString("orderNo"),
            styleNo = json.optString("styleNo"),
            styleName = json.optString("styleName"),
            customerName = json.optString("customerName"),
            salespersonName = json.optString("salespersonName"),
            quantity = json.optInt("quantity"),
            deliveryDate = json.optString("deliveryDate"),
            stageLabel = json.optString("stageLabel", json.optString("stage")),
            sampleType = json.optString("sampleType"),
            sampleRound = json.optString("sampleRound"),
            remark = json.optString("remark"),
            createdAt = json.optString("createdAt"),
            fabricStatus = json.optString("fabricStatus"),
            trimStatus = json.optString("trimStatus"),
            sampleRequestItems = json.optJSONArray("sampleRequestItems")?.mapStrings().orEmpty(),
            completionStatus = json.optString("completionStatus"),
            tasks = tasks,
            stage = json.optString("stage"),
            patternTaskStatus = patternTask?.optString("status").orEmpty(),
            patternMakerName = patternTask?.optString("patternMakerName").orEmpty(),
            attachments = json.optJSONArray("attachments")?.mapObjects { attachment ->
                MobileAttachment(
                    id = attachment.optString("id"),
                    orderId = attachment.optString("orderId", json.optString("id")),
                    fileName = attachment.optString("fileName"),
                    mimeType = attachment.optString("mimeType"),
                    category = attachment.optString("category"),
                    uploadedByName = attachment.optString("uploadedByName"),
                    uploadedByRole = attachment.optString("uploadedByRole"),
                    createdAt = attachment.optString("createdAt"),
                    size = attachment.optLong("size"),
                    visibility = attachment.optString("visibility", "internal_only"),
                    orderChargeId = attachment.optString("orderChargeId"),
                    hasFile = attachment.optBoolean("hasFile", true),
                    canRename = attachment.optBoolean("canRename"),
                    canDelete = attachment.optBoolean("canDelete")
                )
            }.orEmpty(),
            deliverables = patternTask?.optJSONArray("deliverables")?.mapObjects { deliverable ->
                PlannerDeliverable(
                    id = deliverable.optString("id"),
                    fileName = deliverable.optString("fileName"),
                    type = deliverable.optString("type"),
                    version = deliverable.optString("version"),
                    uploadedByName = deliverable.optString("uploadedByName"),
                    createdAt = deliverable.optString("createdAt")
                )
            }.orEmpty(),
            scanRecords = json.optJSONArray("scanRecords")?.mapObjects { record ->
                PlannerScanRecord(
                    id = record.optString("id"),
                    stageLabel = record.optString("stageLabel", record.optString("stage")),
                    actionLabel = record.optString("actionLabel", record.optString("action")),
                    workerName = record.optString("workerName"),
                    eventTime = record.optString("eventTime", record.optString("createdAt")),
                    pieces = record.optIntOrNull("pieces"),
                    workHours = record.optDoubleOrNull("workHours"),
                    qualityResult = record.optString("qualityResult")
                )
            }.orEmpty(),
            activeWorkerName = activeWorker?.optString("workerName").orEmpty(),
            activeWorkerStartedAt = activeWorker?.optString("startedAt").orEmpty(),
            thumbnailAttachmentId = json.optString("thumbnailAttachmentId"),
            chargeCount = json.optInt("chargeCount")
        )
    }
}

private fun JSONObject.optNullableString(key: String): String? =
    optString(key).trim().takeIf { it.isNotEmpty() }

private fun <T> JSONArray.mapObjects(mapper: (JSONObject) -> T): List<T> =
    (0 until length()).map { mapper(getJSONObject(it)) }

private fun JSONArray.mapStrings(): List<String> =
    (0 until length()).map { getString(it) }

private fun JSONObject.optIntOrNull(key: String): Int? =
    if (has(key) && !isNull(key)) optInt(key) else null

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (has(key) && !isNull(key)) optDouble(key).takeIf(Double::isFinite) else null

internal fun loginPayloadKey(loginId: String): String =
    if (Regex("^1[3-9]\\d{9}$").matches(loginId.trim())) "phoneNumber" else "username"
