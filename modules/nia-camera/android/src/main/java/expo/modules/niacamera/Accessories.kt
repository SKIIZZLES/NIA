package expo.modules.niacamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.util.Log
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Accessoires (A2.0) : objets amusants posés sur le visage, PAS de
 * l'anonymat. Sans visage, l'accessoire disparaît simplement : ni flou plein
 * cadre, ni déclencheur bloqué (règles réservées aux masques d'anonymat).
 *
 * Chaîne : repères Face Landmarker (fil des repères) → pose de l'accessoire
 * (points d'ancrage + lacet / tangage tirés de la matrice de pose MediaPipe)
 * → lissage One Euro → `LandmarkFace.accessory` ; au dessin (fil GL), la pose
 * suit la boîte BlazeFace la plus fraîche, exactement comme les masques
 * (prédiction de mouvement des jalons 2b–2e), puis le dessin vectoriel est
 * posé par une transformation affine.
 */
internal object AccessoryCatalog {
  enum class Kind { GLASSES }

  /**
   * Définition native d'un objet du catalogue (`lib/accessories.ts` porte les
   * mêmes identifiants, les libellés et la licence). Coordonnées dans le
   * viewport du dessin vectoriel.
   */
  class Def(
    val id: String,
    val kind: Kind,
    /** Ressource VectorDrawable du module (`res/drawable/<nom>.xml`). */
    val drawable: String,
    val viewportW: Float,
    val viewportH: Float,
    /** Centres des verres (gauche du dessin = côté du repère 33). */
    val lens1X: Float,
    val lens2X: Float,
    val lensY: Float,
    /** Charnières (départ des branches). */
    val hinge1X: Float,
    val hinge2X: Float,
    val hingeY: Float,
    val armColor: Int,
    /** Épaisseur des branches (unités du viewport). */
    val armWidth: Float,
    /** Largeur du dessin tramé une fois pour toutes (px). */
    val rasterW: Int,
  )

  val ALL: List<Def> = listOf(
    Def(
      id = "glasses-sable",
      kind = Kind.GLASSES,
      drawable = "nia_acc_glasses_sable",
      viewportW = 1000f, viewportH = 360f,
      lens1X = 290f, lens2X = 710f, lensY = 175f,
      hinge1X = 40f, hinge2X = 960f, hingeY = 132f,
      armColor = Color.rgb(0x8B, 0x5A, 0x2B),
      armWidth = 18f,
      rasterW = 640,
    ),
  )

  fun byId(id: String?): Def? = ALL.firstOrNull { it.id == id }

  /** Dessin vectoriel tramé (fil principal, une fois par objet choisi). */
  fun load(context: Context, def: Def): Art? = try {
    val res = context.resources.getIdentifier(def.drawable, "drawable", context.packageName)
    val d = if (res != 0) context.getDrawable(res) else null
    if (d == null) {
      Log.w(TAG, "accessoire ${def.id} : dessin ${def.drawable} introuvable")
      null
    } else {
      val w = def.rasterW
      val h = max(1, (w * def.viewportH / def.viewportW).toInt())
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      d.setBounds(0, 0, w, h)
      d.draw(Canvas(bmp))
      Art(def, bmp)
    }
  } catch (e: Throwable) {
    Log.w(TAG, "accessoire ${def.id} : chargement impossible", e)
    null
  }

  class Art(val def: Def, val bitmap: Bitmap)

  const val TAG = "NiaCamera"
}

/**
 * Pose d'un accessoire au moment des repères, dans le tampon d'analyse.
 * Côté 1 = repères 33 / 133 / 234, côté 2 = 263 / 362 / 454.
 */
internal class AccessoryPose(
  val e1x: Float, val e1y: Float,
  val e2x: Float, val e2y: Float,
  val ear1x: Float, val ear1y: Float,
  val ear2x: Float, val ear2y: Float,
  /** Vecteur unitaire perpendiculaire à la ligne des yeux, vers le menton. */
  val downX: Float, val downY: Float,
  /** Lacet (> 0 : le côté 1 est le plus proche de la caméra) et tangage, degrés. */
  val yawDeg: Float,
  val pitchDeg: Float,
  /** Écart des yeux ramené de face (px du tampon) : échelle verticale de l'objet. */
  val frontalIod: Float,
) {
  val iod: Float get() = hypot(e2x - e1x, e2y - e1y)

  companion object {
    /** Indices du maillage MediaPipe (478 points). */
    const val EYE1_OUT = 33
    const val EYE1_IN = 133
    const val EYE2_OUT = 263
    const val EYE2_IN = 362
    const val EAR1 = 234
    const val EAR2 = 454
    const val NOSE_TIP = 1
    const val CHIN = 152
    /** Repli sans matrice de pose : lacet ≈ 58,5° × décalage du nez (vidéo de référence, écart 2,4°). */
    const val YAW_PER_NOSE_SHIFT = 58.5f
    const val MAX_ANGLE = 80f

    /**
     * Pose tirée des repères (recadrage `cw` × `ch` → tampon par `toBuffer`).
     * `matrix` : matrice de pose MediaPipe (16 valeurs), null si absente. Lacet
     * et tangage sont lus dans l'image redressée, où leur signe est fixé
     * (vidéo de référence : signe du lacet = côté vers lequel pointe le nez,
     * 142 images sur 142 au-delà de 12°).
     */
    fun of(face: List<NormalizedLandmark>, cw: Float, ch: Float, toBuffer: Matrix, matrix: FloatArray?): AccessoryPose? {
      if (face.size <= EAR2) return null
      fun x(i: Int) = face[i].x() * cw
      fun y(i: Int) = face[i].y() * ch
      // Lacet / tangage (image redressée, avant passage au tampon).
      var yaw = Float.NaN
      var pitch = 0f
      if (matrix != null && matrix.size >= 16) {
        // Colonnes d'abord (MatrixData MediaPipe) : translation en 12–14.
        val colMajor = abs(matrix[14]) >= abs(matrix[11])
        fun r(i: Int, j: Int) = if (colMajor) matrix[j * 4 + i] else matrix[i * 4 + j]
        val fx = r(0, 2)
        val fy = r(1, 2)
        val fz = r(2, 2)
        if (fx.isFinite() && fy.isFinite() && fz.isFinite() && (fx != 0f || fz != 0f)) {
          yaw = Math.toDegrees(atan2(fx, fz).toDouble()).toFloat()
          pitch = Math.toDegrees(atan2(-fy, hypot(fx, fz)).toDouble()).toFloat()
        }
      }
      if (yaw.isNaN()) {
        val mid = (x(EAR1) + x(EAR2)) / 2f
        val w = hypot(x(EAR2) - x(EAR1), y(EAR2) - y(EAR1))
        if (w < 1f) return null
        yaw = YAW_PER_NOSE_SHIFT * (x(NOSE_TIP) - mid) / w
      }
      yaw = yaw.coerceIn(-MAX_ANGLE, MAX_ANGLE)
      pitch = pitch.coerceIn(-MAX_ANGLE, MAX_ANGLE)
      val pts = floatArrayOf(
        (x(EYE1_OUT) + x(EYE1_IN)) / 2f, (y(EYE1_OUT) + y(EYE1_IN)) / 2f,
        (x(EYE2_OUT) + x(EYE2_IN)) / 2f, (y(EYE2_OUT) + y(EYE2_IN)) / 2f,
        x(EAR1), y(EAR1),
        x(EAR2), y(EAR2),
        x(CHIN), y(CHIN),
      )
      toBuffer.mapPoints(pts)
      return make(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7], pts[8], pts[9], yaw, pitch)
    }

    /** Pose complète à partir des points (tampon) ; `chin` sert au sens du « bas ». */
    fun make(
      e1x: Float, e1y: Float, e2x: Float, e2y: Float,
      ear1x: Float, ear1y: Float, ear2x: Float, ear2y: Float,
      chinX: Float, chinY: Float,
      yaw: Float, pitch: Float,
    ): AccessoryPose? {
      val ux = e2x - e1x
      val uy = e2y - e1y
      val iod = hypot(ux, uy)
      if (iod < 2f) return null
      var dx = -uy / iod
      var dy = ux / iod
      val mx = (e1x + e2x) / 2f
      val my = (e1y + e2y) / 2f
      if (dx * (chinX - mx) + dy * (chinY - my) < 0f) {
        dx = -dx
        dy = -dy
      }
      val c = max(cos(Math.toRadians(yaw.toDouble())).toFloat(), MIN_COS)
      return AccessoryPose(e1x, e1y, e2x, e2y, ear1x, ear1y, ear2x, ear2y, dx, dy, yaw, pitch, iod / c)
    }

    /** Lacet au-delà duquel l'écart des yeux n'est plus corrigé (cos ≥ 0,5). */
    const val MIN_COS = 0.5f
  }
}

/**
 * Filtre One Euro (Casiez et al., 2012) sur une valeur : coupure basse au
 * repos (tremblement des repères), haute en mouvement (pas de retard). La
 * vitesse est rapportée à `ref` (écart des yeux, ou 30° pour les angles).
 * Réglé hors ligne sur la vidéo de référence (repères à 15 i/s) : coupure
 * 1,5 Hz, bêta 5 → tremblement au repos −30 % environ, écart en mouvement
 * +10 % environ.
 */
internal class OneEuro(
  private val minCutoff: Float = MIN_CUTOFF,
  private val beta: Float = BETA,
  private val dCutoff: Float = D_CUTOFF,
) {
  private var x = Float.NaN
  private var dx = 0f
  private var lastNs = 0L

  fun filter(value: Float, tNs: Long, ref: Float): Float {
    if (x.isNaN() || tNs <= lastNs) {
      x = value
      dx = 0f
      lastNs = tNs
      return value
    }
    val dt = max(1e-3f, (tNs - lastNs) / 1e9f)
    lastNs = tNs
    val raw = (value - x) / dt
    dx += alpha(dCutoff, dt) * (raw - dx)
    val cutoff = minCutoff + beta * abs(dx) / max(ref, 1e-3f)
    x += alpha(cutoff, dt) * (value - x)
    return x
  }

  private fun alpha(cutoff: Float, dt: Float): Float {
    val tau = 1f / (2f * Math.PI.toFloat() * cutoff)
    return 1f / (1f + tau / dt)
  }

  companion object {
    const val MIN_CUTOFF = 1.5f
    const val BETA = 5f
    const val D_CUTOFF = 1f
  }
}

/**
 * Lissage des poses par visage (jusqu'à 3) : chaque pose est rattachée à la
 * piste la plus proche (milieu des yeux à moins de 0,8 écart des yeux, vue il
 * y a moins de 400 ms), sinon une nouvelle piste repart sans lissage.
 * Fil des repères uniquement.
 */
internal class AccessorySmoother {
  private class Track(var mx: Float, var my: Float, var ts: Long) {
    val f = Array(N) { OneEuro() }
  }

  private var tracks = ArrayList<Track>()

  fun smooth(poses: List<AccessoryPose?>, ts: Long): List<AccessoryPose?> {
    val next = ArrayList<Track>(poses.size)
    val free = ArrayList(tracks.filter { ts - it.ts in 0..MAX_GAP_NS })
    val out = poses.map { p ->
      if (p == null) return@map null
      val mx = (p.e1x + p.e2x) / 2f
      val my = (p.e1y + p.e2y) / 2f
      val iod = p.iod
      val t = free.minByOrNull { hypot(it.mx - mx, it.my - my) }
        ?.takeIf { hypot(it.mx - mx, it.my - my) < MATCH_IOD * iod }
      val track = t?.also { free.remove(it) } ?: Track(mx, my, ts)
      track.mx = mx
      track.my = my
      track.ts = ts
      next.add(track)
      val v = floatArrayOf(p.e1x, p.e1y, p.e2x, p.e2y, p.ear1x, p.ear1y, p.ear2x, p.ear2y, p.yawDeg, p.pitchDeg)
      for (i in v.indices) v[i] = track.f[i].filter(v[i], ts, if (i < 8) iod else ANGLE_REF)
      val chinX = (v[0] + v[2]) / 2f + p.downX * iod
      val chinY = (v[1] + v[3]) / 2f + p.downY * iod
      AccessoryPose.make(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], chinX, chinY, v[8], v[9])
    }
    tracks = next
    return out
  }

  fun clear() = tracks.clear()

  companion object {
    private const val N = 10
    const val MATCH_IOD = 0.8f
    const val MAX_GAP_NS = 400_000_000L
    const val ANGLE_REF = 30f
  }
}

/** Dessin des accessoires (fil GL), dans le repère du tampon d'analyse au moment des repères. */
internal class AccessoryPainter {
  private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val armPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
  }
  private val debugPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val m = Matrix()
  private val viewport = RectF()
  private val pt = FloatArray(4)

  /** Faux : objet caché (tête trop tournée). */
  fun draw(canvas: Canvas, art: AccessoryCatalog.Art, p: AccessoryPose, outline: Boolean): Boolean {
    val d = art.def
    if (abs(p.yawDeg) > MAX_YAW) return false
    // Viewport → tampon : axe horizontal = ligne des yeux (raccourcie par le
    // lacet, comme le visage) ; axe vertical = perpendiculaire, à l'échelle de
    // l'écart des yeux ramené de face, raccourcie par le tangage.
    val lens = d.lens2X - d.lens1X
    val ax = (p.e2x - p.e1x) / lens
    val ay = (p.e2y - p.e1y) / lens
    val vs = p.frontalIod / lens * max(cos(Math.toRadians(p.pitchDeg.toDouble())).toFloat(), MIN_PITCH_COS)
    val bx = p.downX * vs
    val by = p.downY * vs
    val ox = (d.lens1X + d.lens2X) / 2f
    val mx = (p.e1x + p.e2x) / 2f
    val my = (p.e1y + p.e2y) / 2f
    m.setValues(
      floatArrayOf(
        ax, bx, mx - ax * ox - bx * d.lensY,
        ay, by, my - ay * ox - by * d.lensY,
        0f, 0f, 1f,
      ),
    )
    // Branche du côté proche seulement (l'autre passe derrière la tête),
    // dessinée sous la monture.
    val yawAbs = abs(p.yawDeg)
    if (yawAbs > ARM_MIN_YAW) {
      val near1 = p.yawDeg > 0f
      pt[0] = if (near1) d.hinge1X else d.hinge2X
      pt[1] = d.hingeY
      m.mapPoints(pt, 0, pt, 0, 1)
      armPaint.color = d.armColor
      armPaint.alpha = (255 * min(1f, (yawAbs - ARM_MIN_YAW) / ARM_FADE)).toInt()
      armPaint.strokeWidth = d.armWidth * vs
      canvas.drawLine(pt[0], pt[1], if (near1) p.ear1x else p.ear2x, if (near1) p.ear1y else p.ear2y, armPaint)
    }
    canvas.save()
    canvas.concat(m)
    viewport.set(0f, 0f, d.viewportW, d.viewportH)
    canvas.drawBitmap(art.bitmap, null, viewport, bitmapPaint)
    if (outline) {
      debugPaint.color = FaceMaskRenderer.DEBUG_CORE
      debugPaint.strokeWidth = FaceMaskRenderer.DEBUG_STROKE / max(vs, 1e-3f)
      canvas.drawRect(viewport, debugPaint)
    }
    canvas.restore()
    if (outline) {
      // Repères d'ancrage : yeux et oreilles (cyan).
      debugPaint.color = FaceMaskRenderer.DEBUG_HALO
      debugPaint.strokeWidth = FaceMaskRenderer.DEBUG_STROKE
      val r = max(2f, p.iod * 0.06f)
      canvas.drawCircle(p.e1x, p.e1y, r, debugPaint)
      canvas.drawCircle(p.e2x, p.e2y, r, debugPaint)
      canvas.drawCircle(p.ear1x, p.ear1y, r, debugPaint)
      canvas.drawCircle(p.ear2x, p.ear2y, r, debugPaint)
    }
    return true
  }

  companion object {
    /** Au-delà, la monture serait de profil : objet caché. */
    const val MAX_YAW = 55f
    /** Branche visible à partir de 10° de lacet, pleine à 20°. */
    const val ARM_MIN_YAW = 10f
    const val ARM_FADE = 10f
    const val MIN_PITCH_COS = 0.6f
  }
}
