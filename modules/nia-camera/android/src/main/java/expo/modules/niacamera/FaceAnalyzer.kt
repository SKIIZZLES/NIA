package expo.modules.niacamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Analyse de chaque image (flux ImageAnalysis, ~640 × 360, RGBA) :
 * MediaPipe Face Detector (BlazeFace courte portée, sur l'appareil, CPU),
 * puis préparation des vignettes floues / pixellisées de chaque visage.
 *
 * Rien n'est écrit sur le disque ni envoyé : les résultats vivent dans
 * [FaceStore] (≈ 0,5 s) et sont remplacés en continu.
 */
internal class FaceAnalyzer(
  context: Context,
  private val store: FaceStore,
  private val listener: Listener,
) : ImageAnalysis.Analyzer {

  /** Diagnostic d'une analyse (écran de mesures du test sur téléphone). */
  class Info(
    val timestampNs: Long,
    /** Visages retenus (score ≥ [MIN_CONFIDENCE]) et masqués. */
    val faceCount: Int,
    /** Détections brutes, tous scores (≥ [RAW_CONFIDENCE]). */
    val rawCount: Int,
    val bestScore: Float,
    val detectMs: Float,
    val totalMs: Float,
    /** Tampon d'analyse (non tourné). */
    val width: Int,
    val height: Int,
    /** Rotation annoncée par CameraX. */
    val rotation: Int,
    /** Correction de rotation adoptée automatiquement (0 si CameraX a raison). */
    val rotationOffset: Int,
    /** Luminance moyenne (0–255) de l'image donnée à MediaPipe. */
    val lumaMean: Int,
    /** Écart max − min de luminance (image plate / noire si ≈ 0). */
    val lumaRange: Int,
  )

  interface Listener {
    fun onAnalyzed(info: Info)
    fun onDetectorError(message: String)
  }

  private val detector: FaceDetector? = try {
    // Modèle chargé en mémoire (tampon direct) : ne dépend pas de la
    // compression de l'asset dans l'APK.
    val bytes = context.assets.open(MODEL_ASSET).use { it.readBytes() }
    val model = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
    model.put(bytes)
    model.rewind()
    val base = BaseOptions.builder()
      .setModelAssetBuffer(model)
      .setDelegate(Delegate.CPU)
      .build()
    val options = FaceDetector.FaceDetectorOptions.builder()
      .setBaseOptions(base)
      .setRunningMode(RunningMode.IMAGE)
      // Seuil bas : les visages faibles sont comptés pour le diagnostic,
      // seuls ceux ≥ MIN_CONFIDENCE débloquent / pilotent le masque.
      .setMinDetectionConfidence(RAW_CONFIDENCE)
      .build()
    FaceDetector.createFromOptions(context, options)
  } catch (e: Throwable) {
    Log.e(TAG, "MediaPipe FaceDetector indisponible", e)
    listener.onDetectorError(e.message ?: e.javaClass.simpleName)
    null
  }

  @Volatile
  private var closed = false

  /** Correction de rotation (degrés) trouvée par le sondage ci-dessous. */
  private var rotationOffset = 0
  private var missStreak = 0
  private var probeIndex = 0
  private var loggedFirst = false

  private class Detection(val bufferRect: RectF, val score: Float)

  private class Pass(
    val faces: List<Detection>,
    val rawCount: Int,
    val bestScore: Float,
    val detectMs: Float,
  )

  override fun analyze(image: ImageProxy) {
    val t0 = SystemClock.elapsedRealtimeNanos()
    try {
      if (closed) return
      val det = detector ?: return
      val ts = image.imageInfo.timestamp
      val rotation = image.imageInfo.rotationDegrees
      val sensorToBuffer = Matrix(image.imageInfo.sensorToBufferTransformMatrix)
      val buffer = image.toBitmap()
      val w = buffer.width
      val h = buffer.height

      var pass = detectAt(det, buffer, rotation + rotationOffset)
      var detectMs = pass.detectMs
      var raw = pass.rawCount
      var best = pass.bestScore

      // Sondage d'orientation : aucun visage depuis un moment → on essaie,
      // sur une image de temps en temps, les trois autres rotations. Les
      // rectangles sont toujours ramenés au tampon par la transformation
      // inverse exacte : le masque reste juste quelle que soit la rotation.
      if (pass.faces.isEmpty()) {
        missStreak++
        if (missStreak >= PROBE_AFTER_MISSES && missStreak % PROBE_EVERY == 0) {
          probeIndex = (probeIndex + 1) % 3
          val candidate = (rotationOffset + 90 * (probeIndex + 1)) % 360
          val probe = detectAt(det, buffer, rotation + candidate)
          detectMs += probe.detectMs
          raw = max(raw, probe.rawCount)
          best = max(best, probe.bestScore)
          if (probe.faces.isNotEmpty()) {
            Log.w(TAG, "visage trouvé avec +$candidate° (rotation CameraX $rotation°) : correction adoptée")
            rotationOffset = candidate
            pass = probe
          }
        }
      }
      if (pass.faces.isNotEmpty()) missStreak = 0

      val patches = ArrayList<FacePatch>(pass.faces.size)
      for (d in pass.faces) {
        val crop = clampRect(d.bufferRect, w, h) ?: continue
        patches.add(
          FacePatch(
            rect = d.bufferRect,
            pixel = shrink(buffer, crop, PIXEL_CELLS),
            blur = shrink(buffer, crop, BLUR_CELLS),
          ),
        )
      }
      val frameTiny = shrink(buffer, Rect(0, 0, w, h), FRAME_CELLS)
      val (lumaMean, lumaRange) = luma(frameTiny)
      store.add(FaceResult(ts, w, h, sensorToBuffer, patches, frameTiny))
      if (!loggedFirst) {
        loggedFirst = true
        Log.i(
          TAG,
          "1re analyse ${w}x$h rot=$rotation° config=${buffer.config} luma=$lumaMean±$lumaRange " +
            "brut=$raw score=$best",
        )
      }
      buffer.recycle()
      val totalMs = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6f
      listener.onAnalyzed(
        Info(
          timestampNs = ts,
          faceCount = patches.size,
          rawCount = raw,
          bestScore = best,
          detectMs = detectMs,
          totalMs = totalMs,
          width = w,
          height = h,
          rotation = rotation,
          rotationOffset = rotationOffset,
          lumaMean = lumaMean,
          lumaRange = lumaRange,
        ),
      )
    } catch (e: Throwable) {
      Log.w(TAG, "Analyse échouée (image traitée comme sans visage)", e)
    } finally {
      image.close()
    }
  }

  /**
   * Détecte sur le tampon remis à l'endroit de `degrees` (sens horaire).
   * Le tampon d'origine n'est jamais recyclé ici.
   */
  private fun detectAt(det: FaceDetector, buffer: Bitmap, degrees: Int): Pass {
    val w = buffer.width
    val h = buffer.height
    val deg = ((degrees % 360) + 360) % 360
    val toUpright = Matrix().apply { postRotate(deg.toFloat()) }
    val bounds = RectF(0f, 0f, w.toFloat(), h.toFloat())
    toUpright.mapRect(bounds)
    toUpright.postTranslate(-bounds.left, -bounds.top)
    // Toujours une copie : MPImage.close() recycle son Bitmap, il ne doit
    // pas emporter le tampon (encore lu pour les vignettes et le flou total).
    val upright = if (deg == 0) buffer.copy(Bitmap.Config.ARGB_8888, false)
    else Bitmap.createBitmap(buffer, 0, 0, w, h, toUpright, false)
    val toBuffer = Matrix().also { toUpright.invert(it) }
    val uw = upright.width.toFloat()
    val uh = upright.height.toFloat()

    val tDetect = SystemClock.elapsedRealtimeNanos()
    val mpImage = BitmapImageBuilder(upright).build()
    val result = try {
      det.detect(mpImage)
    } finally {
      mpImage.close() // recycle `upright`
    }
    val detectMs = (SystemClock.elapsedRealtimeNanos() - tDetect) / 1e6f

    val faces = ArrayList<Detection>()
    var raw = 0
    var best = 0f
    for (d in result.detections()) {
      val score = d.categories().maxOfOrNull { it.score() } ?: 0f
      raw++
      if (score > best) best = score
      if (score < MIN_CONFIDENCE) continue
      val bb = RectF(d.boundingBox())
      // Sécurité : coordonnées normalisées (0–1) au lieu de pixels.
      if (bb.right <= 1.5f && bb.bottom <= 1.5f) {
        bb.set(bb.left * uw, bb.top * uh, bb.right * uw, bb.bottom * uh)
      }
      if (bb.width() <= 1f || bb.height() <= 1f) continue
      // Agrandi : front, cheveux, oreilles, menton (BlazeFace va des
      // sourcils au menton).
      val cx = bb.centerX()
      val cy = bb.centerY() - bb.height() * SHIFT_UP
      val hw = bb.width() * EXPAND_W / 2f
      val hh = bb.height() * EXPAND_H / 2f
      val up = RectF(cx - hw, cy - hh, cx + hw, cy + hh)
      faces.add(Detection(RectF(up).also { toBuffer.mapRect(it) }, score))
    }
    return Pass(faces, raw, best, detectMs)
  }

  /** Luminance moyenne et écart (max − min) d'une petite vignette. */
  private fun luma(tiny: Bitmap): Pair<Int, Int> {
    val n = tiny.width * tiny.height
    if (n == 0) return 0 to 0
    val px = IntArray(n)
    tiny.getPixels(px, 0, tiny.width, 0, 0, tiny.width, tiny.height)
    var sum = 0L
    var lo = 255
    var hi = 0
    for (c in px) {
      val r = (c shr 16) and 0xFF
      val g = (c shr 8) and 0xFF
      val b = c and 0xFF
      val y = (r * 77 + g * 150 + b * 29) shr 8
      sum += y
      if (y < lo) lo = y
      if (y > hi) hi = y
    }
    return (sum / n).toInt() to (hi - lo).coerceAtLeast(0)
  }

  /** Plus aucune analyse (les images suivantes sont simplement fermées). */
  fun markClosed() {
    closed = true
  }

  fun close() {
    closed = true
    try {
      detector?.close()
    } catch (_: Throwable) {
    }
  }

  private fun clampRect(r: RectF, w: Int, h: Int): Rect? {
    val l = max(0, r.left.toInt())
    val t = max(0, r.top.toInt())
    val rr = min(w, r.right.roundToInt())
    val b = min(h, r.bottom.roundToInt())
    return if (rr - l >= 2 && b - t >= 2) Rect(l, t, rr, b) else null
  }

  /**
   * Réduit la zone à `cells` pixels sur son plus grand côté, en deux étapes
   * (approche une moyenne plutôt qu'un simple échantillonnage).
   */
  private fun shrink(src: Bitmap, crop: Rect, cells: Int): Bitmap {
    val cw = crop.width()
    val ch = crop.height()
    val scale = cells.toFloat() / max(cw, ch)
    val tw = max(1, (cw * scale).roundToInt())
    val th = max(1, (ch * scale).roundToInt())
    val region = Bitmap.createBitmap(src, crop.left, crop.top, cw, ch)
    val midW = min(cw, tw * 4)
    val midH = min(ch, th * 4)
    val mid = Bitmap.createScaledBitmap(region, midW, midH, true)
    val out = Bitmap.createScaledBitmap(mid, tw, th, true)
    if (mid !== region && mid !== out && mid !== src) mid.recycle()
    if (region !== src && region !== out) region.recycle()
    // Jamais le tampon lui-même (il est recyclé à la fin de l'analyse).
    return if (out === src) src.copy(Bitmap.Config.ARGB_8888, false) else out
  }

  companion object {
    const val TAG = "NiaCamera"
    const val MODEL_ASSET = "nia_blaze_face_short_range.tflite"
    const val MIN_CONFIDENCE = 0.5f
    const val RAW_CONFIDENCE = 0.3f
    const val EXPAND_W = 1.6f
    const val EXPAND_H = 1.9f
    const val SHIFT_UP = 0.12f
    /** Blocs de pixellisation sur la largeur du visage agrandi. */
    const val PIXEL_CELLS = 9
    const val BLUR_CELLS = 5
    const val FRAME_CELLS = 16
    /** Sondage d'orientation : après 15 analyses sans visage, 1 image sur 5. */
    const val PROBE_AFTER_MISSES = 15
    const val PROBE_EVERY = 5
  }
}
