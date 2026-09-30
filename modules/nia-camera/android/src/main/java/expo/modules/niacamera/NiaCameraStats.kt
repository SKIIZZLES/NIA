package expo.modules.niacamera

import android.util.Log

/**
 * Mesures du spike (A1, jalon 1), publiées chaque seconde dans logcat
 * (tag NiaCamera) et vers l'écran de test.
 */
internal class NiaCameraStats {
  private var windowStartMs = 0L
  private var rendered = 0
  private var exact = 0
  private var neighbor = 0
  private var hold = 0
  private var cover = 0
  private var latencySumMs = 0.0
  private var latencyMaxMs = 0.0
  private var latencyCount = 0

  private var analyzed = 0
  private var withFace = 0
  private var detectSumMs = 0.0
  private var detectMaxMs = 0.0
  private var analysisSumMs = 0.0

  private var syncOk = 0
  private var syncMissed = 0

  // Diagnostic (test sur téléphone).
  private var rawDetections = 0
  private var bestScore = 0f
  private var lumaSum = 0L
  private var lumaRangeSum = 0L
  private var lastInfo: FaceAnalyzer.Info? = null
  private var drawSumMs = 0.0
  private var drawMaxMs = 0.0
  private var drawCount = 0
  private var redrawSkipped = 0
  private var glWaitSumMs = 0.0
  private var glWaitCount = 0
  private var frameWidth = 0
  private var frameHeight = 0
  private var frameRotation = 0

  // Repères (jalon 2) et décomposition de la latence.
  private var landmarkRuns = 0
  private var landmarkSumMs = 0.0
  private var landmarkMaxMs = 0.0
  private var landmarkFrames = 0
  private var fallbackFaces = 0
  private var landmarkOnlyFaces = 0
  private var landmarkState = "off"
  private var queueSumMs = 0.0
  private var queueCount = 0
  private var prepSumMs = 0.0

  /** État du flux d'aperçu (PreviewView) : "streaming", "idle"… */
  @Volatile
  var previewState: String = "idle"

  /** Taille réelle de la vue d'aperçu (px), 0 si pas encore posée. */
  @Volatile
  var previewViewSize: String = "0x0"

  /** Base de temps des horodatages caméra, devinée à la première image. */
  private var clock: Int = CLOCK_UNKNOWN

  @Synchronized
  fun onRendered(kind: FaceMaskPolicy.Kind, frameTs: Long, realtimeNs: Long, monoNs: Long) {
    rendered++
    when (kind) {
      FaceMaskPolicy.Kind.EXACT -> exact++
      FaceMaskPolicy.Kind.NEIGHBOR -> neighbor++
      FaceMaskPolicy.Kind.HOLD -> hold++
      FaceMaskPolicy.Kind.COVER -> cover++
    }
    if (clock == CLOCK_UNKNOWN) {
      clock = when {
        realtimeNs - frameTs in 0..MAX_PLAUSIBLE_NS -> CLOCK_REALTIME
        monoNs - frameTs in 0..MAX_PLAUSIBLE_NS -> CLOCK_MONOTONIC
        else -> CLOCK_NONE
      }
    }
    val now = when (clock) {
      CLOCK_REALTIME -> realtimeNs
      CLOCK_MONOTONIC -> monoNs
      else -> return
    }
    val ms = (now - frameTs) / 1e6
    if (ms in 0.0..5000.0) {
      latencySumMs += ms
      latencyCount++
      if (ms > latencyMaxMs) latencyMaxMs = ms
    }
  }

  @Synchronized
  fun onAnalyzed(info: FaceAnalyzer.Info) {
    analyzed++
    if (info.faceCount > 0) withFace++
    detectSumMs += info.detectMs
    analysisSumMs += info.totalMs
    if (info.detectMs > detectMaxMs) detectMaxMs = info.detectMs.toDouble()
    rawDetections += info.rawCount
    if (info.bestScore > bestScore) bestScore = info.bestScore
    lumaSum += info.lumaMean
    lumaRangeSum += info.lumaRange
    lastInfo = info
    prepSumMs += info.prepMs
    landmarkState = info.landmarkState
    if (info.landmarksWanted && info.landmarkMs > 0f) {
      landmarkRuns++
      landmarkSumMs += info.landmarkMs
      if (info.landmarkMs > landmarkMaxMs) landmarkMaxMs = info.landmarkMs.toDouble()
    }
    if (info.landmarkFaces > 0) landmarkFrames++
    fallbackFaces += info.fallbackFaces
    landmarkOnlyFaces += info.landmarkOnlyFaces
    // Capture → début d'analyse (même base de temps que la latence).
    val start = when (clock) {
      CLOCK_REALTIME -> info.startRealtimeNs
      CLOCK_MONOTONIC -> info.startMonoNs
      else -> 0L
    }
    if (start > 0L) {
      val ms = (start - info.timestampNs) / 1e6
      if (ms in 0.0..5000.0) {
        queueSumMs += ms
        queueCount++
      }
    }
  }

  /** Temps passé à dessiner le masque (fil GL, canevas logiciel). */
  @Synchronized
  fun onDrawCost(ms: Double, skipped: Boolean, width: Int, height: Int, rotation: Int) {
    if (skipped) {
      redrawSkipped++
    } else {
      drawSumMs += ms
      drawCount++
      if (ms > drawMaxMs) drawMaxMs = ms
    }
    frameWidth = width
    frameHeight = height
    frameRotation = rotation
  }

  /** Délai entre la fin d'une analyse et le dessin de son image. */
  @Synchronized
  fun onGlWait(ms: Double) {
    glWaitSumMs += ms
    glWaitCount++
  }

  @Synchronized
  fun onSync(ok: Boolean) {
    if (ok) syncOk++ else syncMissed++
  }

  /** Renvoie les mesures de la dernière fenêtre, ou null si < 1 s. */
  @Synchronized
  fun flush(nowMs: Long, mode: String, effect: String): Map<String, Any>? {
    if (windowStartMs == 0L) {
      windowStartMs = nowMs
      return null
    }
    val span = nowMs - windowStartMs
    if (span < 1000) return null
    val sec = span / 1000.0
    val out = mapOf(
      "renderFps" to round1(rendered / sec),
      "analysisFps" to round1(analyzed / sec),
      "detectMsAvg" to round1(if (analyzed > 0) detectSumMs / analyzed else 0.0),
      "detectMsMax" to round1(detectMaxMs),
      "analysisMsAvg" to round1(if (analyzed > 0) analysisSumMs / analyzed else 0.0),
      "latencyMsAvg" to round1(if (latencyCount > 0) latencySumMs / latencyCount else -1.0),
      "latencyMsMax" to round1(if (latencyCount > 0) latencyMaxMs else -1.0),
      "exact" to exact,
      "neighbor" to neighbor,
      "hold" to hold,
      "cover" to cover,
      "faceRatio" to round1(if (analyzed > 0) withFace * 100.0 / analyzed else 0.0),
      "syncOk" to syncOk,
      "syncMissed" to syncMissed,
      "clock" to when (clock) {
        CLOCK_REALTIME -> "realtime"
        CLOCK_MONOTONIC -> "monotonic"
        CLOCK_NONE -> "none"
        else -> "unknown"
      },
      "mode" to mode,
      "effect" to effect,
      "analysisWidth" to (lastInfo?.width ?: 0),
      "analysisHeight" to (lastInfo?.height ?: 0),
      "analysisRotation" to (lastInfo?.rotation ?: 0),
      "rotationOffset" to (lastInfo?.rotationOffset ?: 0),
      "lumaMean" to (if (analyzed > 0) (lumaSum / analyzed).toInt() else -1),
      "lumaRange" to (if (analyzed > 0) (lumaRangeSum / analyzed).toInt() else -1),
      "rawDetections" to rawDetections,
      "bestScore" to round2(bestScore.toDouble()),
      "drawMsAvg" to round1(if (drawCount > 0) drawSumMs / drawCount else 0.0),
      "drawMsMax" to round1(drawMaxMs),
      "redrawSkipped" to redrawSkipped,
      "glWaitMsAvg" to round1(if (glWaitCount > 0) glWaitSumMs / glWaitCount else -1.0),
      "frameWidth" to frameWidth,
      "frameHeight" to frameHeight,
      "frameRotation" to frameRotation,
      "previewState" to previewState,
      "previewViewSize" to previewViewSize,
      "sourceWidth" to (lastInfo?.sourceWidth ?: 0),
      "sourceHeight" to (lastInfo?.sourceHeight ?: 0),
      "prepMsAvg" to round1(if (analyzed > 0) prepSumMs / analyzed else 0.0),
      "cameraToAnalysisMsAvg" to round1(if (queueCount > 0) queueSumMs / queueCount else -1.0),
      "landmarkState" to landmarkState,
      "landmarkMsAvg" to round1(if (landmarkRuns > 0) landmarkSumMs / landmarkRuns else 0.0),
      "landmarkMsMax" to round1(landmarkMaxMs),
      "landmarkFrames" to landmarkFrames,
      "fallbackFaces" to fallbackFaces,
      "landmarkOnlyFaces" to landmarkOnlyFaces,
    )
    Log.i(
      TAG,
      "stats render=${out["renderFps"]}fps analysis=${out["analysisFps"]}fps " +
        "detect=${out["detectMsAvg"]}/${out["detectMsMax"]}ms analysis=${out["analysisMsAvg"]}ms " +
        "latency=${out["latencyMsAvg"]}/${out["latencyMsMax"]}ms " +
        "exact=$exact neighbor=$neighbor hold=$hold cover=$cover face=${out["faceRatio"]}% " +
        "sync=$syncOk/$syncMissed clock=${out["clock"]} mode=$mode effect=$effect " +
        "analyse=${out["analysisWidth"]}x${out["analysisHeight"]} rot=${out["analysisRotation"]}+${out["rotationOffset"]} " +
        "luma=${out["lumaMean"]}±${out["lumaRange"]} brut=$rawDetections score=${out["bestScore"]} " +
        "dessin=${out["drawMsAvg"]}/${out["drawMsMax"]}ms saut=$redrawSkipped attenteGL=${out["glWaitMsAvg"]}ms " +
        "cadre=${frameWidth}x$frameHeight apercu=$previewState vue=$previewViewSize " +
        "source=${out["sourceWidth"]}x${out["sourceHeight"]} prep=${out["prepMsAvg"]}ms " +
        "camera>analyse=${out["cameraToAnalysisMsAvg"]}ms reperes=$landmarkState " +
        "${out["landmarkMsAvg"]}/${out["landmarkMsMax"]}ms img=$landmarkFrames repli=$fallbackFaces seuls=$landmarkOnlyFaces",
    )
    windowStartMs = nowMs
    rendered = 0; exact = 0; neighbor = 0; hold = 0; cover = 0
    latencySumMs = 0.0; latencyMaxMs = 0.0; latencyCount = 0
    analyzed = 0; withFace = 0; detectSumMs = 0.0; detectMaxMs = 0.0; analysisSumMs = 0.0
    syncOk = 0; syncMissed = 0
    rawDetections = 0; bestScore = 0f; lumaSum = 0L; lumaRangeSum = 0L
    drawSumMs = 0.0; drawMaxMs = 0.0; drawCount = 0; redrawSkipped = 0
    glWaitSumMs = 0.0; glWaitCount = 0
    landmarkRuns = 0; landmarkSumMs = 0.0; landmarkMaxMs = 0.0; landmarkFrames = 0
    fallbackFaces = 0; landmarkOnlyFaces = 0; queueSumMs = 0.0; queueCount = 0; prepSumMs = 0.0
    return out
  }

  private fun round1(v: Double): Double = Math.round(v * 10.0) / 10.0
  private fun round2(v: Double): Double = Math.round(v * 100.0) / 100.0

  companion object {
    const val TAG = "NiaCamera"
    private const val CLOCK_UNKNOWN = 0
    private const val CLOCK_REALTIME = 1
    private const val CLOCK_MONOTONIC = 2
    private const val CLOCK_NONE = 3
    private const val MAX_PLAUSIBLE_NS = 2_000_000_000L
  }
}
