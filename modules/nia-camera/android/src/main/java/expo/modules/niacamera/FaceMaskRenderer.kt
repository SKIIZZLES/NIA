package expo.modules.niacamera

import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
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
  private val fillPaint = Paint().apply {
    style = Paint.Style.FILL
    isAntiAlias = true
  }
  private val strokePaint = Paint().apply {
    style = Paint.Style.STROKE
    isAntiAlias = true
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val path = Path()
  private val clip = Path()
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
            val mask = p.mask
            if (fx.usesLandmarks && mask != null) {
              drawMasked(canvas, p, mask, plan.scale, fx)
            } else {
              scaled(p.rect, plan.scale, dst)
              if (pixelate) {
                canvas.drawBitmap(p.pixel, null, dst, pixelPaint)
              } else {
                // Flou, et repli des masques quand les repères manquent.
                canvas.drawBitmap(p.blur, null, dst, blurPaint)
              }
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

  /**
   * Masque à repères, en coordonnées du tampon d'analyse. Dessous, toujours
   * le flou de la zone agrandie du visage (ellipse) : un décalage des repères
   * (profil, mouvement rapide) ne laisse jamais voir le visage net.
   */
  private fun drawMasked(canvas: android.graphics.Canvas, p: FacePatch, m: FaceMask, scale: Float, fx: Effect) {
    canvas.save()
    if (scale != 1f) canvas.scale(scale, scale, p.rect.centerX(), p.rect.centerY())
    // 1. Filet de sécurité : flou elliptique de la zone du visage.
    clip.reset()
    clip.addOval(p.rect, Path.Direction.CW)
    canvas.save()
    canvas.clipPath(clip)
    canvas.drawBitmap(p.blur, null, p.rect, blurPaint)
    canvas.restore()

    val line = m.faceWidth
    if (fx == Effect.SKI_MASK) {
      // 2. Cagoule opaque, côtes du tricot.
      polygon(m.hood)
      fillPaint.color = SKI_BASE
      canvas.drawPath(path, fillPaint)
      canvas.save()
      canvas.clipPath(path)
      strokePaint.color = SKI_RIB
      strokePaint.strokeWidth = line * 0.035f
      canvas.drawLines(m.ribs, strokePaint)
      canvas.restore()
      strokePaint.color = SKI_EDGE
      strokePaint.strokeWidth = line * 0.03f
      canvas.drawPath(path, strokePaint)
      // 3. Yeux voilés : bandeau opaque maillé (les yeux ne se voient pas).
      polygon(m.eyeBand)
      fillPaint.color = VEIL_BASE
      canvas.drawPath(path, fillPaint)
      canvas.save()
      canvas.clipPath(path)
      strokePaint.color = VEIL_MESH
      strokePaint.strokeWidth = line * 0.012f
      canvas.drawLines(m.mesh, strokePaint)
      canvas.restore()
      strokePaint.color = SKI_EDGE
      strokePaint.strokeWidth = line * 0.025f
      canvas.drawPath(path, strokePaint)
      // 4. Bouche : ouverture opaque qui suit les lèvres.
      polygon(m.mouth)
      fillPaint.color = HOLE
      canvas.drawPath(path, fillPaint)
      strokePaint.color = SKI_EDGE
      strokePaint.strokeWidth = line * 0.02f
      canvas.drawPath(path, strokePaint)
    } else {
      // 2. Masque intégral opaque.
      polygon(m.full)
      fillPaint.color = FULL_BASE
      canvas.drawPath(path, fillPaint)
      strokePaint.color = FULL_EDGE
      strokePaint.strokeWidth = line * 0.035f
      canvas.drawPath(path, strokePaint)
      // 3. Yeux et bouche opaques (le masque plein est dessous).
      fillPaint.color = HOLE
      polygon(m.leftEye)
      canvas.drawPath(path, fillPaint)
      polygon(m.rightEye)
      canvas.drawPath(path, fillPaint)
      polygon(m.mouth)
      canvas.drawPath(path, fillPaint)
      strokePaint.color = FULL_ACCENT
      strokePaint.strokeWidth = line * 0.03f
      polygon(m.leftEye)
      canvas.drawPath(path, strokePaint)
      polygon(m.rightEye)
      canvas.drawPath(path, strokePaint)
    }
    canvas.restore()
  }

  /** `path` ← polygone lissé (courbes par les milieux des côtés). */
  private fun polygon(pts: FloatArray) {
    path.reset()
    val n = pts.size / 2
    if (n < 3) return
    val lx = pts[2 * (n - 1)]
    val ly = pts[2 * (n - 1) + 1]
    path.moveTo((lx + pts[0]) / 2f, (ly + pts[1]) / 2f)
    for (k in 0 until n) {
      val x = pts[2 * k]
      val y = pts[2 * k + 1]
      val nx = pts[2 * ((k + 1) % n)]
      val ny = pts[2 * ((k + 1) % n) + 1]
      path.quadTo(x, y, (x + nx) / 2f, (y + ny) / 2f)
    }
    path.close()
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
    /** Redessin forcé au moins une image sur trois (calque jamais périmé). */
    const val MAX_SKIPS = 2
  }
}
