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
  private var live = 0
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
  private var landmarkTotalSumMs = 0.0
  private var landmarkSkipped = 0
  private var landmarkRejected = 0
  private var roiSideSum = 0L
  private var landmarkDelegate = "—"
  private var fallbackFaces = 0
  // Jalon 2e : masques maintenus, écartés (couverture), taille du halo.
  private var heldMasks = 0
  private var uncoveredMasks = 0
  private var haloRatioSum = 0.0
  private var haloRatioCount = 0
  private var landmarkState = "off"
  // Rendu (jalon 2b) : âge des données posées sur chaque image.
  private var analysisAgeSumMs = 0.0
  private var analysisAgeCount = 0
  private var landmarkAgeSumMs = 0.0
  private var landmarkAgeCount = 0
  private var maskFrames = 0
  // Caméra : capteur → résultat de capture (pipeline HAL / ISP).
  private var halSumMs = 0.0
  private var halCount = 0
  private var queueSumMs = 0.0
  private var queueCount = 0
  private var prepSumMs = 0.0

  /** État du flux d'aperçu (PreviewView) : "streaming", "idle"… */
  @Volatile
  var previewState: String = "idle"

  /** Taille réelle de la vue d'aperçu (px), 0 si pas encore posée. */
  @Volatile
  var previewViewSize: String = "0x0"

  /** Base de temps des horodatages caméra (Camera2, sinon devinée). */
  private var clock: Int = CLOCK_UNKNOWN

  /** SENSOR_INFO_TIMESTAMP_SOURCE : "realtime" | "unknown" | "—". */
  @Volatile
  var timestampSource: String = "—"

  /** Base annoncée par Camera2 : REALTIME = elapsedRealtimeNanos, sinon System.nanoTime. */
  @Synchronized
  fun setTimestampSource(realtime: Boolean) {
    timestampSource = if (realtime) "realtime" else "unknown"
    clock = if (realtime) CLOCK_REALTIME else CLOCK_MONOTONIC
  }

  @Synchronized
  fun onRendered(
    kind: FaceMaskPolicy.Kind,
    frameTs: Long,
    realtimeNs: Long,
    monoNs: Long,
    analysisAgeNs: Long,
    masks: Int,
    landmarkAgeNs: Long,
    fallbacks: Int,
    held: Int = 0,
    uncovered: Int = 0,
    haloRatioSum: Double = 0.0,
  ) {
    rendered++
    when (kind) {
      FaceMaskPolicy.Kind.EXACT -> exact++
      FaceMaskPolicy.Kind.NEIGHBOR -> neighbor++
      FaceMaskPolicy.Kind.HOLD -> hold++
      FaceMaskPolicy.Kind.LIVE -> live++
      FaceMaskPolicy.Kind.COVER -> cover++
    }
    if (analysisAgeNs in 0..5_000_000_000L) {
      analysisAgeSumMs += analysisAgeNs / 1e6
      analysisAgeCount++
    }
    if (masks > 0) {
      maskFrames++
      if (landmarkAgeNs >= 0) {
        landmarkAgeSumMs += landmarkAgeNs / 1e6
        landmarkAgeCount++
      }
    }
    fallbackFaces += fallbacks
    heldMasks += held
    uncoveredMasks += uncovered
    if (masks > 0) {
      this.haloRatioSum += haloRatioSum
      haloRatioCount += masks
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
    if (info.landmarkSkipped) landmarkSkipped++
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

  /** Un passage de Face Landmarker (son fil). */
  @Synchronized
  fun onLandmarks(info: FaceAnalyzer.LandmarkInfo) {
    landmarkRuns++
    landmarkSumMs += info.inferMs
    landmarkTotalSumMs += info.totalMs
    if (info.inferMs > landmarkMaxMs) landmarkMaxMs = info.inferMs.toDouble()
    if (info.faces > 0) landmarkFrames++
    landmarkDelegate = info.delegate
    landmarkRejected += info.rejected
    roiSideSum += info.roiSide
  }

  /** Résultat de capture Camera2 reçu : capteur → fin du pipeline caméra. */
  @Synchronized
  fun onCaptureResult(sensorTs: Long, realtimeNs: Long, monoNs: Long) {
    val now = when (clock) {
      CLOCK_REALTIME -> realtimeNs
      CLOCK_MONOTONIC -> monoNs
      else -> return
    }
    val ms = (now - sensorTs) / 1e6
    if (ms in 0.0..5000.0) {
      halSumMs += ms
      halCount++
    }
  }

  /** Temps passé à dessiner le masque (fil GL, canevas logiciel). */
  @Synchronized
  fun onDrawCost(ms: Double, width: Int, height: Int, rotation: Int) {
    drawSumMs += ms
    drawCount++
    if (ms > drawMaxMs) drawMaxMs = ms
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
      "live" to live,
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
      "heldMasks" to heldMasks,
      "uncoveredMasks" to uncoveredMasks,
      "haloRatioAvg" to round2(if (haloRatioCount > 0) haloRatioSum / haloRatioCount else -1.0),
      "landmarkFps" to round1(landmarkRuns / sec),
      "landmarkTotalMsAvg" to round1(if (landmarkRuns > 0) landmarkTotalSumMs / landmarkRuns else 0.0),
      "landmarkSkipped" to landmarkSkipped,
      "landmarkRejected" to landmarkRejected,
      "landmarkRoiAvg" to (if (landmarkRuns > 0) (roiSideSum / landmarkRuns).toInt() else 0),
      "landmarkDelegate" to landmarkDelegate,
      "analysisAgeMsAvg" to round1(if (analysisAgeCount > 0) analysisAgeSumMs / analysisAgeCount else -1.0),
      "landmarkAgeMsAvg" to round1(if (landmarkAgeCount > 0) landmarkAgeSumMs / landmarkAgeCount else -1.0),
      "maskFrames" to maskFrames,
      "cameraPipelineMsAvg" to round1(if (halCount > 0) halSumMs / halCount else -1.0),
      "timestampSource" to timestampSource,
    )
    Log.i(
      TAG,
      "stats render=${out["renderFps"]}fps analysis=${out["analysisFps"]}fps " +
        "detect=${out["detectMsAvg"]}/${out["detectMsMax"]}ms analysis=${out["analysisMsAvg"]}ms " +
        "latency=${out["latencyMsAvg"]}/${out["latencyMsMax"]}ms " +
        "exact=$exact neighbor=$neighbor hold=$hold live=$live cover=$cover face=${out["faceRatio"]}% " +
        "sync=$syncOk/$syncMissed clock=${out["clock"]} mode=$mode effect=$effect " +
        "analyse=${out["analysisWidth"]}x${out["analysisHeight"]} rot=${out["analysisRotation"]}+${out["rotationOffset"]} " +
        "luma=${out["lumaMean"]}±${out["lumaRange"]} brut=$rawDetections score=${out["bestScore"]} " +
        "dessin=${out["drawMsAvg"]}/${out["drawMsMax"]}ms attenteGL=${out["glWaitMsAvg"]}ms " +
        "cadre=${frameWidth}x$frameHeight apercu=$previewState vue=$previewViewSize " +
        "source=${out["sourceWidth"]}x${out["sourceHeight"]} prep=${out["prepMsAvg"]}ms " +
        "camera>analyse=${out["cameraToAnalysisMsAvg"]}ms reperes=$landmarkState " +
        "${out["landmarkMsAvg"]}/${out["landmarkMsMax"]}ms ${out["landmarkFps"]}i/s $landmarkDelegate img=$landmarkFrames " +
        "sautees=$landmarkSkipped rejetes=$landmarkRejected roi=${out["landmarkRoiAvg"]}px repli=$fallbackFaces maintenus=$heldMasks noncouverts=$uncoveredMasks halo=${out["haloRatioAvg"]} age=${out["analysisAgeMsAvg"]}/${out["landmarkAgeMsAvg"]}ms " +
        "masques=$maskFrames capteur>resultat=${out["cameraPipelineMsAvg"]}ms horloge=$timestampSource",
    )
    windowStartMs = nowMs
    rendered = 0; exact = 0; neighbor = 0; hold = 0; live = 0; cover = 0
    latencySumMs = 0.0; latencyMaxMs = 0.0; latencyCount = 0
    analyzed = 0; withFace = 0; detectSumMs = 0.0; detectMaxMs = 0.0; analysisSumMs = 0.0
    syncOk = 0; syncMissed = 0
    rawDetections = 0; bestScore = 0f; lumaSum = 0L; lumaRangeSum = 0L
    drawSumMs = 0.0; drawMaxMs = 0.0; drawCount = 0
    glWaitSumMs = 0.0; glWaitCount = 0
    landmarkRuns = 0; landmarkSumMs = 0.0; landmarkMaxMs = 0.0; landmarkFrames = 0
    landmarkTotalSumMs = 0.0; landmarkSkipped = 0; landmarkRejected = 0; roiSideSum = 0L
    analysisAgeSumMs = 0.0; analysisAgeCount = 0; landmarkAgeSumMs = 0.0; landmarkAgeCount = 0; maskFrames = 0
    halSumMs = 0.0; halCount = 0
    heldMasks = 0; uncoveredMasks = 0; haloRatioSum = 0.0; haloRatioCount = 0
    fallbackFaces = 0; queueSumMs = 0.0; queueCount = 0; prepSumMs = 0.0
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
