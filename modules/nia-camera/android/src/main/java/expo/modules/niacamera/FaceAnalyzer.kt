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
    /** Visages écartés : repères incohérents avec BlazeFace (inclinaison, forme, taille). */
    val rejected: Int,
    /** Côté du recadrage donné à Face Landmarker (px de l'image redressée). */
    val roiSide: Int,
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
  private var landmarkFailures = 0
  /**
   * Suivi par nos propres repères quand BlazeFace perd le visage (profil) :
   * zone de la dernière passe (image redressée) et nombre de passes d'affilée
   * sans BlazeFace. Fil des repères ; lu par le fil d'analyse.
   */
  private var lastLandmarkRoi: RectF? = null
  /** Silhouettes de la dernière passe de repères (fil des repères). */
  private var meshTracks: List<MeshTrack> = emptyList()
  @Volatile
  private var landmarkContinuation = false
  private var landmarkOnlyStreak = 0
  /** Sprites des masques (fil des repères). */
  private val spritePool = MaskSprite.Pool()

  @Volatile
  private var closed = false

  /**
   * Correction de rotation (degrés) par rapport à celle de CameraX (capteur +
   * écran). 0 par défaut ; changée seulement sur preuve forte et répétée, et
   * remise à 0 dès qu'un visage est trouvé dans la rotation de CameraX.
   */
  private var rotationOffset = 0
  private var missStreak = 0
  private var probeIndex = 0
  private var probeCandidate = -1
  private var probeHits = 0
  private var frameIndex = 0L
  private var loggedFirst = false

  /** Pistes des visages (fil d'analyse) : vitesse lissée pour la prédiction. */
  private class Track(
    var cx: Float,
    var cy: Float,
    var w: Float,
    var vx: Float,
    var vy: Float,
    var vw: Float,
    var ts: Long,
  )
  private val tracks = ArrayList<Track>()

  /**
   * Un visage BlazeFace : zone agrandie (tampon), boîte brute (image
   * redressée) et inclinaison des yeux (degrés, tampon, NaN si inconnue).
   */
  private class Detection(
    val bufferRect: RectF,
    val score: Float,
    val uprightBox: RectF,
    val roll: Float,
    /** Zone serrée (boîte à peine élargie, tampon) : filet de sécurité sous le masque. */
    val coreRect: RectF,
    /** Boîte BlazeFace telle quelle (tampon) : contrôle de couverture du masque. */
    val faceBox: RectF,
  )

  /** Visage d'une passe de repères : vitesse propre du maillage à la passe suivante. */
  private class MeshTrack(val cx: Float, val cy: Float, val half: Float, val ts: Long)

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

      frameIndex++
      var upright = makeUpright(buffer, rotation + rotationOffset)
      val prepMs = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6f
      val wantLandmarks = landmarksWanted
      var submit = false
      try {
        var pass = detectOn(det, upright)
        var detectMs = pass.detectMs
        var raw = pass.rawCount
        var best = pass.bestScore

        // Correction active : la rotation de CameraX reste la référence. Dès
        // qu'elle trouve un visage, on y revient.
        if (rotationOffset != 0 && (pass.faces.isEmpty() || frameIndex % RESET_CHECK_EVERY == 0L)) {
          val up0 = makeUpright(buffer, rotation)
          val p0 = detectOn(det, up0)
          detectMs += p0.detectMs
          if (p0.faces.isNotEmpty()) {
            Log.w(TAG, "visage trouvé dans la rotation CameraX ($rotation°) : correction +$rotationOffset° abandonnée")
            rotationOffset = 0
            upright.bitmap.recycle()
            upright = up0
            pass = p0
            raw = max(raw, p0.rawCount)
            best = max(best, p0.bestScore)
          } else {
            up0.bitmap.recycle()
          }
        }

        // Sondage d'orientation : seulement après 1 s sans aucun visage, et
        // une autre rotation n'est adoptée qu'après 3 sondages d'affilée qui
        // y trouvent un visage net (score ≥ 0,8).
        if (pass.faces.isEmpty()) {
          missStreak++
          if (missStreak >= PROBE_AFTER_MISSES && missStreak % PROBE_EVERY == 0) {
            if (probeHits == 0) probeIndex = (probeIndex + 1) % 3
            val candidate = (rotationOffset + 90 * (probeIndex + 1)) % 360
            val up2 = makeUpright(buffer, rotation + candidate)
            val probe = detectOn(det, up2)
            detectMs += probe.detectMs
            raw = max(raw, probe.rawCount)
            best = max(best, probe.bestScore)
            val strong = probe.faces.isNotEmpty() && probe.bestScore >= PROBE_MIN_SCORE
            if (strong && (probeHits == 0 || probeCandidate == candidate)) {
              probeCandidate = candidate
              probeHits++
            } else {
              probeHits = 0
              probeCandidate = -1
            }
            if (probeHits >= PROBE_CONFIRM) {
              Log.w(TAG, "visage trouvé $probeHits fois avec +$candidate° (rotation CameraX $rotation°) : correction adoptée")
              rotationOffset = candidate
              probeHits = 0
              probeCandidate = -1
              missStreak = 0
              upright.bitmap.recycle()
              upright = up2
              pass = probe
            } else {
              up2.bitmap.recycle()
            }
          }
        } else {
          missStreak = 0
          probeHits = 0
          probeCandidate = -1
        }

        val patches = ArrayList<FacePatch>(pass.faces.size)
        for (d in pass.faces) {
          makePatch(buffer, d.bufferRect, w, h, d.roll, d.coreRect, d.faceBox)?.let { patches.add(it) }
        }
        updateTracks(ts, patches)
        val frameTiny = shrink(buffer, Rect(0, 0, w, h), FRAME_CELLS)
        val (lumaMean, lumaRange) = luma(frameTiny)
        store.add(FaceResult(ts, w, h, sensorToBuffer, patches, frameTiny))

        // Repères APRÈS BlazeFace (résultat déjà publié) : recadrés sur la
        // boîte fraîche de cette image, sur leur fil, jamais attendus ici.
        if (wantLandmarks && (pass.faces.isNotEmpty() || landmarkContinuation)) {
          submit = startLandmarks()
        }
        if (submit) {
          val shared = Shared(buffer, upright, 1)
          val dets = pass.faces
          val fx = maskEffect
          try {
            landmarkExecutor.execute { runLandmarks(shared, ts, fx, dets) }
          } catch (e: Throwable) {
            landmarkBusy.set(false)
            submit = false
          }
        }

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
            landmarkSkipped = wantLandmarks && pass.faces.isNotEmpty() && !submit,
          ),
        )
      } finally {
        // Confiés au fil des repères : c'est lui qui les recyclera.
        if (!submit) {
          upright.bitmap.recycle()
          buffer.recycle()
        }
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
      // Inclinaison des yeux (points clés 0 et 1 de BlazeFace), dans le tampon.
      var roll = Float.NaN
      val kps = d.keypoints().orElse(null)
      if (kps != null && kps.size >= 2) {
        val pts = floatArrayOf(kps[0].x() * uw, kps[0].y() * uh, kps[1].x() * uw, kps[1].y() * uh)
        up.toBuffer.mapPoints(pts)
        roll = Angles.lineAngle(pts[2] - pts[0], pts[3] - pts[1])
      }
      faces.add(Detection(expandToBuffer(bb, up.toBuffer), score, bb, roll, coreToBuffer(bb, up.toBuffer), RectF(bb).also { up.toBuffer.mapRect(it) }))
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

  /** Zone serrée (sourcils → menton, joue → joue), ramenée au tampon. */
  /** Emprise (tampon) du contour dessiné du masque : contrôle de couverture. */
  private fun outlineBounds(pts: FloatArray): RectF {
    var x0 = Float.MAX_VALUE
    var y0 = Float.MAX_VALUE
    var x1 = -Float.MAX_VALUE
    var y1 = -Float.MAX_VALUE
    var i = 0
    while (i + 1 < pts.size) {
      x0 = min(x0, pts[i]); x1 = max(x1, pts[i])
      y0 = min(y0, pts[i + 1]); y1 = max(y1, pts[i + 1])
      i += 2
    }
    return RectF(x0, y0, x1, y1)
  }

  private fun coreToBuffer(bb: RectF, toBuffer: Matrix): RectF {
    val cx = bb.centerX()
    val cy = bb.centerY() - bb.height() * CORE_UP
    val hw = bb.width() * CORE_W / 2f
    val hh = bb.height() * CORE_H / 2f
    return RectF(cx - hw, cy - hh, cx + hw, cy + hh).also { toBuffer.mapRect(it) }
  }

  /** Zone + vignettes (pixels, flou, ellipse de flou) d'un visage. */
  private fun makePatch(
    buffer: Bitmap,
    rect: RectF,
    w: Int,
    h: Int,
    roll: Float = Float.NaN,
    core: RectF? = null,
    face: RectF? = null,
  ): FacePatch? {
    val crop = clampRect(rect, w, h) ?: return null
    val blur = shrink(buffer, crop, BLUR_CELLS)
    return FacePatch(rect, shrink(buffer, crop, PIXEL_CELLS), blur, MaskSprite.blurOval(blur, rect), roll, core, face)
  }

  /**
   * Vitesse de chaque visage (px/s), lissée : filtre alpha-bêta dont le gain
   * monte quand le visage accélère (réactif sur un geste brusque, calme au
   * repos, comme un filtre « one-euro »). La position reste la boîte fraîche.
   */
  private fun updateTracks(ts: Long, patches: List<FacePatch>) {
    tracks.removeAll { ts - it.ts > TRACK_DROP_NS || ts < it.ts }
    val used = BooleanArray(tracks.size)
    for (p in patches) {
      val cx = p.rect.centerX()
      val cy = p.rect.centerY()
      val w = p.rect.width()
      var best = -1
      var bestD = w * TRACK_MATCH
      for ((i, t) in tracks.withIndex()) {
        if (used[i]) continue
        val d = kotlin.math.hypot(t.cx - cx, t.cy - cy)
        if (d <= bestD) {
          bestD = d
          best = i
        }
      }
      if (best < 0) {
        tracks.add(Track(cx, cy, w, 0f, 0f, 0f, ts))
        continue
      }
      used[best] = true
      val t = tracks[best]
      val dt = (ts - t.ts) / 1e9f
      if (dt <= 0f) continue
      val rx = cx - (t.cx + t.vx * dt)
      val ry = cy - (t.cy + t.vy * dt)
      val rw = w - (t.w + t.vw * dt)
      val g = kotlin.math.hypot(rx, ry) / max(1f, w * 0.15f)
      val beta = min(BETA_MAX, BETA_MIN + 0.6f * g)
      t.vx += beta * rx / dt
      t.vy += beta * ry / dt
      t.vw += BETA_MIN * rw / dt
      // Vitesse plafonnée (≈ 4 largeurs de visage par seconde).
      val vmax = w * 4f
      val v = kotlin.math.hypot(t.vx, t.vy)
      if (v > vmax) {
        t.vx *= vmax / v
        t.vy *= vmax / v
      }
      t.vw = t.vw.coerceIn(-w, w)
      t.cx = cx
      t.cy = cy
      t.w = w
      t.ts = ts
      p.vx = t.vx
      p.vy = t.vy
      p.vw = t.vw
    }
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

  /**
   * Fil des repères : recadrage sur la boîte BlazeFace de CETTE image,
   * inférence (mode IMAGE : aucun suivi interne qui pourrait rester accroché
   * à une mauvaise zone), contrôle de cohérence avec BlazeFace, géométrie,
   * sprite, publication.
   */
  private fun runLandmarks(shared: Shared, ts: Long, fx: FaceMaskRenderer.Effect, dets: List<Detection>) {
    var crop: Bitmap? = null
    try {
      if (closed) return
      val lmk = landmarker ?: return
      val up = shared.upright
      val buffer = shared.buffer
      val t = SystemClock.elapsedRealtimeNanos()
      val uw = up.bitmap.width
      val uh = up.bitmap.height
      // Zone à recadrer (image redressée) : boîtes BlazeFace, sinon nos
      // derniers repères (profil perdu par BlazeFace, quelques passes au plus).
      val roi = RectF()
      val scale: Float
      if (dets.isNotEmpty()) {
        roi.set(dets[0].uprightBox)
        for (d in dets) roi.union(d.uprightBox)
        roi.offset(0f, -roi.height() * 0.1f)
        scale = ROI_SCALE
        landmarkOnlyStreak = 0
      } else {
        val last = lastLandmarkRoi
        if (last == null || landmarkOnlyStreak >= LANDMARK_ONLY_MAX) {
          landmarkContinuation = false
          return
        }
        roi.set(last)
        scale = ROI_SCALE_CONTINUE
        landmarkOnlyStreak++
      }
      val side = max(roi.width(), roi.height()) * scale
      val cr = squareCrop(roi.centerX(), roi.centerY(), side, uw, uh) ?: return
      val c = paddedCrop(up.bitmap, cr)
      crop = c
      val cw = c.width.toFloat()
      val ch = c.height.toFloat()
      // Recadrage (éventuellement réduit) → image redressée → tampon.
      val cropToBuffer = Matrix(up.toBuffer).apply {
        preTranslate(cr.left.toFloat(), cr.top.toFloat())
        preScale(cr.width() / cw, cr.height() / ch)
      }
      // Pas de close() : il recyclerait l'image ; recyclée ci-dessous.
      val res = try {
        lmk.detect(BitmapImageBuilder(c).build())
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
      var rejected = 0
      var nextRoi: RectF? = null
      val tracks = ArrayList<MeshTrack>(res.faceLandmarks().size)
      for (face in res.faceLandmarks()) {
        if (face.size < MaskGeometry.MESH_POINTS) continue
        // Masque épousant le visage (silhouette du maillage, paupières,
        // lèvres) : recadrage → image redressée → tampon. Dégénéré : écarté.
        val mask = MaskGeometry.build(face, cw, ch, cropToBuffer)
        if (mask == null) {
          rejected++
          continue
        }
        // Zone du visage tirée de la silhouette (ancrage, repli).
        val sb = mask.bounds
        val hw = sb.width() * LANDMARK_EXPAND_W / 2f
        val hh = sb.height() * LANDMARK_EXPAND_H / 2f
        val rect = RectF(
          sb.centerX() - hw, sb.centerY() - sb.height() * LANDMARK_SHIFT_UP - hh,
          sb.centerX() + hw, sb.centerY() - sb.height() * LANDMARK_SHIFT_UP + hh,
        )
        val check = MeshCheck.of(face, cw, ch, cropToBuffer)
        if (!check.shapeOk || !matchesDetector(check, rect, dets)) {
          rejected++
          continue
        }
        val sprite = MaskSprite.render(mask, fx, spritePool) ?: continue
        val halo = MaskSprite.renderHalo(mask, fx, buffer) { r, cells -> shrink(buffer, r, cells) }
        val speed = meshSpeed(mask, ts)
        tracks.add(MeshTrack(mask.centerX, mask.centerY, mask.halfSize, ts))
        faces.add(
          LandmarkFace(
            fx, sprite.bitmap, sprite.src, sprite.rect, rect, makePatch(buffer, rect, w, h, check.roll), check.roll,
            halo?.bitmap, halo?.src, halo?.rect, speed,
            outlineBounds(if (fx == FaceMaskRenderer.Effect.SKI_MASK) mask.hood else mask.full),
            if (fx == FaceMaskRenderer.Effect.SKI_MASK) mask.hoodHalo else mask.fullHalo,
          ),
        )
        // Zone suivante (image redressée) : la zone du visage, ramenée du tampon.
        if (nextRoi == null) nextRoi = RectF(rect).also { bufferToUpright(up).mapRect(it) }
      }
      meshTracks = tracks
      lastLandmarkRoi = nextRoi
      landmarkContinuation = nextRoi != null && landmarkOnlyStreak < LANDMARK_ONLY_MAX
      if (closed) return
      val evicted = landmarkStore.add(LandmarkResult(ts, w, h, faces))
      spritePool.retire(evicted.flatMap { r -> r.faces.map { it.sprite } })
      val totalMs = (SystemClock.elapsedRealtimeNanos() - t) / 1e6f
      listener.onLandmarks(LandmarkInfo(ts, inferMs, totalMs, faces.size, delegate, rejected, cr.width()))
    } catch (e: Throwable) {
      if (landmarkFailures++ < 3) Log.w(TAG, "repères en erreur : repli sur le flou", e)
    } finally {
      crop?.recycle()
      landmarkBusy.set(false)
      shared.release()
    }
  }

  /**
   * Repères cohérents avec un visage BlazeFace de la même image : centre
   * proche, taille voisine, inclinaison des yeux à moins de 30°. Sans
   * BlazeFace (suivi par nos repères), seule la forme compte.
   */
  private fun matchesDetector(check: MeshCheck, rect: RectF, dets: List<Detection>): Boolean {
    if (dets.isEmpty()) return true
    for (d in dets) {
      val dw = d.bufferRect.width()
      val dist = kotlin.math.hypot(rect.centerX() - d.bufferRect.centerX(), rect.centerY() - d.bufferRect.centerY())
      if (dist > dw * MESH_MAX_OFFSET) continue
      val ratio = rect.width() / max(1f, dw)
      if (ratio < MESH_MIN_SIZE || ratio > MESH_MAX_SIZE) continue
      if (!d.roll.isNaN() && Angles.diff(check.roll, d.roll) > MAX_ROLL_DIFF) continue
      return true
    }
    return false
  }

  /**
   * Carré de côté `side` centré sur le visage, qui PEUT déborder de l'image
   * (jalon 2d) : le visage reste centré et à la même échelle même s'il sort
   * en partie du cadre ; le débord est complété en noir (`paddedCrop`).
   * Avant, le carré était rogné à l'image et décalé : visage excentré au bord.
   */
  private fun squareCrop(cx: Float, cy: Float, side: Float, w: Int, h: Int): Rect? {
    val s = min(side, 2f * max(w, h)).roundToInt()
    if (s < 32) return null
    val l = (cx - s / 2f).roundToInt()
    val t = (cy - s / 2f).roundToInt()
    val r = Rect(l, t, l + s, t + s)
    // Au moins un quart du carré dans l'image, sinon rien à chercher.
    val inter = Rect(r)
    if (!inter.intersect(0, 0, w, h) || inter.width() * inter.height() * 4 < s * s) return null
    return r
  }

  /**
   * Copie du carré `r` de `src`, bords hors image en noir, réduite à
   * `LANDMARK_CROP_MAX` px au plus (Face Landmarker travaille en 256 px :
   * pas de perte, et pas de grosses images de visage très proche à 17 i/s).
   */
  private fun paddedCrop(src: Bitmap, r: Rect): Bitmap {
    val inside = r.left >= 0 && r.top >= 0 && r.right <= src.width && r.bottom <= src.height
    if (inside && r.width() <= LANDMARK_CROP_MAX) {
      return Bitmap.createBitmap(src, r.left, r.top, r.width(), r.height())
    }
    val side = min(r.width(), LANDMARK_CROP_MAX)
    val out = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val c = android.graphics.Canvas(out)
    c.drawColor(android.graphics.Color.BLACK)
    c.scale(side.toFloat() / r.width(), side.toFloat() / r.height())
    c.drawBitmap(src, -r.left.toFloat(), -r.top.toFloat(), cropPaint)
    return out
  }

  private val cropPaint = android.graphics.Paint().apply { isFilterBitmap = true }

  /** Tampon → image redressée (inverse de `up.toBuffer`). */
  private fun bufferToUpright(up: Upright): Matrix = Matrix().also { up.toBuffer.invert(it) }

  /**
   * Vitesse propre du maillage (largeurs de visage / s) : centre et taille de
   * la silhouette depuis la passe précédente (≈ 60 ms). Elle voit la tête
   * qui hoche ou pivote, que la boîte BlazeFace suit mal ; elle fait grandir
   * le halo. Visage nouveau : vitesse prudente.
   */
  private fun meshSpeed(m: FaceMask, ts: Long): Float {
    var best: MeshTrack? = null
    var bestD = m.halfSize
    for (t in meshTracks) {
      val d = kotlin.math.hypot(t.cx - m.centerX, t.cy - m.centerY)
      if (d <= bestD && ts > t.ts && ts - t.ts <= MESH_TRACK_NS) {
        bestD = d
        best = t
      }
    }
    val t = best ?: return MESH_SPEED_UNKNOWN
    val dt = (ts - t.ts) / 1e9f
    val v = (bestD + kotlin.math.abs(m.halfSize - t.half)) / dt / max(1f, m.faceWidth)
    return v.coerceIn(0f, MESH_SPEED_MAX)
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
          // IMAGE : chaque passe repart de zéro sur le recadrage BlazeFace
          // (jalon 2b : le suivi du mode VIDEO restait accroché ~5 s à une
          // zone faussée après une occultation).
          .setRunningMode(RunningMode.IMAGE)
          .setNumFaces(MAX_FACES)
          .setMinFaceDetectionConfidence(MIN_CONFIDENCE)
          .setMinFacePresenceConfidence(MIN_CONFIDENCE)
          .setMinTrackingConfidence(MIN_CONFIDENCE)
          .setOutputFaceBlendshapes(false)
          .setOutputFacialTransformationMatrixes(false)
          .build()
        landmarker = FaceLandmarker.createFromOptions(context, options)
        delegate = if (d == Delegate.GPU) "GPU" else "CPU"
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
    /** Sondage d'orientation : après 30 analyses (≈ 1 s) sans visage, 1 image sur 5. */
    const val PROBE_AFTER_MISSES = 30
    const val PROBE_EVERY = 5
    /** Une autre rotation n'est adoptée qu'après 3 sondages d'affilée, score ≥ 0,8. */
    const val PROBE_CONFIRM = 3
    const val PROBE_MIN_SCORE = 0.8f
    /** Correction active : la rotation de CameraX est revérifiée 1 image sur 5. */
    const val RESET_CHECK_EVERY = 5L
    /**
     * Zone serrée sous le masque : boîte BlazeFace × 1,10 / 1,25, remontée de
     * 8 % (ne dépasse plus sous le menton ; même sûreté hors ligne).
     */
    const val CORE_W = 1.10f
    const val CORE_H = 1.25f
    const val CORE_UP = 0.08f
    /** Vitesse du maillage : passe précédente ≤ 250 ms ; inconnue → 1 largeur/s. */
    const val MESH_TRACK_NS = 250_000_000L
    const val MESH_SPEED_UNKNOWN = 1f
    const val MESH_SPEED_MAX = 4f
    /** Côté maximal du recadrage passé aux repères (px). */
    const val LANDMARK_CROP_MAX = 384
    /** Recadrage des repères : côté = 2 × la boîte BlazeFace (1,5 × nos repères). */
    const val ROI_SCALE = 2.0f
    const val ROI_SCALE_CONTINUE = 1.4f
    /** Passes d'affilée suivies par nos seuls repères (≈ 0,5 s). */
    const val LANDMARK_ONLY_MAX = 10
    /** Cohérence repères ↔ BlazeFace. */
    const val MESH_MAX_OFFSET = 0.35f
    const val MESH_MIN_SIZE = 0.55f
    const val MESH_MAX_SIZE = 1.7f
    const val MAX_ROLL_DIFF = 30f
    /** Pistes : appariement ≤ 0,6 largeur, oubli après 250 ms. */
    const val TRACK_MATCH = 0.6f
    const val TRACK_DROP_NS = 250_000_000L
    const val BETA_MIN = 0.25f
    const val BETA_MAX = 0.85f
  }
}
