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
 * taille de l'image caméra (1920 × 1080 ici) : le fil GL ne fait donc que
 * poser des images déjà prêtes (vignettes de flou / pixels, ellipse de flou,
 * masque pré-dessiné par le fil des repères), sans tracé ni découpe.
 * Une instance par OverlayEffect : un nouveau calque part transparent.
 */
internal class FaceMaskRenderer(
  private val store: FaceStore,
  private val landmarkStore: LandmarkStore,
  private val stats: NiaCameraStats,
  /** LIVE : chaque image dessinée tout de suite (file d'OverlayEffect = 0). */
  private val live: Boolean,
) {
  enum class Effect {
    BLUR,
    PIXELATE,
    /** Cagoule (jalon 2) : tête couverte, yeux voilés, bouche opaque. */
    SKI_MASK,
    /** Masque intégral (jalon 2) : visage couvert, yeux et bouche opaques. */
    FULL_MASK,
    ;

    val usesLandmarks: Boolean get() = this == SKI_MASK || this == FULL_MASK

    companion object {
      fun fromProp(value: String?): Effect = when (value) {
        "pixelate" -> PIXELATE
        "skimask" -> SKI_MASK
        "fullmask" -> FULL_MASK
        else -> BLUR
      }
    }
  }

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

  fun onDraw(frame: Frame): Boolean {
    val t0 = SystemClock.elapsedRealtimeNanos()
    val ts = frame.timestampNanos
    val size = frame.size
    val fx = effect

    val plan = if (detectorFailed) {
      FaceMaskPolicy.Plan(FaceMaskPolicy.Kind.COVER, emptyList(), store.latest(), -1, 0)
    } else {
      FaceMaskPolicy.plan(
        ts,
        store.snapshot(),
        if (fx.usesLandmarks) landmarkStore.snapshot() else emptyList(),
        live,
        fx.usesLandmarks,
        fx,
      )
    }

    val canvas = frame.overlayCanvas
    var masks = 0
    var landmarkAgeSum = 0L
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
      var lastSrc: FaceResult? = null
      for (item in plan.items) {
        if (item.src !== lastSrc) {
          if (lastSrc != null) canvas.restore()
          canvas.save()
          canvas.setMatrix(analysisToFrame(frame, item.src))
          lastSrc = item.src
        }
        val p = item.patch
        placed(p.rect, item.dx, item.dy, item.scale, dst)
        val m = item.mask
        if (m != null) {
          // 1. Filet de sécurité : flou elliptique de la zone du visage.
          canvas.drawBitmap(p.blurOval, null, dst, blurPaint)
          // 2. Masque pré-dessiné, suivi depuis ses repères.
          canvas.save()
          canvas.translate(item.maskCx, item.maskCy)
          canvas.scale(item.maskScale, item.maskScale)
          canvas.translate(-m.anchor.centerX(), -m.anchor.centerY())
          canvas.drawBitmap(m.sprite, m.spriteSrc, m.spriteRect, blurPaint)
          canvas.restore()
          masks++
          landmarkAgeSum += item.landmarkAgeNs
        } else if (pixelate) {
          canvas.drawBitmap(p.pixel, null, dst, pixelPaint)
        } else {
          // Flou, et repli des masques quand les repères manquent.
          canvas.drawBitmap(p.blur, null, dst, blurPaint)
        }
      }
      if (lastSrc != null) canvas.restore()
    }
    val now = SystemClock.elapsedRealtimeNanos()
    stats.onDrawCost((now - t0) / 1e6, size.width, size.height, frame.rotationDegrees)
    stats.onRendered(
      plan.kind, ts, now, System.nanoTime(),
      plan.analysisAgeNs, masks, if (masks > 0) landmarkAgeSum / masks else -1L, plan.fallbacks,
    )
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

  /** `r` déplacé de (dx, dy) puis agrandi de `s` autour de son centre. */
  private fun placed(r: RectF, dx: Float, dy: Float, s: Float, out: RectF) {
    val hw = r.width() * s / 2f
    val hh = r.height() * s / 2f
    val cx = r.centerX() + dx
    val cy = r.centerY() + dy
    out.set(cx - hw, cy - hh, cx + hw, cy + hh)
  }

  companion object {
    /** Noir chaud NIA, opaque. */
    val COVER_COLOR: Int = Color.rgb(0x0B, 0x0B, 0x0B)
    // Cagoule : tricot anthracite, voile noir maillé.
    val SKI_BASE: Int = Color.rgb(0x22, 0x22, 0x24)
    val SKI_RIB: Int = Color.rgb(0x30, 0x30, 0x33)
    val SKI_EDGE: Int = Color.rgb(0x16, 0x16, 0x17)
    val VEIL_BASE: Int = Color.rgb(0x0E, 0x0E, 0x0F)
    val VEIL_MESH: Int = Color.rgb(0x2A, 0x2A, 0x2C)
    val HOLE: Int = Color.rgb(0x10, 0x0C, 0x0B)
    // Masque intégral : ivoire, contour sable, accent or NIA.
    val FULL_BASE: Int = Color.rgb(0xEE, 0xE8, 0xDD)
    val FULL_EDGE: Int = Color.rgb(0xB9, 0xAE, 0x9C)
    val FULL_ACCENT: Int = Color.rgb(0xC8, 0x8A, 0x2E)
  }
}
