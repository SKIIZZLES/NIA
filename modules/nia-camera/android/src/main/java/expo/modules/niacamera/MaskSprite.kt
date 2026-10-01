package expo.modules.niacamera

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.RectF
import android.os.SystemClock
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Pré-rendu des masques (jalon 2b), HORS du fil GL : le fil des repères
 * dessine une fois la cagoule / le masque intégral (tracés, côtes, maille,
 * yeux, bouche) dans une petite image à fond transparent ; le fil GL ne fait
 * plus que la poser (un seul drawBitmap par visage). Idem pour l'ellipse de
 * flou posée sous chaque masque, préparée par le fil d'analyse.
 */
internal object MaskSprite {
  /** Résolution du sprite : 2 px par px du tampon d'analyse (~640 px). */
  const val SCALE = 2f
  /** Sprites de taille fixe, réutilisés (pas 40 Mo/s d'images à jeter). */
  const val SIDE = 576
  /** Un sprite sorti du magasin n'est réécrit qu'après ce délai (fil GL). */
  const val REUSE_AFTER_NS = 250_000_000L
  const val POOL_MAX = 12
  /** Ellipse de flou : petite, agrandie avec lissage (c'est un flou). */
  const val OVAL_SIDE = 48
  /** Plume de l'ellipse (px de la vignette) : bord doux, jamais une arête. */
  const val OVAL_FEATHER = 3f
  /** Halo (flou plumé épousant la silhouette) : petit, agrandi avec lissage. */
  const val HALO_SIDE = 72
  /** Cases du flou du halo (comme les vignettes de flou BlazeFace). */
  const val HALO_CELLS = 5
  /** Ovale de la tête (2f) : plus grand côté du sprite de flou ; px du sprite par case de pixels. */
  const val HEAD_BLUR_SIDE = 96
  const val HEAD_PIXEL_PER_CELL = 8
  const val HEAD_MAX_SIDE = 400

  class Sprite(val bitmap: Bitmap, val src: Rect, val rect: RectF)

  /** Fil des repères uniquement. */
  class Pool {
    private val free = ArrayDeque<Pair<Long, Bitmap>>()

    fun retire(bitmaps: List<Bitmap>) {
      val now = SystemClock.elapsedRealtimeNanos()
      for (b in bitmaps) {
        if (free.size >= POOL_MAX) break
        free.addLast(now to b)
      }
    }

    fun obtain(): Bitmap {
      val head = free.firstOrNull()
      if (head != null && SystemClock.elapsedRealtimeNanos() - head.first >= REUSE_AFTER_NS) {
        free.removeFirst()
        head.second.eraseColor(Color.TRANSPARENT)
        return head.second
      }
      return Bitmap.createBitmap(SIDE, SIDE, Bitmap.Config.ARGB_8888)
    }
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
  /**
   * Flou peint DANS une forme, à bord plumé (jalon 2e). Le flou est la
   * texture (BitmapShader) d'un pinceau qui remplit la forme, flou de bord
   * compris : rien n'est jamais peint hors de la forme.
   *
   * Jalons 2c–2d : le flou couvrait toute l'image du sprite, puis une forme
   * en DST_IN devait effacer le reste. Mais Skia n'applique un mode de
   * fusion que là où la forme dessine : les coins gardaient le flou entier.
   * Chaque « ellipse » ou « halo » était donc posé en RECTANGLE flou à bords
   * droits (vu au téléphone ; vérifié avec Skia : 10 000 px opaques sur
   * 10 000).
   */
  private fun blurFill(blur: Bitmap, dst: RectF, featherPx: Float, filter: Boolean = true): Paint {
    val m = Matrix().apply {
      setRectToRect(RectF(0f, 0f, blur.width.toFloat(), blur.height.toFloat()), dst, Matrix.ScaleToFit.FILL)
    }
    return Paint().apply {
      isAntiAlias = true
      isFilterBitmap = filter
      shader = BitmapShader(blur, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply { setLocalMatrix(m) }
      if (featherPx > 0f) maskFilter = BlurMaskFilter(featherPx, BlurMaskFilter.Blur.NORMAL)
    }
  }

  /** Masque `fx` (cagoule / intégral) en sprite ; fil des repères uniquement. */
  fun render(m: FaceMask, fx: FaceMaskRenderer.Effect, pool: Pool): Sprite? {
    val outline = if (fx == FaceMaskRenderer.Effect.SKI_MASK) m.hood else m.full
    val bounds = boundsOf(outline) ?: return null
    val margin = m.faceWidth * 0.05f
    bounds.inset(-margin, -margin)
    val k = min(SCALE, (SIDE - 2) / max(bounds.width(), bounds.height()))
    val bw = min(SIDE, max(1, ceil(bounds.width() * k).toInt()))
    val bh = min(SIDE, max(1, ceil(bounds.height() * k).toInt()))
    val bmp = pool.obtain()
    val c = Canvas(bmp)
    c.clipRect(0, 0, bw, bh)
    c.scale(k, k)
    c.translate(-bounds.left, -bounds.top)
    val path = Path()
    val line = m.faceWidth
    if (fx == FaceMaskRenderer.Effect.SKI_MASK) {
      // Cagoule opaque, côtes du tricot.
      polygon(m.hood, path)
      fillPaint.color = FaceMaskRenderer.SKI_BASE
      c.drawPath(path, fillPaint)
      c.save()
      c.clipPath(path)
      strokePaint.color = FaceMaskRenderer.SKI_RIB
      strokePaint.strokeWidth = line * 0.035f
      c.drawLines(m.ribs, strokePaint)
      c.restore()
      strokePaint.color = FaceMaskRenderer.SKI_EDGE
      strokePaint.strokeWidth = line * 0.03f
      c.drawPath(path, strokePaint)
      // Yeux voilés : bandeau opaque maillé.
      polygon(m.eyeBand, path)
      fillPaint.color = FaceMaskRenderer.VEIL_BASE
      c.drawPath(path, fillPaint)
      c.save()
      c.clipPath(path)
      strokePaint.color = FaceMaskRenderer.VEIL_MESH
      strokePaint.strokeWidth = line * 0.012f
      c.drawLines(m.mesh, strokePaint)
      c.restore()
      strokePaint.color = FaceMaskRenderer.SKI_EDGE
      strokePaint.strokeWidth = line * 0.025f
      c.drawPath(path, strokePaint)
      // Bouche opaque.
      polygon(m.mouth, path)
      fillPaint.color = FaceMaskRenderer.HOLE
      c.drawPath(path, fillPaint)
      strokePaint.color = FaceMaskRenderer.SKI_EDGE
      strokePaint.strokeWidth = line * 0.02f
      c.drawPath(path, strokePaint)
    } else {
      // Masque intégral épousant le visage : silhouette, relief (sourcils,
      // nez), yeux et bouche sur les vrais contours, découpés par la
      // silhouette (de profil, rien ne dépasse du masque).
      val outlinePath = Path()
      polygon(m.full, outlinePath)
      fillPaint.color = FaceMaskRenderer.FULL_BASE
      c.drawPath(outlinePath, fillPaint)
      c.save()
      c.clipPath(outlinePath)
      strokePaint.color = FaceMaskRenderer.FULL_LINE
      strokePaint.strokeWidth = line * 0.022f
      c.drawLines(m.features, strokePaint)
      fillPaint.color = FaceMaskRenderer.HOLE
      for (pts in arrayOf(m.leftEye, m.rightEye, m.mouth)) {
        polygon(pts, path)
        c.drawPath(path, fillPaint)
      }
      strokePaint.color = FaceMaskRenderer.FULL_ACCENT
      strokePaint.strokeWidth = line * 0.028f
      for (pts in arrayOf(m.leftEye, m.rightEye)) {
        polygon(pts, path)
        c.drawPath(path, strokePaint)
      }
      strokePaint.color = FaceMaskRenderer.FULL_EDGE
      strokePaint.strokeWidth = line * 0.02f
      polygon(m.mouth, path)
      c.drawPath(path, strokePaint)
      c.restore()
      strokePaint.color = FaceMaskRenderer.FULL_EDGE
      strokePaint.strokeWidth = line * 0.03f
      c.drawPath(outlinePath, strokePaint)
    }
    return Sprite(bmp, Rect(0, 0, bw, bh), bounds)
  }

  /**
   * Flou `blur` découpé en ellipse plumée (bord doux, pas d'arête) : filet
   * de sécurité sous les masques et repli quand les repères manquent.
   */
  /**
   * Où poser `blurOval` pour que la mi-opacité de son ellipse (en retrait de
   * 2 × OVAL_FEATHER dans le sprite, plume comprise) suive l'ellipse inscrite
   * dans `rect` : `rect` agrandi d'autant autour de son centre.
   */
  fun ovalFill(oval: Bitmap, rect: RectF, out: RectF) = ovalScale(oval, rect, out, true)

  /** Inverse de [ovalFill] : ellipse visible (mi-opacité) de `blurOval` posé dans `rect`. */
  fun ovalVisible(oval: Bitmap, rect: RectF, out: RectF) = ovalScale(oval, rect, out, false)

  private fun ovalScale(oval: Bitmap, rect: RectF, out: RectF, grow: Boolean) {
    var kx = oval.width / max(1f, oval.width - 4f * OVAL_FEATHER)
    var ky = oval.height / max(1f, oval.height - 4f * OVAL_FEATHER)
    if (!grow) {
      kx = 1f / kx
      ky = 1f / ky
    }
    val hw = rect.width() * kx / 2f
    val hh = rect.height() * ky / 2f
    out.set(rect.centerX() - hw, rect.centerY() - hh, rect.centerX() + hw, rect.centerY() + hh)
  }

  fun blurOval(blur: Bitmap, rect: RectF): Bitmap {
    val aspect = if (rect.width() > 0f) rect.height() / rect.width() else 1f
    val w = if (aspect <= 1f) OVAL_SIDE else max(8, (OVAL_SIDE / aspect).toInt())
    val h = if (aspect <= 1f) max(8, (OVAL_SIDE * aspect).toInt()) else OVAL_SIDE
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val full = RectF(0f, 0f, w.toFloat(), h.toFloat())
    // La plume s'étend d'environ 2 × son rayon autour du bord : l'ellipse
    // est rentrée d'autant pour finir à zéro AVANT le bord de l'image (sinon
    // le bord de l'image ferait une arête droite).
    val oval = RectF(full).apply { inset(OVAL_FEATHER * 2f, OVAL_FEATHER * 2f) }
    c.drawOval(oval, blurFill(blur, full, OVAL_FEATHER))
    return bmp
  }

  /**
   * Halo du masque : le flou de la zone, découpé à la silhouette élargie
   * (`m.fullHalo` / `m.hoodHalo`) avec une plume douce. Posé sous le masque
   * avec la même transformation, il couvre ses bords sans grand rectangle ni
   * grande ellipse floue autour de la tête. Fil des repères uniquement.
   */
  fun renderHalo(m: FaceMask, fx: FaceMaskRenderer.Effect, buffer: Bitmap, shrink: (Rect, Int) -> Bitmap?): Sprite? {
    val halo = if (fx == FaceMaskRenderer.Effect.SKI_MASK) m.hoodHalo else m.fullHalo
    val bounds = boundsOf(halo) ?: return null
    val feather = m.faceWidth * MaskGeometry.FEATHER
    bounds.inset(-feather * 2f, -feather * 2f)
    val crop = Rect(
      max(0, bounds.left.toInt()), max(0, bounds.top.toInt()),
      min(buffer.width, ceil(bounds.right).toInt()), min(buffer.height, ceil(bounds.bottom).toInt()),
    )
    if (crop.width() < 2 || crop.height() < 2) return null
    val blur = shrink(crop, HALO_CELLS) ?: return null
    val k = HALO_SIDE / max(bounds.width(), bounds.height())
    val bw = max(2, ceil(bounds.width() * k).toInt())
    val bh = max(2, ceil(bounds.height() * k).toInt())
    val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    c.scale(k, k)
    c.translate(-bounds.left, -bounds.top)
    // Flou de la zone réellement dans l'image, peint dans la silhouette
    // élargie, bord plumé (la marge `bounds` laisse la plume finir à zéro).
    val path = Path()
    polygon(halo, path)
    c.drawPath(path, blurFill(blur, RectF(crop), feather))
    blur.recycle()
    return Sprite(bmp, Rect(0, 0, bw, bh), bounds)
  }

  /**
   * Ovale de la tête (jalon 2f, modes Flou et Pixels) en sprite, sur le fil
   * d'analyse. `tiny` : vignette de flou ou de pixels de `crop` (tampon).
   * Le flou est PEINT dans la forme (shader + BlurMaskFilter, comme au 2e ;
   * jamais un dessin plein découpé ensuite) : hors de la forme, le sprite est
   * transparent. Le chemin est la forme de sécurité agrandie de 2,33 σ + 1 px :
   * l'opacité y est ≥ 99 % partout dans la forme de sécurité, et le fondu est
   * entièrement au-dehors. `side` : plus grand côté de la forme, en px du
   * sprite ; `nearest` : pixels nets (mode Pixels).
   */
  fun headSprite(tiny: Bitmap, crop: Rect, head: HeadOval, side: Int, nearest: Boolean): Sprite? {
    val b0 = boundsOf(head.polygon()) ?: return null
    val k = side / max(b0.width(), b0.height())
    val rS = HeadOval.HEAD_FEATHER * head.faceWidthBuffer * k
    val sigma = rS * 0.57735f + 0.5f
    val grow = (2.33f * sigma + 1f) / k
    val drawn = head.polygon(grow / head.bufferScale)
    val b = boundsOf(drawn) ?: return null
    val margin = (3f * sigma + 2f) / k
    b.inset(-margin, -margin)
    val bw = max(2, ceil(b.width() * k).toInt())
    val bh = max(2, ceil(b.height() * k).toInt())
    if (bw > HEAD_MAX_SIDE || bh > HEAD_MAX_SIDE) return null
    val pts = FloatArray(drawn.size)
    for (i in drawn.indices step 2) {
      pts[i] = (drawn[i] - b.left) * k
      pts[i + 1] = (drawn[i + 1] - b.top) * k
    }
    val path = Path()
    path.moveTo(pts[0], pts[1])
    for (i in 2 until pts.size step 2) path.lineTo(pts[i], pts[i + 1])
    path.close()
    val dst = RectF((crop.left - b.left) * k, (crop.top - b.top) * k, (crop.right - b.left) * k, (crop.bottom - b.top) * k)
    val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
    Canvas(bmp).drawPath(path, blurFill(tiny, dst, rS, !nearest))
    return Sprite(bmp, Rect(0, 0, bw, bh), RectF(b.left, b.top, b.left + bw / k, b.top + bh / k))
  }

  fun boundsOf(pts: FloatArray): RectF? {
    if (pts.size < 6) return null
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
    return if (x1 - x0 >= 2f && y1 - y0 >= 2f) RectF(x0, y0, x1, y1) else null
  }

  /** Polygone lissé (courbes par les milieux des côtés). */
  private fun polygon(pts: FloatArray, path: Path) {
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
}
