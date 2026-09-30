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
  fun onAnalyzed(faces: Int, detectMs: Float, totalMs: Float) {
    analyzed++
    if (faces > 0) withFace++
    detectSumMs += detectMs
    analysisSumMs += totalMs
    if (detectMs > detectMaxMs) detectMaxMs = detectMs.toDouble()
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
    )
    Log.i(
      TAG,
      "stats render=${out["renderFps"]}fps analysis=${out["analysisFps"]}fps " +
        "detect=${out["detectMsAvg"]}/${out["detectMsMax"]}ms analysis=${out["analysisMsAvg"]}ms " +
        "latency=${out["latencyMsAvg"]}/${out["latencyMsMax"]}ms " +
        "exact=$exact neighbor=$neighbor hold=$hold cover=$cover face=${out["faceRatio"]}% " +
        "sync=$syncOk/$syncMissed clock=${out["clock"]} mode=$mode effect=$effect",
    )
    windowStartMs = nowMs
    rendered = 0; exact = 0; neighbor = 0; hold = 0; cover = 0
    latencySumMs = 0.0; latencyMaxMs = 0.0; latencyCount = 0
    analyzed = 0; withFace = 0; detectSumMs = 0.0; detectMaxMs = 0.0; analysisSumMs = 0.0
    syncOk = 0; syncMissed = 0
    return out
  }

  private fun round1(v: Double): Double = Math.round(v * 10.0) / 10.0

  companion object {
    const val TAG = "NiaCamera"
    private const val CLOCK_UNKNOWN = 0
    private const val CLOCK_REALTIME = 1
    private const val CLOCK_MONOTONIC = 2
    private const val CLOCK_NONE = 3
    private const val MAX_PLAUSIBLE_NS = 2_000_000_000L
  }
}
