package expo.modules.niacamera

import android.graphics.Matrix
import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sin

/**
 * Ovale de la tête (jalon 2f, modes Flou et Pixels), à la place du rectangle.
 *
 * Forme de SÉCURITÉ tirée de la boîte BlazeFace dans l'image redressée :
 * ovale en « œuf » (ellipse, un peu plus étroite vers le menton : silhouette
 * de tête), centré sur la boîte, 2 × sa largeur (d'une oreille à l'autre,
 * et de la marge pour les rotations de tête), 1,25 × sa hauteur au-dessus du
 * centre (front, cheveux) et 1,3 × dessous (menton, barbe), tourné selon la
 * ligne des yeux, puis ramené au tampon d'analyse.
 *
 * Réglé hors ligne sur la vidéo de référence (maillage de 468 points et
 * segmentation peau / cheveux, image par image) : le maillage du visage reste
 * à 15 % au moins du bord, la peau du visage dedans sur 99 % des images (le
 * reste : cou, nuque), 99 % des cheveux dedans ; aire ≈ 1,27 × le rectangle
 * de 2e (plus haut, sans coins). Plus étroit, il laisse sortir la joue dans
 * les rotations rapides.
 *
 * Le flou (ou les pixels) est PLEIN dans cette forme ; le fondu du bord est
 * entièrement au-dehors (voir [MaskSprite.headSprite]).
 */
internal class HeadOval(
  /** Centre, demi-largeur, demi-hauteurs haut / bas (image redressée), angle des yeux (degrés). */
  val cx: Float,
  val cy: Float,
  val a: Float,
  val top: Float,
  val bottom: Float,
  val angleDeg: Float,
  /** Image redressée → tampon (copie). */
  private val toBuffer: Matrix,
) {
  /** Px du tampon par px de l'image redressée (similitude). */
  val bufferScale: Float = run {
    val v = floatArrayOf(1f, 0f)
    toBuffer.mapVectors(v)
    hypot(v[0], v[1])
  }

  /** Largeur de la boîte BlazeFace, en px du tampon (unité du fondu). */
  val faceWidthBuffer: Float get() = a * 2f / HEAD_W * bufferScale

  /** Contour (x,y… tampon), demi-axes agrandis de `extra` px redressés. */
  fun polygon(extra: Float = 0f): FloatArray {
    val pts = FloatArray(POINTS * 2)
    val r = Math.toRadians(angleDeg.toDouble())
    val co = cos(r).toFloat()
    val si = sin(r).toFloat()
    val e = 2f / HEAD_N
    for (k in 0 until POINTS) {
      val t = 2.0 * Math.PI * k / POINTS
      val c = cos(t).toFloat()
      val s = sin(t).toFloat()
      val taper = 1f - HEAD_TAPER * (if (s > 0f) s * s else 0f)
      val x = (a + extra) * sign(c) * abs(c).pow(e) * taper
      val y = (if (s < 0f) top + extra else bottom + extra) * sign(s) * abs(s).pow(e)
      pts[2 * k] = cx + x * co - y * si
      pts[2 * k + 1] = cy + x * si + y * co
    }
    toBuffer.mapPoints(pts)
    return pts
  }

  companion object {
    /** Largeur = HEAD_W × la boîte ; demi-hauteurs = HEAD_TOP / HEAD_BOTTOM × sa hauteur. */
    const val HEAD_W = 2.0f
    const val HEAD_TOP = 1.25f
    const val HEAD_BOTTOM = 1.3f
    /** Exposant de la superellipse (2 = ellipse). */
    const val HEAD_N = 2.0f
    /** Rétrécissement vers le menton (0 = ellipse ; 0,3 = 30 % plus étroit en bas). */
    const val HEAD_TAPER = 0.3f
    /** Marge du recadrage autour de la forme (× largeur de la boîte) : couvre le fondu. */
    const val HEAD_CROP_PAD = 0.35f
    /** Rayon du fondu (au-dehors) × la largeur de la boîte. */
    const val HEAD_FEATHER = 0.06f
    /** Inclinaison prise en compte au plus (au-delà, la forme reste à ±45°). */
    const val MAX_ANGLE = 45f
    const val POINTS = 96

    /** `bb` : boîte BlazeFace (image redressée) ; `roll` : ligne des yeux (degrés redressés, NaN inconnu). */
    fun of(bb: RectF, roll: Float, toBuffer: Matrix): HeadOval {
      val angle = if (roll.isNaN()) 0f else roll.coerceIn(-MAX_ANGLE, MAX_ANGLE)
      return HeadOval(
        bb.centerX(),
        bb.centerY(),
        bb.width() * HEAD_W / 2f,
        bb.height() * HEAD_TOP,
        bb.height() * HEAD_BOTTOM,
        angle,
        Matrix(toBuffer),
      )
    }
  }
}
