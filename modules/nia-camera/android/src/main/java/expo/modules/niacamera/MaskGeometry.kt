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
 * Formes des masques (A1, jalon 2), calculées sur le fil d'analyse à partir
 * des 478 repères MediaPipe Face Landmarker, puis ramenées dans les
 * coordonnées du tampon d'analyse. Le rendu (fil GL) ne fait que remplir ces
 * polygones.
 *
 * Tout est construit dans le repère du visage (axe « haut » front → menton,
 * axe « droite » joue → joue) : les masques suivent l'inclinaison et restent
 * plus grands que le visage, y compris de profil.
 */
internal class FaceMask(
  /** Cagoule : contour du visage très élargi (front, cheveux, oreilles, cou). */
  val hood: FloatArray,
  /** Masque intégral : contour du visage élargi. */
  val full: FloatArray,
  /** Bandeau des yeux de la cagoule (voile opaque maillé). */
  val eyeBand: FloatArray,
  /** Trous des yeux du masque intégral (opaques, foncés). */
  val leftEye: FloatArray,
  val rightEye: FloatArray,
  /** Bouche (opaque, suit l'ouverture). */
  val mouth: FloatArray,
  /** Côtes du tricot (segments x0,y0,x1,y1…), à découper par la cagoule. */
  val ribs: FloatArray,
  /** Maille du voile des yeux (segments), à découper par le bandeau. */
  val mesh: FloatArray,
  /** Largeur du visage (px du tampon) : épaisseur des traits. */
  val faceWidth: Float,
  /** Emprise des repères dans le tampon (diagnostic / repli). */
  val bounds: RectF,
)

internal object MaskGeometry {
  // Indices MediaPipe (face mesh 468 + iris).
  val FACE_OVAL = intArrayOf(
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  )
  val LEFT_EYE = intArrayOf(33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246)
  val RIGHT_EYE = intArrayOf(263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466)
  val LIPS = intArrayOf(61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185)
  const val TOP = 10
  const val CHIN = 152
  const val CHEEK_A = 234
  const val CHEEK_B = 454

  // Élargissements (repère du visage).
  const val HOOD_SIDE = 1.30f
  const val HOOD_UP = 1.65f
  const val HOOD_DOWN = 1.22f
  const val FULL_SIDE = 1.14f
  const val FULL_UP = 1.22f
  const val FULL_DOWN = 1.08f

  /** Repère local : centre, axe droite, axe haut (unitaires, px redressés). */
  private class Frame(val cx: Float, val cy: Float, val rx: Float, val ry: Float, val ux: Float, val uy: Float) {
    fun b(x: Float, y: Float) = (x - cx) * rx + (y - cy) * ry
    fun a(x: Float, y: Float) = (x - cx) * ux + (y - cy) * uy
    fun wx(b: Float, a: Float) = cx + rx * b + ux * a
    fun wy(b: Float, a: Float) = cy + ry * b + uy * a
  }

  /**
   * `lm` : repères normalisés sur l'image redressée `uw × uh` ; `toBuffer` :
   * redressée → tampon d'analyse. Null si les repères sont inutilisables.
   */
  fun build(lm: List<NormalizedLandmark>, uw: Float, uh: Float, toBuffer: Matrix): FaceMask? {
    if (lm.size < 468) return null
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
    // Largeur mesurée sur le contour (reste juste de profil).
    var bMin = Float.MAX_VALUE
    var bMax = -Float.MAX_VALUE
    for (i in FACE_OVAL) {
      val b = f.b(px(i), py(i))
      bMin = min(bMin, b); bMax = max(bMax, b)
    }
    val faceW = max(bMax - bMin, faceH * 0.35f)

    fun outline(side: Float, up: Float, down: Float): FloatArray {
      val out = FloatArray(FACE_OVAL.size * 2)
      for ((k, i) in FACE_OVAL.withIndex()) {
        val b = f.b(px(i), py(i)) * side
        val a0 = f.a(px(i), py(i))
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

    // Yeux.
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
    val holeHalfW = max(eyeW * 0.8f, faceW * 0.1f)
    val holeHalfH = max(eyeH * 1.1f, faceH * 0.05f)
    val leftEye = roundRect(Frame(lx, ly, rx, ry, ux, uy), holeHalfW, holeHalfH, 16)
    val rightEye = roundRect(Frame(rxE, ryE, rx, ry, ux, uy), holeHalfW, holeHalfH, 16)

    // Bouche : contour des lèvres élargi autour de son centre.
    val (mx, my) = centroid(LIPS)
    val mouth = FloatArray(LIPS.size * 2)
    for ((k, i) in LIPS.withIndex()) {
      mouth[2 * k] = mx + (px(i) - mx) * 1.2f
      mouth[2 * k + 1] = my + (py(i) - my) * 1.35f
    }

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

    // Emprise des repères (redressé).
    var minX = Float.MAX_VALUE
    var minY = Float.MAX_VALUE
    var maxX = -Float.MAX_VALUE
    var maxY = -Float.MAX_VALUE
    for (i in FACE_OVAL) {
      minX = min(minX, px(i)); minY = min(minY, py(i)); maxX = max(maxX, px(i)); maxY = max(maxY, py(i))
    }
    val bounds = RectF(minX, minY, maxX, maxY)

    val hood = outline(HOOD_SIDE, HOOD_UP, HOOD_DOWN)
    val full = outline(FULL_SIDE, FULL_UP, FULL_DOWN)
    val ribs = ribList.toFloatArray()
    val mesh = meshList.toFloatArray()
    for (arr in arrayOf(hood, full, eyeBand, leftEye, rightEye, mouth, ribs, mesh)) toBuffer.mapPoints(arr)
    toBuffer.mapRect(bounds)
    return FaceMask(hood, full, eyeBand, leftEye, rightEye, mouth, ribs, mesh, faceW, bounds)
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
 * maillage écrasé, couché ou tordu (suivi accroché à une mauvaise zone,
 * jalon 2b) est écarté et le visage reste flouté.
 */
internal class MeshCheck(
  /** Inclinaison de la ligne des yeux (degrés, tampon). */
  val roll: Float,
  /** Hauteur front → menton / largeur joue → joue. */
  val aspect: Float,
  /** |cos| entre l'axe front → menton et la ligne des yeux (0 = perpendiculaires). */
  val skew: Float,
) {
  val shapeOk: Boolean
    get() = aspect in MIN_ASPECT..MAX_ASPECT && skew <= MAX_SKEW

  companion object {
    const val MIN_ASPECT = 0.85f
    const val MAX_ASPECT = 2.3f
    /** ≈ 35° d'écart à la perpendiculaire. */
    const val MAX_SKEW = 0.57f

    fun of(lm: List<NormalizedLandmark>, w: Float, h: Float, toBuffer: Matrix): MeshCheck {
      val idx = intArrayOf(33, 263, MaskGeometry.TOP, MaskGeometry.CHIN, MaskGeometry.CHEEK_A, MaskGeometry.CHEEK_B)
      val p = FloatArray(idx.size * 2)
      for ((k, i) in idx.withIndex()) {
        p[2 * k] = lm[i].x() * w
        p[2 * k + 1] = lm[i].y() * h
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
      return MeshCheck(Angles.lineAngle(ex, ey), if (cw > 0f) fh / cw else 0f, skew)
    }
  }
}
