package com.sampleroom.mobile.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiClientTest {
    @Test
    fun loginPostIsNotRetriedAfterFailure() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"unavailable"}"""))
        server.start()
        try {
            assertThrows(Exception::class.java) {
                runBlocking {
                    ApiClient().login(
                        SelectedEndpoint(server.url("/").toString().trimEnd('/'), ApiMode.PUBLIC),
                        "client@example.com",
                        "Password123"
                    )
                }
            }
            assertEquals(1, server.requestCount)
            assertEquals("POST", server.takeRequest().method)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun unifiedLoginInfersPhoneOrUsernameWithoutRoleSelection() {
        assertEquals("phoneNumber", loginPayloadKey("13800138000"))
        assertEquals("phoneNumber", loginPayloadKey(" 13900139000 "))
        assertEquals("username", loginPayloadKey("planner.zhang"))
        assertEquals("username", loginPayloadKey("12800128000"))
    }

    @Test
    fun unifiedLoginSendsTheInferredCredentialField() = runBlocking {
        val server = MockWebServer()
        val loginResponse = """{
            "token":"token","expiresAt":"2026-09-01T00:00:00Z",
            "user":{"accountId":"worker-1","accountType":"worker","role":"worker",
            "homeRoute":"/worker/home","displayName":"张师傅","activeWorkerProfileId":"profile-1",
            "activeWorkerType":"sewing"}}
        """.trimIndent()
        server.enqueue(MockResponse().setResponseCode(200).setBody(loginResponse))
        server.enqueue(MockResponse().setResponseCode(200).setBody(loginResponse))
        server.start()
        try {
            val endpoint = SelectedEndpoint(server.url("/").toString().trimEnd('/'), ApiMode.LAN)
            ApiClient().login(endpoint, "13800138000", "Password123")
            ApiClient().login(endpoint, "planner.zhang", "Password123")

            val phoneBody = server.takeRequest().body.readUtf8()
            val usernameBody = server.takeRequest().body.readUtf8()
            assertTrue(phoneBody.contains("\"phoneNumber\":\"13800138000\""))
            assertTrue(!phoneBody.contains("\"username\""))
            assertTrue(usernameBody.contains("\"username\":\"planner.zhang\""))
            assertTrue(!usernameBody.contains("\"phoneNumber\""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun qcScanParsesLatestReworkForTheClickablePendingState() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{
            "state":{
                "order":{"styleNo":"QC-9","styleName":"返工款","quantity":4,"customerName":"客户","salespersonName":"业务员"},
                "stage":"qc_delivery","stageLabel":"组检/出库","allowedAction":"complete","defaultPieces":4,
                "latestRework":{"note":"袖口跳线","eventTime":"2026-08-11T08:30:00Z","workerName":"李组检",
                    "photos":[{"id":"photo-1","fileName":"袖口.jpg","previewUrl":"/api/scan/scan-token/attachments/photo-1/download"}]}
            }
        }""".trimIndent()))
        server.start()
        try {
            val result = ApiClient().resolveOrder(
                workerSession(server),
                "SRS2|ORDER|scan-token"
            )
            assertEquals("袖口跳线", result.latestRework?.note)
            assertEquals("李组检", result.latestRework?.workerName)
            assertEquals("袖口.jpg", result.latestRework?.photos?.single()?.fileName)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun qcPerformanceOnlyIncludesCompletedRecords() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{
            "orders":[{"orderId":"done-1","styleNo":"OK-1","styleName":"合格款","quantity":2,
            "eventTime":"2026-08-11T10:00:00Z","qualityResult":"qualified","qualityScore":96,
            "thumbnailUrl":"/api/qc/me/orders/done-1/thumbnail"}]
        }""".trimIndent()))
        server.start()
        try {
            val records = ApiClient().listQcPerformanceRecords(workerSession(server), "2026-08-01", "2026-08-11")
            assertEquals(listOf("qualified"), records.map { it.status })
            assertEquals(96.0, records.first().score ?: 0.0, 0.0)
            assertTrue(server.takeRequest().path!!.startsWith("/api/qc/me/completed-orders?"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun sewingTaskDetailKeepsTheServerSampleType() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{
            "state":{
                "order":{"styleNo":"SEW-9","styleName":"缝制款","quantity":6,
                    "customerName":"客户","salespersonName":"业务员","sampleType":"revision_sample","sampleRound":"round_2"},
                "stage":"sewing","stageLabel":"缝制","allowedAction":"complete","defaultPieces":6
            }
        }""".trimIndent()))
        server.start()
        try {
            val result = ApiClient().getOwnSewingTask(workerSession(server), "order-sew-9")
            assertEquals("revision_sample", result.order.sampleType)
            assertEquals("round_2", result.order.sampleRound)
            assertEquals("sewing_task", result.entrySource)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun qcRecordPhotoAppendKeepsEachSelectedCategory() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"attachments":[]}"""))
        server.start()
        try {
            ApiClient().addQcRecordPhotos(
                workerSession(server),
                "order-qc-1",
                listOf(
                    UploadPayload("sample".toByteArray(), "样衣.jpg", "image/jpeg", "qc_sample_photo"),
                    UploadPayload("size".toByteArray(), "尺寸.jpg", "image/jpeg", "qc_measurement_photo")
                )
            )

            val request = server.takeRequest()
            val body = request.body.readUtf8()
            assertEquals("/api/qc/me/orders/order-qc-1/photos", request.path)
            assertTrue(body.contains("attachmentMetadata"))
            assertTrue(body.contains("qc_sample_photo"))
            assertTrue(body.contains("qc_measurement_photo"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun plannerCancellationReturnsTheLatestStateEvenAfterTheOrderBecomesSingle() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{
            "participation":{
                "orderId":"order-1","quantity":4,"participationId":"active-2","status":"cancelled",
                "sewingMode":"single","revision":"revision-2","plannedPieces":0,"unallocatedPieces":4,
                "completedPieces":4,"activeParticipantCount":0,"effectiveParticipantCount":1,
                "sewingGateSatisfied":true,
                "participants":[
                    {"id":"done-1","workerName":"缝制员工一号","joinedAt":"2026-08-29T14:00:00Z",
                     "status":"completed","completedPieces":4,"completedAt":"2026-08-29T14:16:00Z"},
                    {"id":"active-2","workerName":"缝制员工二号","joinedAt":"2026-08-29T14:17:00Z",
                     "status":"cancelled","cancelledAt":"2026-08-29T14:20:00Z"}
                ]
            }
        }""".trimIndent()))
        server.start()
        try {
            val result = PlannerCollaborationClient().cancelParticipation(
                receiverSession(server).copy(identity = receiverSession(server).identity.copy(role = "planner")),
                "order-1",
                "active-2",
                "revision-1"
            )
            assertEquals("single", result.sewingMode)
            assertEquals(0, result.collaboration.activeParticipantCount)
            assertEquals("completed", result.collaboration.participants.first().status)
            assertEquals("/api/planner/orders/order-1/sewing-collaboration/active-2/cancel", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    private fun receiverSession(server: MockWebServer) = Session(
        token = "session-token",
        expiresAt = "",
        identity = AccountIdentity(
            accountId = "receiver-account",
            accountType = "business",
            role = "receiver",
            homeRoute = "/receiver/home",
            displayName = "接单员测试账号"
        ),
        endpoint = SelectedEndpoint(server.url("/").toString().trimEnd('/'), ApiMode.LAN)
    )

    private fun workerSession(server: MockWebServer) = receiverSession(server).copy(
        identity = receiverSession(server).identity.copy(
            role = "worker",
            accountType = "worker",
            homeRoute = "/worker/home"
        )
    )

    @Test
    fun qcCompletionUploadsAllSelectedPhotosBeforeFinalConfirmation() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"batchId":"batch-1"}"""))
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"count":1,"maxFiles":10}"""))
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"count":2,"maxFiles":10}"""))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"state":{"order":{"styleNo":"QC-001","styleName":"样衣","customerName":"客户",
            "salespersonName":"业务员","quantity":2},"stageLabel":"生产完成","message":"完成",
            "allowedAction":"blocked","blockedReason":"done"}}
        """.trimIndent()))
        server.start()
        try {
            val current = ScanResult(
                token = "scan-token",
                order = MobileOrder(
                    id = "",
                    orderNo = "",
                    styleNo = "QC-001",
                    styleName = "样衣",
                    customerName = "客户",
                    salespersonName = "业务员",
                    quantity = 2,
                    deliveryDate = "",
                    stageLabel = "组检/出库",
                    sampleType = "",
                    sampleRound = "",
                    remark = ""
                ),
                currentStageLabel = "组检/出库",
                statusMessage = "",
                stage = "qc_delivery",
                allowedAction = "complete",
                blockedReason = null,
                defaultPieces = 2,
                activeTaskWorkerId = null,
                activeTaskWorkerName = null
            )
            val progress = mutableListOf<Pair<Int, Int>>()
            val completed = ApiClient().completeWorkerScan(
                workerSession(server),
                current,
                WorkerScanCompletion(
                    pieces = 2,
                    note = "",
                    qualityResult = "qualified",
                    qualityScore = 96,
                    photos = listOf(
                        UploadPayload("front".toByteArray(), "样衣正面.jpg", "image/jpeg", "qc_sample_photo"),
                        UploadPayload("back".toByteArray(), "尺寸表.jpg", "image/jpeg", "qc_measurement_photo")
                    )
                )
            ) { uploaded, total -> progress += uploaded to total }

            assertEquals("done", completed.blockedReason)
            assertEquals(listOf(1 to 2, 2 to 2), progress)
            val createBatch = server.takeRequest()
            val firstPhoto = server.takeRequest()
            val secondPhoto = server.takeRequest()
            val complete = server.takeRequest()
            assertEquals("/api/scan/scan-token/qc-evidence-batches", createBatch.path)
            assertEquals("/api/scan/scan-token/qc-evidence-batches/batch-1/files", firstPhoto.path)
            val firstPhotoBody = firstPhoto.body.readUtf8()
            assertTrue(firstPhotoBody.contains("样衣正面.jpg"))
            assertTrue(firstPhotoBody.contains("qc_sample_photo"))
            assertEquals("/api/scan/scan-token/qc-evidence-batches/batch-1/files", secondPhoto.path)
            val secondPhotoBody = secondPhoto.body.readUtf8()
            assertTrue(secondPhotoBody.contains("尺寸表.jpg"))
            assertTrue(secondPhotoBody.contains("qc_measurement_photo"))
            assertEquals("/api/scan/scan-token/complete", complete.path)
            assertTrue(complete.body.readUtf8().contains("qcEvidenceBatchId"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun materialRecordUploadUsesExistingAuthenticatedAttachmentEndpoint() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        server.start()
        try {
            val session = receiverSession(server)

            ApiClient().uploadReceiverMaterialRecord(
                session,
                "order-123",
                renameMaterialRecordUpload(
                    UploadPayload("image-bytes".toByteArray(), "camera-123.jpg", "image/jpeg"),
                    "蓝色主布到货记录"
                )
            )

            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/miniapp/receiver/orders/order-123/attachments", request.path)
            assertEquals("Bearer session-token", request.getHeader("Authorization"))
            val body = request.body.readUtf8()
            assertTrue(body.contains("receiver_material_record"))
            assertTrue(body.contains("internal_only"))
            assertTrue(body.contains("蓝色主布到货记录.jpg"))
            assertTrue(!body.contains("camera-123.jpg"))
        } finally {
            server.shutdown()
        }
    }

    private fun plannerSession(server: MockWebServer) = Session(
        token = "planner-session-token",
        expiresAt = "",
        identity = AccountIdentity(
            accountId = "planner-account",
            accountType = "business",
            role = "planner",
            homeRoute = "/planner/home",
            displayName = "计划员测试账号"
        ),
        endpoint = SelectedEndpoint(server.url("/").toString().trimEnd('/'), ApiMode.LAN)
    )

    @Test
    fun receiverOrderAndMaterialRecordFieldsComeFromExistingApis() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"orders":[{"id":"order-1","orderNo":"V2-0001","styleNo":"123","styleName":"样衣",
            "customerName":"客户 A","salespersonName":"业务员 A","quantity":1,"deliveryDate":"2026-07-27",
            "stage":"pattern_waiting","sampleType":"first_sample","sampleRound":"round_1","remark":"",
            "createdAt":"2026-07-21T08:00:00.000Z","fabricStatus":"missing","trimStatus":"partial",
            "sampleRequestItems":["sample_garment","cutting"],"completionStatus":"active"}]}
        """.trimIndent()))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"attachments":[{"id":"attachment-1","orderId":"order-1","fileName":"fabric.jpg",
            "mimeType":"image/jpeg","category":"receiver_material_record","uploadedByName":"接单员 A",
            "uploadedByRole":"receiver","createdAt":"2026-07-21T14:32:00.000Z"}]}
        """.trimIndent()))
        server.start()
        try {
            val session = receiverSession(server)
            val order = ApiClient().listOrders(session).single()
            val attachment = ApiClient().listReceiverAttachments(session, order.id).single()

            assertEquals("pattern_waiting", order.stageLabel)
            assertEquals("missing", order.fabricStatus)
            assertEquals(listOf("sample_garment", "cutting"), order.sampleRequestItems)
            assertEquals("receiver_material_record", attachment.category)
            assertEquals("接单员 A", attachment.uploadedByName)
            assertEquals("/api/miniapp/receiver/orders", server.takeRequest().path)
            assertEquals("/api/miniapp/receiver/orders/order-1/attachments", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun mobileAttachmentRenameUsesServerPermissionEndpointWithoutIdentityFields() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"attachments":[]}"""))
        server.start()
        try {
            ApiClient().renameAttachment(receiverSession(server), "order-1", "attachment-1", "新的面料记录.jpg")
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/miniapp/receiver/orders/order-1/attachments/attachment-1/display-name", request.path)
            val body = request.body.readUtf8()
            assertTrue(body.contains("displayName"))
            assertTrue(!body.contains("accountId"))
            assertTrue(!body.contains("role"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun bossPricingAndPerformanceUseSharedAuthoritativeMobileApis() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"rows":[]}"""))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
          {"worker":{"displayName":"缝制员工","workerType":"sewing"},
           "summary":{"completedOrders":2,"completedPieces":10,"totalHours":3.5,"averageHoursPerPiece":0.35,
             "hourlyOutput":2.857,"averageQualityScore":94.5,"unratedOrders":1},
           "records":[{"orderId":"order-1","scanRecordId":"scan-1","styleNo":"JK2026-018","styleName":"夹克样衣","completedAt":"2026-07-29T10:00:00.000Z",
             "pieces":10,"workHours":3.5,"qualityScore":94.5}]}
        """.trimIndent()))
        server.start()
        try {
            val boss = receiverSession(server).copy(identity = receiverSession(server).identity.copy(role = "boss"))
            ApiClient().listBossPricing(boss)
            val worker = receiverSession(server).copy(identity = receiverSession(server).identity.copy(role = "worker", accountType = "worker"))
            val performance = ApiClient().getOwnPerformance(worker, "2026-07-01", "2026-07-29")
            assertEquals(2, performance.completedOrders)
            assertEquals("JK2026-018", performance.records.single().styleNo)
            assertEquals("order-1", performance.records.single().orderId)
            assertEquals("scan-1", performance.records.single().scanRecordId)
            assertEquals(94.5, performance.averageQualityScore ?: 0.0, 0.001)
            assertEquals("/api/miniapp/boss/pricing/orders", server.takeRequest().path)
            assertEquals("/api/miniapp/me/performance?dateFrom=2026-07-01&dateTo=2026-07-29", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun bossPricingDetailPreservesFixedQuoteCostAndOtherChargeSemantics() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
          {"order":{"id":"order-1","orderNo":"V2-1","styleNo":"JK2026-018","styleName":"夹克样衣",
             "customerName":"Huffer","salespersonName":"James","quantity":2,"deliveryDate":"2026-08-10"},
           "summary":{"receivableTotal":550,"customerQuoteSubtotal":500,"confirmedOtherChargeTotal":50,
             "internalTotalCost":120,"quotationStatus":"draft"},
           "orderTasks":[{"key":"pattern","label":"制版"}],
           "quotationHasUnconfirmedChanges":false,
           "reconciliationEligibility":{"eligible":false,"reason":"quotation_not_confirmed"},
           "pricing":{"id":"pricing-1","quotationStatus":"draft","recommendationsInitializedAt":"2026-07-29",
             "customerChargeItems":[{"id":"customer-1","name":"版费","pricingMethod":"fixed","amount":500,"sourceType":"manual"}],
             "internalCostItems":[{"id":"internal-1","name":"版师成本","category":"pattern","amount":120,"sourceType":"manual"}]}}
        """.trimIndent()))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
          {"charges":[{"id":"other-1","name":"加急费","amount":50,"creatorName":"老板","creatorRole":"boss",
             "status":"confirmed","createdAt":"2026-07-29T08:00:00.000Z"}]}
        """.trimIndent()))
        server.start()
        try {
            val session = receiverSession(server).copy(identity = receiverSession(server).identity.copy(role = "boss"))
            val pricing = ApiClient().getBossPricing(session, "order-1")
            val charges = ApiClient().listBossOrderCharges(session, "order-1")

            assertEquals("版费", pricing.customerCharges.single().name)
            assertEquals("pattern", pricing.internalCosts.single().category)
            assertEquals(500.0, pricing.row.customerQuoteSubtotal, 0.001)
            assertEquals(50.0, pricing.row.confirmedOtherChargeTotal, 0.001)
            assertEquals("加急费", charges.single().name)
            assertEquals("/api/miniapp/boss/orders/order-1/pricing", server.takeRequest().path)
            assertEquals("/api/miniapp/boss/orders/order-1/charges", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun receiverQuickIntakeUsesExistingMiniappEndpointAndServerIdentity() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(201).setBody("""
            {"order":{"id":"order-quick","orderNo":"V2-QUICK","customerName":"客户 A",
            "salespersonName":"业务员 A","styleNo":"待校对","styleName":"","quantity":1,
            "deliveryDate":"2026-07-28","stage":"pending_receive","sampleType":"first_sample",
            "sampleRound":"round_1","createdAt":"2026-07-21T08:00:00.000Z",
            "fabricStatus":"missing","trimStatus":"missing","sampleRequestItems":[]}}
        """.trimIndent()))
        server.start()
        try {
            val result = ApiClient().createReceiverIntake(
                receiverSession(server),
                ReceiverIntakeDraft(
                    customerId = "customer-a",
                    clientUserId = "salesperson-a",
                    deliveryDate = "2026-07-28"
                ),
                listOf(UploadPayload("photo".toByteArray(), "sheet.jpg", "image/jpeg")),
                thumbnail = UploadPayload("thumb".toByteArray(), "thumbnail.jpg", "image/jpeg"),
                quick = true
            )
            assertEquals("order-quick", result.id)
            val request = server.takeRequest()
            assertEquals("/api/miniapp/receiver/quick-photo", request.path)
            assertEquals("Bearer session-token", request.getHeader("Authorization"))
            val body = request.body.readUtf8()
            assertTrue(body.contains("receiver_quick_photo"))
            assertTrue(body.contains("customer-a"))
            assertTrue(body.contains("sheet.jpg"))
            assertTrue(body.contains("thumbnail.jpg"))
            assertTrue(body.contains("thumbnailAttachmentIndex"))
            val thumbnailIndexPart = body
                .substringAfter("name=\"thumbnailAttachmentIndex\"")
                .substringBefore("--")
            assertTrue(thumbnailIndexPart.contains("\r\n\r\n1\r\n"))
            assertTrue(body.indexOf("sheet.jpg") < body.indexOf("thumbnail.jpg"))
            assertTrue(!body.contains("accountId"))
            assertTrue(!body.contains("role"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun receiverOrderChargesUseReadOnlyMiniappEndpoint() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"charges":[{"id":"charge-1","orderId":"order-1","name":"加急打样费","amount":200,
            "explanation":"客户要求加急","creatorName":"接单员甲","creatorRole":"receiver",
            "createdAt":"2026-07-21T14:32:00.000Z","attachments":[]}]}
        """.trimIndent()))
        server.start()
        try {
            val charge = ApiClient().listOrderCharges(receiverSession(server), "order-1").single()
            assertEquals("加急打样费", charge.name)
            assertEquals("2026-07-21T14:32:00.000Z", charge.createdAt)
            assertEquals("/api/miniapp/receiver/orders/order-1/charges", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun receiverScanChargeParsesOrderPayloadAndSendsOnlyTokenToExistingService() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"order":{"id":"order-1","orderNo":"V2-1","styleNo":"123","styleName":"样衣",
            "customerName":"客户 A","salespersonName":"业务员 A"},"chargeLocked":false,"charges":[]}
        """.trimIndent()))
        server.start()
        try {
            val context = ApiClient().resolveReceiverScanCharge(
                receiverSession(server),
                "SRS2|ORDER|order_scan_12345678"
            )
            assertEquals("order-1", context.order.id)
            val request = server.takeRequest()
            assertEquals("/api/miniapp/receiver/scan-charge/resolve", request.path)
            val body = request.body.readUtf8()
            assertTrue(body.contains("order_scan_12345678"))
            assertTrue(!body.contains("accountId"))
            assertTrue(!body.contains("role"))
        } finally {
            server.shutdown()
        }
    }


    @Test
    fun plannerOrdersUseExistingMiniappReadOnlyEndpoint() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"orders":[{"id":"order-1","orderNo":"V2-1","styleNo":"123","styleName":"样衣",
            "customerName":"客户 A","salespersonName":"业务员 A","quantity":1,
            "deliveryDate":"2026-07-28","stage":"sewing_waiting","stageLabel":"待缝制",
            "sampleType":"first_sample","sampleRound":"round_1","createdAt":"2026-07-21T08:00:00.000Z",
            "fabricStatus":"complete","trimStatus":"complete","sampleRequestItems":[],
            "attachments":[],"scanRecords":[]}]}
        """.trimIndent()))
        server.start()
        try {
            val order = ApiClient().listOrders(plannerSession(server)).single()
            assertEquals("sewing_waiting", order.stage)
            assertEquals("/api/miniapp/planner/orders", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun plannerScanChargeUsesPlannerEndpointWithoutClientDeclaredIdentity() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"order":{"id":"order-1","orderNo":"V2-1","styleNo":"123","styleName":"样衣",
            "customerName":"客户 A","salespersonName":"业务员 A"},"chargeLocked":false,"charges":[]}
        """.trimIndent()))
        server.start()
        try {
            ApiClient().resolvePlannerScanCharge(plannerSession(server), "SRS2|ORDER|order_scan_12345678")
            val request = server.takeRequest()
            assertEquals("/api/miniapp/planner/scan-charge/resolve", request.path)
            val body = request.body.readUtf8()
            assertTrue(body.contains("order_scan_12345678"))
            assertTrue(!body.contains("accountId"))
            assertTrue(!body.contains("role"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun qcReworkTaskBuildsAuthenticatedPhotoUrlWhenDetailDtoOmitsIt() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{
            "order":{
                "sampleType":"first_sample","thumbnailUrl":"/thumbnail",
                "state":{"order":{"styleNo":"QC-10","styleName":"复检款","quantity":1,
                    "customerName":"客户","salespersonName":"业务员"},"stage":"qc_delivery",
                    "stageLabel":"组检/出库","allowedAction":"complete","defaultPieces":1},
                "latestRework":{"note":"领口不平","eventTime":"2026-08-12T08:30:00Z","workerName":"李组检",
                    "photos":[{"id":"photo-2","fileName":"领口.jpg"}]}
            }
        }""".trimIndent()))
        server.start()
        try {
            val result = ApiClient().getQcReworkTask(workerSession(server), "order-qc-10")
            assertEquals(
                "/api/qc/me/orders/order-qc-10/photos/photo-2/download",
                result.latestRework?.photos?.single()?.previewUrl
            )
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun qcPerformanceDetailDoesNotExposeReworkIssuePhotos() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{
            "order":{"orderId":"done-2","styleNo":"QC-11","styleName":"完成款","quantity":1,
                "eventTime":"2026-08-12T09:00:00Z","qualityResult":"qualified","qualityScore":98,
                "attachments":[
                    {"id":"issue","fileName":"返工.jpg","mimeType":"image/jpeg","category":"qc_issue_photo"},
                    {"id":"legacy-issue","fileName":"旧返工.jpg","mimeType":"image/jpeg","category":"qc_sample_photo"},
                    {"id":"sample","fileName":"样衣.jpg","mimeType":"image/jpeg","category":"qc_sample_photo"}
                ],
                "latestRework":{"note":"旧返工","eventTime":"2026-08-12T08:00:00Z",
                    "photos":[{"id":"legacy-issue","fileName":"旧返工.jpg","mimeType":"image/jpeg","category":"qc_issue_photo"}]}}
        }""".trimIndent()))
        server.start()
        try {
            val detail = ApiClient().getQcRecordDetail(workerSession(server), "done-2")
            assertEquals(listOf("qc_sample_photo"), detail.photos.map { it.category })
            assertEquals(listOf("样衣.jpg"), detail.photos.map { it.fileName })
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun plannerOrderChargeUsesTheSelectedOrderWithoutAScanToken() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"chargeLocked":false,"charges":[]}
        """.trimIndent()))
        server.start()
        try {
            val order = MobileOrder(
                id = "order-1",
                orderNo = "V2-1",
                styleNo = "123",
                styleName = "样衣",
                customerName = "客户 A",
                salespersonName = "业务员 A",
                quantity = 1,
                deliveryDate = "2026-07-28",
                stageLabel = "待缝制",
                sampleType = "first_sample",
                sampleRound = "round_1",
                remark = ""
            )
            val context = ApiClient().getPlannerOrderChargeContext(plannerSession(server), order)
            assertEquals(order, context.order)
            assertEquals("/api/miniapp/planner/orders/order-1/charges", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun plannerCreatesChargeFromOrderListWithoutAScanToken() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(201).setBody("""
            {"charge":{"id":"charge-1","orderId":"order-1","name":"加急费","amount":18}}
        """.trimIndent()))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""
            {"chargeLocked":false,"charges":[{"id":"charge-1","orderId":"order-1",
            "name":"加急费","amount":18,"explanation":"赶交期","creatorName":"计划员",
            "creatorRole":"planner","createdAt":"2026-08-12T08:00:00.000Z",
            "canRename":true,"canVoid":true,"attachments":[]}]}
        """.trimIndent()))
        server.start()
        try {
            val order = MobileOrder(
                id = "order-1", orderNo = "V2-1", styleNo = "123", styleName = "样衣",
                customerName = "客户 A", salespersonName = "业务员 A", quantity = 1,
                deliveryDate = "2026-08-20", stageLabel = "待缝制",
                sampleType = "first_sample", sampleRound = "round_1", remark = ""
            )
            val context = ApiClient().createPlannerOrderCharge(
                plannerSession(server), order, "加急费", 18.0, "赶交期", emptyList()
            )
            val createRequest = server.takeRequest()
            assertEquals("POST", createRequest.method)
            assertEquals("/api/miniapp/planner/orders/order-1/charges", createRequest.path)
            val body = createRequest.body.readUtf8()
            assertTrue(body.contains("planner_mobile_order_list"))
            assertTrue(!body.contains("scan" + "Token"))
            assertEquals("/api/miniapp/planner/orders/order-1/charges", server.takeRequest().path)
            assertEquals("加急费", context.charges.single().name)
        } finally {
            server.shutdown()
        }
    }
}
