package expo.modules.niacamera

import android.graphics.Matrix
import android.graphics.RectF
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Formes des masques (A1, jalon 2), calculées sur le fil des repères à partir
 * des 478 repères MediaPipe Face Landmarker, puis ramenées dans les
 * coordonnées du tampon d'analyse. Le rendu (fil GL) ne fait que poser le
 * sprite qui en est tiré.
 *
 * Jalon 2d (« inspire de mon visage ») : le masque épouse le visage réel.
 *  - Contour = enveloppe convexe des 468 points du maillage, à peine
 *    élargie : c'est la vraie silhouette du visage (mâchoire, joues, front)
 *    quelle que soit la pose. L'anneau FACE_OVAL de MediaPipe n'est PAS la
 *    silhouette de profil : tête tournée, son côté éloigné passe en travers
 *    du visage (masque en croissant, œil et bouche hors du masque, vu sur
 *    17 images de la vidéo de référence).
 *  - Trous des yeux et bouche = contours des paupières et des lèvres,
 *    élargis dans leur propre repère, avec une hauteur minimale en amande
 *    (jamais une fente).
 *  - Sourcils et arête du nez en traits fins : le masque reprend le relief.
 *  - Halo : la même silhouette un peu plus grande, pour le flou plumé posé
 *    sous le masque (remplace la grande ellipse de flou).
 */
internal class FaceMask(
  /** Cagoule : silhouette très élargie (front, cheveux, oreilles, cou). */
  val hood: FloatArray,
  /** Masque intégral : silhouette du visage à peine élargie. */
  val full: FloatArray,
  /** Halos (flou plumé sous le masque) de la cagoule / du masque intégral. */
  val hoodHalo: FloatArray,
  val fullHalo: FloatArray,
  /** Bandeau des yeux de la cagoule (voile opaque maillé). */
  val eyeBand: FloatArray,
  /** Trous des yeux du masque intégral (opaques, foncés), sur les paupières. */
  val leftEye: FloatArray,
  val rightEye: FloatArray,
  /** Bouche (opaque, suit les lèvres et leur ouverture). */
  val mouth: FloatArray,
  /** Côtes du tricot (segments x0,y0,x1,y1…), à découper par la cagoule. */
  val ribs: FloatArray,
  /** Maille du voile des yeux (segments), à découper par le bandeau. */
  val mesh: FloatArray,
  /** Relief du masque intégral : sourcils, arête et base du nez (segments). */
  val features: FloatArray,
  /** Largeur du visage (px du tampon) : épaisseur des traits, plume du halo. */
  val faceWidth: Float,
  /** Emprise de la silhouette dans le tampon (ancrage, repli). */
  val bounds: RectF,
  /** Centre de la silhouette et sa demi-taille (tampon) : vitesse du maillage. */
  val centerX: Float,
  val centerY: Float,
  val halfSize: Float,
)

internal object MaskGeometry {
  // Indices MediaPipe (face mesh 468 + iris).
  val FACE_OVAL = intArrayOf(
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  )
  // Contours : coin, bord inférieur, coin, bord supérieur (ordre MediaPipe).
  val LEFT_EYE = intArrayOf(33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246)
  val RIGHT_EYE = intArrayOf(263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466)
  val LIPS = intArrayOf(61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185)
  val BROW_L = intArrayOf(70, 63, 105, 66, 107)
  val BROW_R = intArrayOf(300, 293, 334, 296, 336)
  val NOSE = intArrayOf(168, 6, 197, 195, 5, 4)
  val NOSE_BASE = intArrayOf(98, 97, 2, 326, 327)
  const val MESH_POINTS = 468
  const val TOP = 10
  const val CHIN = 152
  const val CHEEK_A = 234
  const val CHEEK_B = 454

  // Élargissements de la silhouette (repère du visage : côtés, haut, bas).
  const val HOOD_SIDE = 1.30f
  const val HOOD_UP = 1.65f
  const val HOOD_DOWN = 1.22f
  const val FULL_SIDE = 1.06f
  const val FULL_UP = 1.08f
  const val FULL_DOWN = 1.04f
  /** Halo : silhouette + 12 % (cœur opaque), puis plume de 5 % de la largeur. */
  const val HALO_PAD = 0.12f
  const val FEATHER = 0.05f
  // Trous : élargissement le long du coin → coin, hauteur ×, hauteur minimale
  // (fraction de la demi-largeur : rapport largeur / hauteur ≤ 2,8 yeux, ≤ 3,6 bouche).
  const val EYE_B = 1.25f
  const val EYE_A = 1.5f
  const val EYE_MIN = 0.36f
  const val MOUTH_B = 1.12f
  const val MOUTH_A = 1.25f
  const val MOUTH_MIN = 0.28f
  /** Garde-fou : trou plus étiré que ça (contour dégénéré) → pas de masque. */
  const val MAX_HOLE_ASPECT = 3.7f

  /** Repère local : centre, axe droite, axe haut (unitaires, px redressés). */
  private class Frame(val cx: Float, val cy: Float, val rx: Float, val ry: Float, val ux: Float, val uy: Float) {
    fun b(x: Float, y: Float) = (x - cx) * rx + (y - cy) * ry
    fun a(x: Float, y: Float) = (x - cx) * ux + (y - cy) * uy
    fun wx(b: Float, a: Float) = cx + rx * b + ux * a
    fun wy(b: Float, a: Float) = cy + ry * b + uy * a
  }

  /**
   * Enveloppe convexe (chaîne monotone d'Andrew) des points (x,y…) ; renvoie
   * les sommets dans l'ordre du contour.
   */
  fun hull(xs: FloatArray, ys: FloatArray): FloatArray {
    val n = xs.size
    if (n < 3) return FloatArray(0)
    val order = (0 until n).sortedWith(compareBy<Int>({ xs[it] }, { ys[it] }))
    fun cross(o: Int, a: Int, b: Int) =
      (xs[a] - xs[o]) * (ys[b] - ys[o]) - (ys[a] - ys[o]) * (xs[b] - xs[o])
    val h = IntArray(2 * n)
    var k = 0
    for (i in order) {
      while (k >= 2 && cross(h[k - 2], h[k - 1], i) <= 0f) k--
      h[k++] = i
    }
    val lower = k + 1
    for (idx in order.indices.reversed()) {
      val i = order[idx]
      while (k >= lower && cross(h[k - 2], h[k - 1], i) <= 0f) k--
      h[k++] = i
    }
    val m = k - 1
    val out = FloatArray(m * 2)
    for (j in 0 until m) {
      out[2 * j] = xs[h[j]]
      out[2 * j + 1] = ys[h[j]]
    }
    return out
  }

  /**
   * `lm` : repères normalisés sur l'image `uw × uh` (le recadrage) ; `toBuffer` :
   * recadrage → tampon d'analyse. Null si les repères sont inutilisables.
   */
  fun build(lm: List<NormalizedLandmark>, uw: Float, uh: Float, toBuffer: Matrix): FaceMask? {
    if (lm.size < MESH_POINTS) return null
    fun px(i: Int) = lm[i].x() * uw
    fun py(i: Int) = lm[i].y() * uh

    // Centre = barycentre du contour.
    var sx = 0f
    var sy = 0f
    for (i in FACE_OVAL) {
      sx += px(i); sy += py(i)
    }
    val cx = sx / FACE_OVAL.size
    val cy = sy / FACE_OVAL.size
    var ux = px(TOP) - px(CHIN)
    var uy = py(TOP) - py(CHIN)
    val faceH = sqrt(ux * ux + uy * uy)
    if (faceH < 4f) return null
    ux /= faceH; uy /= faceH
    // Droite ⟂ haut (sens indifférent : les formes sont symétriques).
    val rx = -uy
    val ry = ux
    val f = Frame(cx, cy, rx, ry, ux, uy)

    // Silhouette : enveloppe convexe du maillage.
    val xs = FloatArray(MESH_POINTS) { px(it) }
    val ys = FloatArray(MESH_POINTS) { py(it) }
    val sil = hull(xs, ys)
    if (sil.size < 6) return null
    var bMin = Float.MAX_VALUE
    var bMax = -Float.MAX_VALUE
    var minX = Float.MAX_VALUE
    var minY = Float.MAX_VALUE
    var maxX = -Float.MAX_VALUE
    var maxY = -Float.MAX_VALUE
    var hx = 0f
    var hy = 0f
    val hn = sil.size / 2
    for (k in 0 until hn) {
      val x = sil[2 * k]
      val y = sil[2 * k + 1]
      val b = f.b(x, y)
      bMin = min(bMin, b); bMax = max(bMax, b)
      minX = min(minX, x); minY = min(minY, y); maxX = max(maxX, x); maxY = max(maxY, y)
      hx += x; hy += y
    }
    val faceW = max(bMax - bMin, faceH * 0.35f)

    fun outline(side: Float, up: Float, down: Float): FloatArray {
      val out = FloatArray(sil.size)
      for (k in 0 until hn) {
        val b = f.b(sil[2 * k], sil[2 * k + 1]) * side
        val a0 = f.a(sil[2 * k], sil[2 * k + 1])
        val a = if (a0 >= 0f) a0 * up else a0 * down
        out[2 * k] = f.wx(b, a)
        out[2 * k + 1] = f.wy(b, a)
      }
      return out
    }

    fun centroid(idx: IntArray): Pair<Float, Float> {
      var x = 0f
      var y = 0f
      for (i in idx) {
        x += px(i); y += py(i)
      }
      return x / idx.size to y / idx.size
    }

    /**
     * Trou épousant un contour (coin, bord inférieur, coin, bord supérieur),
     * élargi dans son propre repère (axe coin → coin) : hauteur `ka` fois la
     * vraie, au moins `kmin` × demi-largeur en amande. Null si dégénéré.
     */
    fun contourHole(idx: IntArray, kb: Float, ka: Float, kmin: Float): FloatArray? {
      val n = idx.size
      val half = n / 2
      val (gx, gy) = centroid(idx)
      var ex = px(idx[half]) - px(idx[0])
      var ey = py(idx[half]) - py(idx[0])
      val el = sqrt(ex * ex + ey * ey)
      if (el < 1e-3f) return null
      ex /= el; ey /= el
      var nx = -ey
      var ny = ex
      if (nx * ux + ny * uy < 0f) {
        nx = -nx; ny = -ny
      }
      val g = Frame(gx, gy, ex, ey, nx, ny)
      val bs = FloatArray(n) { g.b(px(idx[it]), py(idx[it])) * kb }
      var hw = 1e-3f
      for (v in bs) hw = max(hw, abs(v))
      val mh = kmin * hw
      var aLo = Float.MAX_VALUE
      var aHi = -Float.MAX_VALUE
      val out = FloatArray(n * 2)
      for (k in 0 until n) {
        val a0 = g.a(px(idx[k]), py(idx[k]))
        val t = bs[k] / hw
        val prof = sqrt(max(0f, 1f - t * t))
        val a = when {
          k == 0 || k == half -> a0 * ka
          k < half -> min(a0 * ka, -mh * prof)
          else -> max(a0 * ka, mh * prof)
        }
        aLo = min(aLo, a); aHi = max(aHi, a)
        out[2 * k] = g.wx(bs[k], a)
        out[2 * k + 1] = g.wy(bs[k], a)
      }
      val hh = (aHi - aLo) / 2f
      if (hh <= 0f || hw / hh > MAX_HOLE_ASPECT) return null
      return out
    }

    /** Rectangle arrondi (superellipse) dans le repère `g`. */
    fun roundRect(g: Frame, hw: Float, hh: Float, n: Int = 24): FloatArray {
      val out = FloatArray(n * 2)
      for (k in 0 until n) {
        val t = (2.0 * Math.PI * k / n)
        val c = cos(t).toFloat()
        val s = sin(t).toFloat()
        val b = hw * sign(c) * abs(c).toDouble().pow(0.55).toFloat()
        val a = hh * sign(s) * abs(s).toDouble().pow(0.55).toFloat()
        out[2 * k] = g.wx(b, a)
        out[2 * k + 1] = g.wy(b, a)
      }
      return out
    }

    fun spread(idx: IntArray, g: Frame): Pair<Float, Float> {
      var bLo = Float.MAX_VALUE
      var bHi = -Float.MAX_VALUE
      var aLo = Float.MAX_VALUE
      var aHi = -Float.MAX_VALUE
      for (i in idx) {
        val b = g.b(px(i), py(i))
        val a = g.a(px(i), py(i))
        bLo = min(bLo, b); bHi = max(bHi, b); aLo = min(aLo, a); aHi = max(aHi, a)
      }
      return (bHi - bLo) to (aHi - aLo)
    }

    /** Polyligne → segments (x0,y0,x1,y1…). */
    fun segments(idx: IntArray, into: ArrayList<Float>) {
      for (k in 0 until idx.size - 1) {
        into.add(px(idx[k])); into.add(py(idx[k])); into.add(px(idx[k + 1])); into.add(py(idx[k + 1]))
      }
    }

    // Yeux et bouche épousant paupières et lèvres.
    val leftEye = contourHole(LEFT_EYE, EYE_B, EYE_A, EYE_MIN) ?: return null
    val rightEye = contourHole(RIGHT_EYE, EYE_B, EYE_A, EYE_MIN) ?: return null
    val mouth = contourHole(LIPS, MOUTH_B, MOUTH_A, MOUTH_MIN) ?: return null

    // Bandeau des yeux de la cagoule (inchangé).
    val (lx, ly) = centroid(LEFT_EYE)
    val (rxE, ryE) = centroid(RIGHT_EYE)
    val bandFrame = Frame((lx + rxE) / 2f, (ly + ryE) / 2f, rx, ry, ux, uy)
    val eyeSpan = abs(bandFrame.b(lx, ly) - bandFrame.b(rxE, ryE))
    val (lw, lh) = spread(LEFT_EYE, Frame(lx, ly, rx, ry, ux, uy))
    val (rw, rh) = spread(RIGHT_EYE, Frame(rxE, ryE, rx, ry, ux, uy))
    val eyeW = max(lw, rw)
    val eyeH = max(lh, rh)
    val bandHalfW = max(eyeSpan / 2f + eyeW * 0.95f, faceW * 0.36f)
    val bandHalfH = max(eyeH * 1.1f, faceH * 0.085f)
    val eyeBand = roundRect(bandFrame, bandHalfW, bandHalfH)

    // Côtes du tricot : verticales dans le repère du visage.
    val halfH = faceH / 2f
    val ribList = ArrayList<Float>()
    val ribStep = faceW * 0.11f
    var b = -faceW * 0.9f
    while (b <= faceW * 0.9f) {
      ribList.add(f.wx(b, halfH * 2.2f)); ribList.add(f.wy(b, halfH * 2.2f))
      ribList.add(f.wx(b, -halfH * 1.6f)); ribList.add(f.wy(b, -halfH * 1.6f))
      b += ribStep
    }
    // Maille du voile : diagonales croisées sur le bandeau.
    val meshList = ArrayList<Float>()
    val meshStep = max(faceW * 0.035f, 2f)
    var o = -bandHalfW - bandHalfH * 2f
    while (o <= bandHalfW + bandHalfH * 2f) {
      for (dir in intArrayOf(1, -1)) {
        val b0 = o - dir * bandHalfH * 1.2f
        val b1 = o + dir * bandHalfH * 1.2f
        meshList.add(bandFrame.wx(b0, -bandHalfH * 1.2f)); meshList.add(bandFrame.wy(b0, -bandHalfH * 1.2f))
        meshList.add(bandFrame.wx(b1, bandHalfH * 1.2f)); meshList.add(bandFrame.wy(b1, bandHalfH * 1.2f))
      }
      o += meshStep
    }
    // Relief : sourcils, arête et base du nez.
    val featList = ArrayList<Float>()
    for (line in arrayOf(BROW_L, BROW_R, NOSE, NOSE_BASE)) segments(line, featList)

    val hood = outline(HOOD_SIDE, HOOD_UP, HOOD_DOWN)
    val full = outline(FULL_SIDE, FULL_UP, FULL_DOWN)
    val hoodHalo = outline(HOOD_SIDE + HALO_PAD, HOOD_UP + HALO_PAD, HOOD_DOWN + HALO_PAD)
    val fullHalo = outline(FULL_SIDE + HALO_PAD, FULL_UP + HALO_PAD, FULL_DOWN + HALO_PAD)
    val ribs = ribList.toFloatArray()
    val mesh = meshList.toFloatArray()
    val features = featList.toFloatArray()
    val bounds = RectF(minX, minY, maxX, maxY)
    val center = floatArrayOf(hx / hn, hy / hn)
    for (arr in arrayOf(hood, full, hoodHalo, fullHalo, eyeBand, leftEye, rightEye, mouth, ribs, mesh, features, center)) {
      toBuffer.mapPoints(arr)
    }
    toBuffer.mapRect(bounds)
    // Largeur en px du tampon (le recadrage peut être à une autre échelle).
    val unit = floatArrayOf(0f, 0f, 1f, 0f)
    toBuffer.mapVectors(unit)
    val k = sqrt(unit[2] * unit[2] + unit[3] * unit[3]).takeIf { it > 0f } ?: 1f
    return FaceMask(
      hood, full, hoodHalo, fullHalo, eyeBand, leftEye, rightEye, mouth, ribs, mesh, features,
      faceW * k, bounds, center[0], center[1], max(bounds.width(), bounds.height()) / 2f,
    )
  }

  /** Centre d'un polygone (x,y…) : moyenne des sommets. */
  fun center(pts: FloatArray, out: FloatArray) {
    var x = 0f
    var y = 0f
    val n = pts.size / 2
    for (k in 0 until n) {
      x += pts[2 * k]; y += pts[2 * k + 1]
    }
    out[0] = x / n
    out[1] = y / n
  }
}

/** Angles de droites (degrés, sans sens : modulo 180°). */
internal object Angles {
  /** Angle de la droite (dx, dy), ramené dans [-90°, 90°). */
  fun lineAngle(dx: Float, dy: Float): Float = norm(Math.toDegrees(kotlin.math.atan2(dy, dx).toDouble()).toFloat())

  fun norm(a: Float): Float {
    var x = a % 180f
    if (x < -90f) x += 180f
    if (x >= 90f) x -= 180f
    return x
  }

  /** Écart entre deux droites, 0 → 90°. */
  fun diff(a: Float, b: Float): Float = kotlin.math.abs(norm(a - b))

  /** Écart signé b → a, dans [-90°, 90°). */
  fun delta(a: Float, b: Float): Float = norm(a - b)
}

/**
 * Contrôle d'un maillage Face Landmarker avant d'en faire un masque : un
 * maillage écrasé, couché, tordu (suivi accroché à une mauvaise zone,
 * jalon 2b) ou aux proportions impossibles (yeux étirés, bouche trop haute
 * ou trop basse, jalon 2c) est écarté et le visage reste flouté.
 */
internal class MeshCheck(
  /** Inclinaison de la ligne des yeux (degrés, tampon). */
  val roll: Float,
  /** Hauteur front → menton / largeur joue → joue. */
  val aspect: Float,
  /** |cos| entre l'axe front → menton et la ligne des yeux (0 = perpendiculaires). */
  val skew: Float,
  /** Largeur moyenne d'un œil (coin → coin) / écart entre les yeux. */
  val eyeWidth: Float,
  /** Distance yeux → bouche / écart entre les yeux. */
  val mouthDrop: Float,
) {
  val shapeOk: Boolean
    get() = aspect in MIN_ASPECT..MAX_ASPECT && skew <= MAX_SKEW &&
      eyeWidth in MIN_EYE_WIDTH..MAX_EYE_WIDTH && mouthDrop in MIN_MOUTH_DROP..MAX_MOUTH_DROP

  companion object {
    const val MIN_ASPECT = 0.85f
    const val MAX_ASPECT = 2.3f
    /** ≈ 35° d'écart à la perpendiculaire. */
    const val MAX_SKEW = 0.57f
    // Mesurés sur la vidéo de référence du fondateur (de face, près, loin,
    // tourné, penché, tête levée) : œil 0,36 → 0,48 ; bouche 0,46 → 1,68.
    const val MIN_EYE_WIDTH = 0.25f
    const val MAX_EYE_WIDTH = 0.70f
    const val MIN_MOUTH_DROP = 0.30f
    const val MAX_MOUTH_DROP = 2.2f

    fun of(lm: List<NormalizedLandmark>, w: Float, h: Float, toBuffer: Matrix): MeshCheck {
      val idx = intArrayOf(33, 263, MaskGeometry.TOP, MaskGeometry.CHIN, MaskGeometry.CHEEK_A, MaskGeometry.CHEEK_B, 133, 362)
      val p = FloatArray(idx.size * 2 + 6)
      for ((k, i) in idx.withIndex()) {
        p[2 * k] = lm[i].x() * w
        p[2 * k + 1] = lm[i].y() * h
      }
      // Centres des yeux et des lèvres (moyennes des contours).
      val base = idx.size * 2
      for ((slot, contour) in arrayOf(MaskGeometry.LEFT_EYE, MaskGeometry.RIGHT_EYE, MaskGeometry.LIPS).withIndex()) {
        var x = 0f
        var y = 0f
        for (i in contour) {
          x += lm[i].x() * w; y += lm[i].y() * h
        }
        p[base + 2 * slot] = x / contour.size
        p[base + 2 * slot + 1] = y / contour.size
      }
      toBuffer.mapPoints(p)
      val ex = p[2] - p[0]
      val ey = p[3] - p[1]
      val ux = p[4] - p[6]
      val uy = p[5] - p[7]
      val cw = kotlin.math.hypot(p[10] - p[8], p[11] - p[9])
      val fh = kotlin.math.hypot(ux, uy)
      val el = kotlin.math.hypot(ex, ey)
      val skew = if (el > 0f && fh > 0f) kotlin.math.abs(ex * ux + ey * uy) / (el * fh) else 1f
      val span = kotlin.math.hypot(p[base + 2] - p[base], p[base + 3] - p[base + 1])
      val eyeW = (kotlin.math.hypot(p[12] - p[0], p[13] - p[1]) + kotlin.math.hypot(p[14] - p[2], p[15] - p[3])) / 2f
      val midX = (p[base] + p[base + 2]) / 2f
      val midY = (p[base + 1] + p[base + 3]) / 2f
      val drop = kotlin.math.hypot(p[base + 4] - midX, p[base + 5] - midY)
      return MeshCheck(
        Angles.lineAngle(ex, ey),
        if (cw > 0f) fh / cw else 0f,
        skew,
        if (span > 0f) eyeW / span else 0f,
        if (span > 0f) drop / span else 0f,
      )
    }
  }
}
