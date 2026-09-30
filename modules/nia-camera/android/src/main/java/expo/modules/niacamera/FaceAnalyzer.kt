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

  interface Listener {
    fun onAnalyzed(timestampNs: Long, faceCount: Int, detectMs: Float, totalMs: Float)
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
      .setMinDetectionConfidence(MIN_CONFIDENCE)
      .build()
    FaceDetector.createFromOptions(context, options)
  } catch (e: Throwable) {
    Log.e(TAG, "MediaPipe FaceDetector indisponible", e)
    listener.onDetectorError(e.message ?: e.javaClass.simpleName)
    null
  }

  @Volatile
  private var closed = false

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

      // Image remise à l'endroit pour le détecteur (BlazeFace n'aime pas les
      // visages couchés), et la transformation inverse pour revenir au tampon.
      val toUpright = Matrix().apply { postRotate(rotation.toFloat()) }
      val bounds = RectF(0f, 0f, w.toFloat(), h.toFloat())
      toUpright.mapRect(bounds)
      toUpright.postTranslate(-bounds.left, -bounds.top)
      val upright = if (rotation % 360 == 0) buffer else Bitmap.createBitmap(buffer, 0, 0, w, h, toUpright, false)
      val toBuffer = Matrix().also { toUpright.invert(it) }

      val tDetect = SystemClock.elapsedRealtimeNanos()
      val mpImage = BitmapImageBuilder(upright).build()
      val result = try {
        det.detect(mpImage)
      } finally {
        mpImage.close()
      }
      val detectMs = (SystemClock.elapsedRealtimeNanos() - tDetect) / 1e6f

      val uw = upright.width.toFloat()
      val uh = upright.height.toFloat()
      val patches = ArrayList<FacePatch>()
      for (d in result.detections()) {
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
        val inBuffer = RectF(up).also { toBuffer.mapRect(it) }
        val crop = clampRect(inBuffer, w, h) ?: continue
        patches.add(
          FacePatch(
            rect = inBuffer,
            pixel = shrink(buffer, crop, PIXEL_CELLS),
            blur = shrink(buffer, crop, BLUR_CELLS),
          ),
        )
      }
      val frameTiny = shrink(buffer, Rect(0, 0, w, h), FRAME_CELLS)
      store.add(FaceResult(ts, w, h, sensorToBuffer, patches, frameTiny))
      if (upright !== buffer) upright.recycle()
      buffer.recycle()
      val totalMs = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6f
      listener.onAnalyzed(ts, patches.size, detectMs, totalMs)
    } catch (e: Throwable) {
      Log.w(TAG, "Analyse échouée (image traitée comme sans visage)", e)
    } finally {
      image.close()
    }
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
    if (mid !== region && mid !== out) mid.recycle()
    if (region !== src && region !== out) region.recycle()
    return out
  }

  companion object {
    const val TAG = "NiaCamera"
    const val MODEL_ASSET = "nia_blaze_face_short_range.tflite"
    const val MIN_CONFIDENCE = 0.5f
    const val EXPAND_W = 1.6f
    const val EXPAND_H = 1.9f
    const val SHIFT_UP = 0.12f
    /** Blocs de pixellisation sur la largeur du visage agrandi. */
    const val PIXEL_CELLS = 9
    const val BLUR_CELLS = 5
    const val FRAME_CELLS = 16
  }
}
