package expo.modules.niacamera

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
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
  private val bitmapPaint = Paint().apply { isFilterBitmap = true }
  private val dstIn = Paint().apply {
    isAntiAlias = true
    xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
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
      polygon(m.full, path)
      fillPaint.color = FaceMaskRenderer.FULL_BASE
      c.drawPath(path, fillPaint)
      strokePaint.color = FaceMaskRenderer.FULL_EDGE
      strokePaint.strokeWidth = line * 0.035f
      c.drawPath(path, strokePaint)
      fillPaint.color = FaceMaskRenderer.HOLE
      for (pts in arrayOf(m.leftEye, m.rightEye, m.mouth)) {
        polygon(pts, path)
        c.drawPath(path, fillPaint)
      }
      strokePaint.color = FaceMaskRenderer.FULL_ACCENT
      strokePaint.strokeWidth = line * 0.03f
      for (pts in arrayOf(m.leftEye, m.rightEye)) {
        polygon(pts, path)
        c.drawPath(path, strokePaint)
      }
    }
    return Sprite(bmp, Rect(0, 0, bw, bh), bounds)
  }

  /** Flou `blur` découpé en ellipse aux bords doux (sous les masques). */
  fun blurOval(blur: Bitmap, rect: RectF): Bitmap {
    val aspect = if (rect.width() > 0f) rect.height() / rect.width() else 1f
    val w = if (aspect <= 1f) OVAL_SIDE else max(8, (OVAL_SIDE / aspect).toInt())
    val h = if (aspect <= 1f) max(8, (OVAL_SIDE * aspect).toInt()) else OVAL_SIDE
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val r = RectF(0f, 0f, w.toFloat(), h.toFloat())
    c.drawBitmap(blur, null, r, bitmapPaint)
    c.drawOval(r, dstIn.apply { color = Color.BLACK })
    return bmp
  }

  private fun boundsOf(pts: FloatArray): RectF? {
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
