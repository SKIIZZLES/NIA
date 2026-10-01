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
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Analyse de chaque image (flux ImageAnalysis, RGBA, réduite à ≤ 640 px) :
 *  - MediaPipe Face Detector (BlazeFace courte portée) sur CHAQUE image :
 *    présence et zone de chaque visage (filet de sécurité, jalon 1) ;
 *    le résultat part TOUT DE SUITE (jamais d'attente des repères) ;
 *  - MediaPipe Face Landmarker (478 repères), sur son propre fil, seulement
 *    quand un masque (cagoule / intégral) est choisi : une image à la fois,
 *    les suivantes passent sans repères tant qu'il travaille (jalon 2b).
 *    Il pré-dessine le masque (sprite) : le fil GL n'a plus qu'à le poser.
 * Un visage vu par l'un OU l'autre est masqué.
 *
 * Tout est sur l'appareil (GPU pour les repères si possible, sinon CPU).
 * Rien n'est écrit sur le disque ni envoyé : les résultats vivent dans
 * [FaceStore] / [LandmarkStore] (≈ 0,5 s) et sont remplacés en continu.
 */
internal class FaceAnalyzer(
  private val context: Context,
  private val store: FaceStore,
  private val landmarkStore: LandmarkStore,
  private val listener: Listener,
) : ImageAnalysis.Analyzer {

  /** Diagnostic d'une analyse (écran de mesures du test sur téléphone). */
  class Info(
    val timestampNs: Long,
    /** Visages masqués (détecteur ∪ repères). */
    val faceCount: Int,
    /** Détections brutes du détecteur, tous scores (≥ [RAW_CONFIDENCE]). */
    val rawCount: Int,
    val bestScore: Float,
    val detectMs: Float,
    val totalMs: Float,
    /** Copie + réduction + redressement avant MediaPipe. */
    val prepMs: Float,
    /** Tampon d'analyse travaillé (non tourné, après réduction). */
    val width: Int,
    val height: Int,
    /** Tampon reçu de CameraX (avant réduction). */
    val sourceWidth: Int,
    val sourceHeight: Int,
    val rotation: Int,
    val rotationOffset: Int,
    val lumaMean: Int,
    val lumaRange: Int,
    /** Début d'analyse, dans les deux horloges (délai caméra → analyse). */
    val startRealtimeNs: Long,
    val startMonoNs: Long,
    // --- Repères (jalon 2).
    val landmarksWanted: Boolean,
    /** "off" | "loading" | "ready" | "error". */
    val landmarkState: String,
    /** Image passée sans repères : le fil des repères était occupé. */
    val landmarkSkipped: Boolean,
  )

  /** Diagnostic d'un passage de Face Landmarker (son propre fil). */
  class LandmarkInfo(
    val timestampNs: Long,
    /** Inférence MediaPipe seule. */
    val inferMs: Float,
    /** Inférence + géométrie + pré-rendu des masques. */
    val totalMs: Float,
    val faces: Int,
    /** "GPU" | "CPU". */
    val delegate: String,
  )

  interface Listener {
    fun onAnalyzed(info: Info)
    fun onLandmarks(info: LandmarkInfo)
    fun onDetectorError(message: String)
  }

  private val detector: FaceDetector? = try {
    val base = BaseOptions.builder()
      .setModelAssetBuffer(loadAsset(DETECTOR_ASSET))
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

  /** Masque à repères demandé (cagoule / intégral). */
  @Volatile
  var landmarksWanted = false

  /** Effet des masques à pré-dessiner. */
  @Volatile
  var maskEffect: FaceMaskRenderer.Effect = FaceMaskRenderer.Effect.SKI_MASK

  private val landmarkExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread(r, "NiaCameraLandmarks")
  }

  @Volatile
  private var landmarker: FaceLandmarker? = null

  @Volatile
  private var landmarkState = "off"
  @Volatile
  private var delegate = "CPU"
  /** Fil des repères occupé : l'image suivante passe sans repères. */
  private val landmarkBusy = AtomicBoolean(false)
  private var lastLandmarkTsMs = -1L
  private var landmarkFailures = 0
  /** Sprites des masques (fil des repères). */
  private val spritePool = MaskSprite.Pool()

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

  /** Image redressée pour MediaPipe et la transformation retour. */
  private class Upright(val bitmap: Bitmap, val toBuffer: Matrix)

  /**
   * Tampon + image redressée partagés entre le fil d'analyse et celui des
   * repères : recyclés par le dernier des deux qui a fini.
   */
  private class Shared(val buffer: Bitmap, val upright: Upright, users: Int) {
    private val refs = AtomicInteger(users)
    fun release() {
      if (refs.decrementAndGet() == 0) {
        upright.bitmap.recycle()
        buffer.recycle()
      }
    }
  }

  override fun analyze(image: ImageProxy) {
    val t0 = SystemClock.elapsedRealtimeNanos()
    val m0 = System.nanoTime()
    try {
      if (closed) return
      val det = detector ?: return
      val ts = image.imageInfo.timestamp
      val rotation = image.imageInfo.rotationDegrees
      val sensorToBuffer = Matrix(image.imageInfo.sensorToBufferTransformMatrix)
      val source = image.toBitmap()
      val srcW = source.width
      val srcH = source.height
      // Réduction à ≤ WORK_MAX_SIDE : MediaPipe redimensionne de toute façon
      // (128 px détecteur, 256 px repères) ; tout le reste coûte 4× moins.
      val k = min(1f, WORK_MAX_SIDE.toFloat() / max(srcW, srcH))
      val buffer = if (k < 1f) {
        Bitmap.createScaledBitmap(source, (srcW * k).roundToInt(), (srcH * k).roundToInt(), true)
          .also { if (it !== source) source.recycle() }
      } else {
        source
      }
      if (k < 1f) sensorToBuffer.postScale(buffer.width.toFloat() / srcW, buffer.height.toFloat() / srcH)
      val w = buffer.width
      val h = buffer.height

      val deg = rotation + rotationOffset
      val upright = makeUpright(buffer, deg)
      val prepMs = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6f

      // Repères sur leur fil, si libre ; jamais attendus ici.
      val wantLandmarks = landmarksWanted
      val submit = wantLandmarks && startLandmarks()
      val shared = Shared(buffer, upright, if (submit) 2 else 1)
      if (submit) {
        try {
          landmarkExecutor.execute { runLandmarks(shared, ts, maskEffect) }
        } catch (e: Throwable) {
          landmarkBusy.set(false)
          shared.release()
        }
      }

      try {
        var pass = detectOn(det, upright)
        var detectMs = pass.detectMs
        var raw = pass.rawCount
        var best = pass.bestScore

        // Sondage d'orientation (détecteur seul) : aucun visage depuis un
        // moment → on essaie, de temps en temps, les trois autres rotations.
        if (pass.faces.isEmpty()) {
          missStreak++
          if (missStreak >= PROBE_AFTER_MISSES && missStreak % PROBE_EVERY == 0) {
            probeIndex = (probeIndex + 1) % 3
            val candidate = (rotationOffset + 90 * (probeIndex + 1)) % 360
            val up2 = makeUpright(buffer, rotation + candidate)
            val probe = detectOn(det, up2)
            up2.bitmap.recycle()
            detectMs += probe.detectMs
            raw = max(raw, probe.rawCount)
            best = max(best, probe.bestScore)
            if (probe.faces.isNotEmpty()) {
              Log.w(TAG, "visage trouvé avec +$candidate° (rotation CameraX $rotation°) : correction adoptée")
              rotationOffset = candidate
              pass = probe
            }
          }
        } else {
          missStreak = 0
        }

        val patches = ArrayList<FacePatch>(pass.faces.size)
        for (d in pass.faces) {
          makePatch(buffer, d.bufferRect, w, h)?.let { patches.add(it) }
        }
        val frameTiny = shrink(buffer, Rect(0, 0, w, h), FRAME_CELLS)
        val (lumaMean, lumaRange) = luma(frameTiny)
        store.add(FaceResult(ts, w, h, sensorToBuffer, patches, frameTiny))
        if (!loggedFirst) {
          loggedFirst = true
          Log.i(TAG, "1re analyse ${srcW}x$srcH→${w}x$h rot=$rotation° luma=$lumaMean±$lumaRange brut=$raw score=$best")
        }
        val totalMs = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6f
        listener.onAnalyzed(
          Info(
            timestampNs = ts,
            faceCount = patches.size,
            rawCount = raw,
            bestScore = best,
            detectMs = detectMs,
            totalMs = totalMs,
            prepMs = prepMs,
            width = w,
            height = h,
            sourceWidth = srcW,
            sourceHeight = srcH,
            rotation = rotation,
            rotationOffset = rotationOffset,
            lumaMean = lumaMean,
            lumaRange = lumaRange,
            startRealtimeNs = t0,
            startMonoNs = m0,
            landmarksWanted = wantLandmarks,
            landmarkState = if (wantLandmarks) landmarkState else "off",
            landmarkSkipped = wantLandmarks && !submit,
          ),
        )
      } finally {
        shared.release()
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Analyse échouée (image traitée comme sans visage)", e)
    } finally {
      image.close()
    }
  }

  /** Tampon redressé de `degrees` (sens horaire) ; toujours une copie. */
  private fun makeUpright(buffer: Bitmap, degrees: Int): Upright {
    val w = buffer.width
    val h = buffer.height
    val deg = ((degrees % 360) + 360) % 360
    val toUpright = Matrix().apply { postRotate(deg.toFloat()) }
    val bounds = RectF(0f, 0f, w.toFloat(), h.toFloat())
    toUpright.mapRect(bounds)
    toUpright.postTranslate(-bounds.left, -bounds.top)
    val bmp = if (deg == 0) buffer.copy(Bitmap.Config.ARGB_8888, false)
    else Bitmap.createBitmap(buffer, 0, 0, w, h, toUpright, false)
    return Upright(bmp, Matrix().also { toUpright.invert(it) })
  }

  /** Détecteur sur l'image redressée (qui n'est pas recyclée ici). */
  private fun detectOn(det: FaceDetector, up: Upright): Pass {
    val upright = up.bitmap
    val uw = upright.width.toFloat()
    val uh = upright.height.toFloat()
    val tDetect = SystemClock.elapsedRealtimeNanos()
    // Pas de close() : il recyclerait l'image, encore lue par les repères.
    val result = det.detect(BitmapImageBuilder(upright).build())
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
      if (bb.right <= 1.5f && bb.bottom <= 1.5f) {
        bb.set(bb.left * uw, bb.top * uh, bb.right * uw, bb.bottom * uh)
      }
      if (bb.width() <= 1f || bb.height() <= 1f) continue
      faces.add(Detection(expandToBuffer(bb, up.toBuffer), score))
    }
    return Pass(faces, raw, best, detectMs)
  }

  /**
   * Zone agrandie (front, cheveux, oreilles, menton ; BlazeFace va des
   * sourcils au menton), dans l'image redressée puis ramenée au tampon.
   */
  private fun expandToBuffer(bb: RectF, toBuffer: Matrix): RectF {
    val cx = bb.centerX()
    val cy = bb.centerY() - bb.height() * SHIFT_UP
    val hw = bb.width() * EXPAND_W / 2f
    val hh = bb.height() * EXPAND_H / 2f
    return RectF(cx - hw, cy - hh, cx + hw, cy + hh).also { toBuffer.mapRect(it) }
  }

  /** Zone + vignettes (pixels, flou, ellipse de flou) d'un visage. */
  private fun makePatch(buffer: Bitmap, rect: RectF, w: Int, h: Int): FacePatch? {
    val crop = clampRect(rect, w, h) ?: return null
    val blur = shrink(buffer, crop, BLUR_CELLS)
    return FacePatch(rect, shrink(buffer, crop, PIXEL_CELLS), blur, MaskSprite.blurOval(blur, rect))
  }

  /**
   * Réserve le fil des repères pour cette image. Faux s'il n'est pas prêt
   * (chargement lancé) ou encore occupé : l'image part sans repères.
   */
  private fun startLandmarks(): Boolean {
    if (landmarker == null) {
      if (landmarkState == "off") {
        landmarkState = "loading"
        landmarkExecutor.execute { createLandmarker(preferGpu = true) }
      }
      return false
    }
    return landmarkBusy.compareAndSet(false, true)
  }

  /** Fil des repères : inférence, géométrie, sprite, publication. */
  private fun runLandmarks(shared: Shared, ts: Long, fx: FaceMaskRenderer.Effect) {
    try {
      if (closed) return
      val lmk = landmarker ?: return
      val up = shared.upright
      val buffer = shared.buffer
      val t = SystemClock.elapsedRealtimeNanos()
      // Mode VIDEO : horodatages strictement croissants (ms).
      val tsMs = max(ts / 1_000_000L, lastLandmarkTsMs + 1)
      lastLandmarkTsMs = tsMs
      val uw = up.bitmap.width.toFloat()
      val uh = up.bitmap.height.toFloat()
      // Pas de close() : il recyclerait l'image (partagée).
      val res = try {
        lmk.detectForVideo(BitmapImageBuilder(up.bitmap).build(), tsMs)
      } catch (e: Throwable) {
        if (landmarkFailures++ < 3) Log.w(TAG, "repères en erreur ($delegate) : repli sur le flou", e)
        if (delegate == "GPU") {
          // GPU instable sur cet appareil : on repasse en CPU.
          try {
            lmk.close()
          } catch (_: Throwable) {
          }
          landmarker = null
          createLandmarker(preferGpu = false)
        }
        return
      }
      val inferMs = (SystemClock.elapsedRealtimeNanos() - t) / 1e6f
      val w = buffer.width
      val h = buffer.height
      val faces = ArrayList<LandmarkFace>()
      for (face in res.faceLandmarks()) {
        val mask = MaskGeometry.build(face, uw, uh, up.toBuffer) ?: continue
        // Zone du visage tirée des repères (ancrage, repli), dans l'image
        // redressée puis ramenée au tampon.
        var x0 = Float.MAX_VALUE
        var y0 = Float.MAX_VALUE
        var x1 = -Float.MAX_VALUE
        var y1 = -Float.MAX_VALUE
        for (i in MaskGeometry.FACE_OVAL) {
          val x = face[i].x() * uw
          val y = face[i].y() * uh
          x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
        }
        val hw = (x1 - x0) * LANDMARK_EXPAND_W / 2f
        val hh = (y1 - y0) * LANDMARK_EXPAND_H / 2f
        val cx = (x0 + x1) / 2f
        val cy = (y0 + y1) / 2f - (y1 - y0) * LANDMARK_SHIFT_UP
        val rect = RectF(cx - hw, cy - hh, cx + hw, cy + hh).also { up.toBuffer.mapRect(it) }
        val sprite = MaskSprite.render(mask, fx, spritePool) ?: continue
        faces.add(LandmarkFace(fx, sprite.bitmap, sprite.src, sprite.rect, rect, makePatch(buffer, rect, w, h)))
      }
      if (closed) return
      val evicted = landmarkStore.add(LandmarkResult(ts, w, h, faces))
      spritePool.retire(evicted.flatMap { r -> r.faces.map { it.sprite } })
      val totalMs = (SystemClock.elapsedRealtimeNanos() - t) / 1e6f
      listener.onLandmarks(LandmarkInfo(ts, inferMs, totalMs, faces.size, delegate))
    } catch (e: Throwable) {
      if (landmarkFailures++ < 3) Log.w(TAG, "repères en erreur : repli sur le flou", e)
    } finally {
      landmarkBusy.set(false)
      shared.release()
    }
  }

  private fun createLandmarker(preferGpu: Boolean) {
    if (closed) return
    val order = if (preferGpu) listOf(Delegate.GPU, Delegate.CPU) else listOf(Delegate.CPU)
    for (d in order) {
      try {
        val base = BaseOptions.builder()
          .setModelAssetBuffer(loadAsset(LANDMARKER_ASSET))
          .setDelegate(d)
          .build()
        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
          .setBaseOptions(base)
          .setRunningMode(RunningMode.VIDEO)
          .setNumFaces(MAX_FACES)
          .setMinFaceDetectionConfidence(MIN_CONFIDENCE)
          .setMinFacePresenceConfidence(MIN_CONFIDENCE)
          .setMinTrackingConfidence(MIN_CONFIDENCE)
          .setOutputFaceBlendshapes(false)
          .setOutputFacialTransformationMatrixes(false)
          .build()
        landmarker = FaceLandmarker.createFromOptions(context, options)
        delegate = if (d == Delegate.GPU) "GPU" else "CPU"
        lastLandmarkTsMs = -1L
        landmarkState = "ready"
        Log.i(TAG, "Face Landmarker prêt ($delegate)")
        return
      } catch (e: Throwable) {
        Log.w(TAG, "Face Landmarker indisponible en $d", e)
      }
    }
    // Pas d'erreur de montage : le flou du détecteur couvre toujours.
    Log.e(TAG, "Face Landmarker indisponible : flou de repli")
    landmarkState = "error"
  }

  private fun loadAsset(name: String): ByteBuffer {
    // Modèle chargé en mémoire (tampon direct) : ne dépend pas de la
    // compression de l'asset dans l'APK.
    val bytes = context.assets.open(name).use { it.readBytes() }
    return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
      put(bytes)
      rewind()
    }
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
    try {
      landmarkExecutor.execute {
        try {
          landmarker?.close()
        } catch (_: Throwable) {
        }
        landmarker = null
      }
      landmarkExecutor.shutdown()
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
    const val DETECTOR_ASSET = "nia_blaze_face_short_range.tflite"
    const val LANDMARKER_ASSET = "nia_face_landmarker.task"
    const val MIN_CONFIDENCE = 0.5f
    const val RAW_CONFIDENCE = 0.3f
    const val MAX_FACES = 3
    const val WORK_MAX_SIDE = 640
    const val EXPAND_W = 1.6f
    const val EXPAND_H = 1.9f
    const val SHIFT_UP = 0.12f
    /** Emprise des repères (front → menton, joue → joue) agrandie. */
    const val LANDMARK_EXPAND_W = 1.5f
    const val LANDMARK_EXPAND_H = 1.5f
    const val LANDMARK_SHIFT_UP = 0.08f
    /** Blocs de pixellisation sur la largeur du visage agrandi. */
    const val PIXEL_CELLS = 9
    const val BLUR_CELLS = 5
    const val FRAME_CELLS = 16
    /** Sondage d'orientation : après 15 analyses sans visage, 1 image sur 5. */
    const val PROBE_AFTER_MISSES = 15
    const val PROBE_EVERY = 5
  }
}
