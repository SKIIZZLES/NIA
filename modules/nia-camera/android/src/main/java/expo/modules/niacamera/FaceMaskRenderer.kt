package expo.modules.niacamera

import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.os.SystemClock
import androidx.camera.effects.Frame

/**
 * Dessin sur chaque image, appelé par OverlayEffect sur son fil GL, juste
 * avant qu'elle parte vers l'aperçu ET l'encodeur vidéo : ce qui est dessiné
 * ici est cuit dans le fichier. Toujours opaque, jamais d'image « nue ».
 *
 * Le canevas d'OverlayEffect est LOGICIEL (Surface.lockCanvas) et fait la
 * taille de l'image caméra : chaque passe plein cadre coûte cher sur le fil
 * GL. On ne redessine donc que si le contenu change (le calque précédent
 * reste sinon appliqué tel quel, au plus [MAX_SKIPS] images de suite), et en
 * un minimum de passes. Une instance par OverlayEffect : un nouveau calque
 * part transparent, il ne doit jamais hériter du « déjà dessiné ».
 */
internal class FaceMaskRenderer(
  private val store: FaceStore,
  private val stats: NiaCameraStats,
) {
  enum class Effect { BLUR, PIXELATE }

  @Volatile
  var effect: Effect = Effect.BLUR

  /** Détecteur hors service : tout est couvert. */
  @Volatile
  var detectorFailed = false

  private val pixelPaint = Paint().apply {
    isFilterBitmap = false
    isAntiAlias = false
    isDither = false
  }
  private val blurPaint = Paint().apply {
    isFilterBitmap = true
    isAntiAlias = false
    isDither = false
  }
  private val tmpMatrix = Matrix()
  private val inverse = Matrix()
  private val dst = RectF()
  private val srcRect = RectF()
  private val frameRect = RectF()

  // Dernier contenu effectivement posé sur le calque.
  private var lastKind: FaceMaskPolicy.Kind? = null
  private var lastSources: List<FaceResult> = emptyList()
  private var lastCover: FaceResult? = null
  private var lastEffect: Effect? = null
  private var lastScale = 0f
  private var lastW = 0
  private var lastH = 0
  private var skipStreak = 0

  fun onDraw(frame: Frame): Boolean {
    val t0 = SystemClock.elapsedRealtimeNanos()
    val ts = frame.timestampNanos
    val size = frame.size

    val plan = if (detectorFailed) {
      FaceMaskPolicy.Plan(FaceMaskPolicy.Kind.COVER, emptyList(), 1f, store.latest())
    } else {
      FaceMaskPolicy.plan(ts, store.snapshot())
    }
    val fx = effect

    val same = plan.kind == lastKind &&
      fx == lastEffect &&
      plan.scale == lastScale &&
      size.width == lastW && size.height == lastH &&
      plan.coverSource === lastCover &&
      sameRefs(plan.sources, lastSources) &&
      skipStreak < MAX_SKIPS

    if (same) {
      skipStreak++
    } else {
      skipStreak = 0
      val canvas = frame.overlayCanvas
      if (plan.kind == FaceMaskPolicy.Kind.COVER) {
        // Une seule passe opaque (SRC : pas de mélange), puis l'image
        // entière réduite, agrandie avec lissage = flou plein cadre.
        canvas.drawColor(COVER_COLOR, PorterDuff.Mode.SRC)
        val src = plan.coverSource
        if (src != null) {
          canvas.save()
          canvas.setMatrix(analysisToFrame(frame, src))
          dst.set(0f, 0f, src.bufferWidth.toFloat(), src.bufferHeight.toFloat())
          canvas.drawBitmap(src.frameTiny, null, dst, blurPaint)
          canvas.restore()
        }
      } else {
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        val pixelate = fx == Effect.PIXELATE
        for (src in plan.sources) {
          canvas.save()
          canvas.setMatrix(analysisToFrame(frame, src))
          for (p in src.faces) {
            scaled(p.rect, plan.scale, dst)
            if (pixelate) {
              canvas.drawBitmap(p.pixel, null, dst, pixelPaint)
            } else {
              canvas.drawBitmap(p.blur, null, dst, blurPaint)
            }
          }
          canvas.restore()
        }
      }
      lastKind = plan.kind
      lastEffect = fx
      lastScale = plan.scale
      lastW = size.width
      lastH = size.height
      lastCover = plan.coverSource
      lastSources = plan.sources
    }
    val now = SystemClock.elapsedRealtimeNanos()
    stats.onDrawCost((now - t0) / 1e6, same, size.width, size.height, frame.rotationDegrees)
    stats.onRendered(plan.kind, ts, now, System.nanoTime())
    return true
  }

  private fun sameRefs(a: List<FaceResult>, b: List<FaceResult>): Boolean {
    if (a.size != b.size) return false
    for (i in a.indices) if (a[i] !== b[i]) return false
    return true
  }

  /** Tampon d'analyse → capteur → tampon de l'image affichée / enregistrée. */
  private fun analysisToFrame(frame: Frame, src: FaceResult): Matrix {
    val frameToSensor = frame.sensorToBufferTransform
    if (src.sensorToBuffer.isIdentity || frameToSensor.isIdentity) {
      // Matrices CameraX absentes : les deux tampons sont dans l'orientation
      // du capteur, on étire l'un sur l'autre (le fond opaque couvre le reste).
      srcRect.set(0f, 0f, src.bufferWidth.toFloat(), src.bufferHeight.toFloat())
      frameRect.set(0f, 0f, frame.size.width.toFloat(), frame.size.height.toFloat())
      tmpMatrix.setRectToRect(srcRect, frameRect, Matrix.ScaleToFit.FILL)
      return tmpMatrix
    }
    tmpMatrix.set(frameToSensor)
    src.sensorToBuffer.invert(inverse)
    tmpMatrix.preConcat(inverse)
    return tmpMatrix
  }

  private fun scaled(r: RectF, s: Float, out: RectF) {
    val hw = r.width() * s / 2f
    val hh = r.height() * s / 2f
    out.set(r.centerX() - hw, r.centerY() - hh, r.centerX() + hw, r.centerY() + hh)
  }

  companion object {
    /** Noir chaud NIA, opaque. */
    val COVER_COLOR: Int = Color.rgb(0x0B, 0x0B, 0x0B)
    /** Redessin forcé au moins une image sur trois (calque jamais périmé). */
    const val MAX_SKIPS = 2
  }
}
