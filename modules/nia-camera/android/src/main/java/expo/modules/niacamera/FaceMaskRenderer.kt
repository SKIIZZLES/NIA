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
    isAntiAlias = true
    isDither = true
  }
  private val tmpMatrix = Matrix()
  private val inverse = Matrix()
  private val dst = RectF()

  fun onDraw(frame: Frame): Boolean {
    val ts = frame.timestampNanos
    val canvas = frame.overlayCanvas
    canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)

    val plan = if (detectorFailed) {
      FaceMaskPolicy.Plan(FaceMaskPolicy.Kind.COVER, emptyList(), 1f, store.latest())
    } else {
      FaceMaskPolicy.plan(ts, store.snapshot())
    }

    if (plan.kind == FaceMaskPolicy.Kind.COVER) {
      // Fond opaque d'abord : couvre tout, même si le champ de l'analyse
      // était plus étroit que celui de la vidéo.
      canvas.drawColor(COVER_COLOR)
      val src = plan.coverSource
      if (src != null) {
        canvas.save()
        canvas.setMatrix(analysisToFrame(frame, src))
        dst.set(0f, 0f, src.bufferWidth.toFloat(), src.bufferHeight.toFloat())
        canvas.drawBitmap(src.frameTiny, null, dst, blurPaint)
        canvas.restore()
      }
    } else {
      val pixelate = effect == Effect.PIXELATE
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
    stats.onRendered(plan.kind, ts, SystemClock.elapsedRealtimeNanos(), System.nanoTime())
    return true
  }

  /** Tampon d'analyse → capteur → tampon de l'image affichée / enregistrée. */
  private fun analysisToFrame(frame: Frame, src: FaceResult): Matrix {
    tmpMatrix.set(frame.sensorToBufferTransform)
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
  }
}
