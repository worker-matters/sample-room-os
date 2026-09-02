package com.sampleroom.mobile.data

const val MAX_MATERIAL_RECORD_FILE_NAME_LENGTH = 120

private val invalidFileNameCharacterPattern = Regex("""[\\/:*?"<>|\u0000-\u001F]""")

data class MaterialRecordFileNameParts(
    val baseName: String,
    val extension: String
)

fun splitMaterialRecordFileName(fileName: String): MaterialRecordFileNameParts {
    val dotIndex = fileName.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex == fileName.lastIndex) {
        return MaterialRecordFileNameParts(fileName, "")
    }

    return MaterialRecordFileNameParts(
        baseName = fileName.substring(0, dotIndex),
        extension = fileName.substring(dotIndex)
    )
}

fun validateMaterialRecordFileName(baseName: String, extension: String): String? {
    val normalizedBaseName = baseName.trim()
    return when {
        normalizedBaseName.isEmpty() -> "文件名不能为空。"
        normalizedBaseName == "." || normalizedBaseName == ".." -> "文件名不能使用路径符号。"
        invalidFileNameCharacterPattern.containsMatchIn(normalizedBaseName) ->
            "文件名不能包含 /、\\、:、*、?、\"、<、> 或 |。"
        extension.isEmpty() && normalizedBaseName.contains('.') ->
            "原文件没有扩展名，文件名主体不能包含英文句点。"
        normalizedBaseName.length + extension.length > MAX_MATERIAL_RECORD_FILE_NAME_LENGTH ->
            "文件名不能超过 $MAX_MATERIAL_RECORD_FILE_NAME_LENGTH 个字符（含扩展名）。"
        else -> null
    }
}

fun renameMaterialRecordUpload(upload: UploadPayload, baseName: String): UploadPayload {
    val extension = splitMaterialRecordFileName(upload.fileName).extension
    val error = validateMaterialRecordFileName(baseName, extension)
    require(error == null) { error ?: "文件名不合法。" }
    return upload.copy(fileName = "${baseName.trim()}$extension")
}
