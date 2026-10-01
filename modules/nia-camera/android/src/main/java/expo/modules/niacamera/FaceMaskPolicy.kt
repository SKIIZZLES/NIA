package expo.modules.niacamera

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Règle « en cas de doute, on cache » (A1, validée par le fondateur).
 *
 * Deux modes de rendu :
 *  - LIVE (défaut, jalon 2b) : CHAQUE image caméra est dessinée tout de
 *    suite, avec les dernières analyses connues (plus anciennes de ~60–100 ms),
 *    prolongées par la vitesse du visage et agrandies avec leur âge ;
 *  - EXACT : l'image attend sa propre analyse (BlazeFace seul, les repères
 *    ne bloquent plus), voisin à ±70 ms, maintien ≤ 100 ms.
 *
 * Dans les deux modes :
 *  - un visage sans repères récents (> 150 ms), dont le masque ne couvre
 *    plus la boîte BlazeFace, ou qui a bougé depuis ses repères garde le
 *    flou (repli), jamais le masque seul ;
 *  - sous chaque masque, un liseré de flou plumé épousant sa silhouette
 *    (+4 % au repos, jalon 2e), qui ne s'élargit qu'en mouvement ou si les
 *    repères vieillissent, plus une petite ellipse floue serrée sur la boîte
 *    BlazeFace fraîche (filet de sécurité, cachée par le masque au repos) ;
 *  - repères brièvement en retard (≤ 150 ms) : le dernier masque valable
 *    reste posé, suivi par la boîte BlazeFace fraîche, s'il couvre encore
 *    la boîte du visage ; sinon flou de repli ;
 *  - repli (repères absents) : ellipse de flou plumée de la zone du visage ;
 *  - visage absent des analyses depuis plus de 100 ms (ou plus aucune
 *    analyse récente) : flou plein cadre (COVER), cuit dans le fichier.
 *
 * Aucune donnée du visage n'est gardée au-delà des ~16 dernières analyses
 * (≈ 0,5 s), en mémoire vive, jamais écrite ni envoyée.
 */
internal object FaceMaskPolicy {
  const val NEIGHBOR_WINDOW_NS = 70_000_000L
  const val HOLD_NS = 100_000_000L
  /** LIVE : au-delà, l'analyse la plus récente est trop vieille → COVER. */
  const val LIVE_MAX_AGE_NS = 200_000_000L
  /** Repères « frais » : jusqu'à 100 ms de l'analyse du visage. */
  const val LANDMARK_STALE_NS = 100_000_000L
  /**
   * Masque maintenu (jalon 2e) : repères jusqu'à 150 ms de l'analyse, suivis
   * par la boîte BlazeFace fraîche, seulement s'ils couvrent encore le visage.
   */
  const val MASK_HOLD_NS = 150_000_000L
  /** Prolongation maximale du mouvement (LIVE). */
  const val MAX_EXTRAPOLATION_NS = 150_000_000L

  const val SCALE_EXACT = 1.0f
  const val SCALE_NEIGHBOR = 1.15f
  const val SCALE_HOLD = 1.3f
  /** LIVE : +12 % par tranche de 100 ms d'âge, + la part du déplacement prédit. */
  const val AGE_GROWTH = 0.12f
  const val SPEED_GROWTH = 0.8f
  const val MAX_SCALE = 1.8f
  /** Déplacement prédit ≤ 60 % de la largeur du visage. */
  const val MAX_SHIFT = 0.6f
  /**
   * Ovale de la tête (jalon 2f) : + 15 % par largeur de visage / s au-delà de
   * 0,5 (vitesse lissée de la boîte), en plus de la croissance commune. Le
   * rectangle protégeait les gestes brusques par ses coins ; l'ovale, par
   * cette marge. Hors ligne, avec une analyse vieille de 120 ms : aucune image
   * où le maillage du visage sort de l'ovale (2 avec le rectangle de 2e).
   */
  const val HEAD_SPEED_GROWTH = 0.15f
  const val HEAD_SPEED_DEAD = 0.5f
  /** Repères « décrochés » : centre à plus de 30 % de la largeur, taille ±35 %. */
  const val MOVED_FRACTION = 0.3f
  const val SIZE_TOLERANCE = 0.35f
  /** Masque et visage inclinés différemment de plus de 30° : flou de repli. */
  const val MAX_ROLL_DIFF = 30f
  /**
   * Halo sous le masque, RELATIF au masque (jalon 2e) : 1 au repos (le
   * liseré de +4 % est dans le sprite du halo), puis
   *  + 0,8 × le déplacement prédit au-delà de 2 % de la zone ;
   *  + 3 × (vitesse au-delà de 0,8 largeur / s : maillage ou boîte BlazeFace,
   *    la plus forte) × âge des repères ;
   *  + 8 % par tranche de 50 ms d'âge des repères au-delà de 100 ms (maintien).
   * Les zones mortes ignorent le tremblement au repos : au jalon 2d, l'âge
   * (≈ 100 ms au téléphone) et le bruit de vitesse du maillage gonflaient le
   * halo de ~25 % même immobile.
   */
  const val HALO_SPEED_GROWTH = 0.8f
  const val HALO_SHIFT_DEAD = 0.02f
  const val MESH_SPEED_GROWTH = 3f
  const val MESH_SPEED_DEAD = 0.8f
  const val HALO_STALE_GROWTH = 0.08f
  const val MAX_HALO = 1.6f
  /**
   * Couverture : la boîte BlazeFace fraîche × 0,75 (yeux → bouche) doit tomber
   * dans l'emprise de la silhouette du masque posé (+5 %). Hors vidéo de test,
   * la marge est de 2 à 15 % quand masque et boîte sont du même instant.
   */
  const val COVER_FACE = 0.75f
  const val COVER_SLACK = 0.05f

  enum class Kind { EXACT, NEIGHBOR, HOLD, LIVE, COVER }

  /** Un visage à dessiner : zone (translatée / agrandie) et masque éventuel. */
  class Item(
    val src: FaceResult,
    val patch: FacePatch,
    val dx: Float,
    val dy: Float,
    val scale: Float,
    /** Masque pré-rendu et sa transformation (centre d'ancrage → centre visé). */
    val mask: LandmarkFace?,
    val maskCx: Float,
    val maskCy: Float,
    val maskScale: Float,
    /** Rotation du masque (degrés) : inclinaison BlazeFace actuelle − celle des repères. */
    val maskRotation: Float,
    /** Échelle du halo (même centre et rotation que le masque). */
    val haloScale: Float,
    /** Âge des repères utilisés (ns), -1 sans masque. */
    val landmarkAgeNs: Long,
    /** Ovale de la tête (Flou, Pixels) : `scale` + marge de vitesse (jalon 2f). */
    val headScale: Float = scale,
  )

  class Plan(
    val kind: Kind,
    val items: List<Item>,
    /** Image source du flou plein cadre (COVER), la plus proche disponible. */
    val coverSource: FaceResult?,
    /** Âge de l'analyse utilisée (ns), -1 si inconnu. */
    val analysisAgeNs: Long,
    /** Visages dessinés sans masque alors qu'un masque à repères est demandé. */
    val fallbacks: Int,
    /** Masques maintenus (repères de plus de 100 ms) / écartés faute de couvrir le visage. */
    val held: Int = 0,
    val uncovered: Int = 0,
  )

  private class Pick(val res: FaceResult, val kind: Kind, val scale: Float)

  /**
   * `results` / `landmarks` triés par horodatage croissant. `wantMask` :
   * effet cagoule / intégral choisi ; `effect` : celui des masques pré-rendus.
   */
  fun plan(
    ts: Long,
    results: List<FaceResult>,
    landmarks: List<LandmarkResult>,
    live: Boolean,
    wantMask: Boolean,
    effect: FaceMaskRenderer.Effect,
  ): Plan {
    val latest = results.lastOrNull { it.timestampNs <= ts } ?: results.lastOrNull()
      ?: return Plan(Kind.COVER, emptyList(), null, -1, 0)
    val lastFace = results.lastOrNull { it.timestampNs <= ts && it.faces.isNotEmpty() }
    val lmFace = landmarks.lastOrNull { it.timestampNs <= ts && it.faces.isNotEmpty() }
    val presenceTs = max(lastFace?.timestampNs ?: Long.MIN_VALUE / 2, lmFace?.timestampNs ?: Long.MIN_VALUE / 2)

    val picks = ArrayList<Pick>(2)
    if (live) {
      // Visage absent des analyses depuis > 100 ms, ou analyses trop vieilles.
      if (latest.timestampNs - presenceTs > HOLD_NS || ts - presenceTs > LIVE_MAX_AGE_NS) {
        return Plan(Kind.COVER, emptyList(), latest, ts - latest.timestampNs, 0)
      }
      if (lastFace != null && ts - lastFace.timestampNs <= LIVE_MAX_AGE_NS) picks.add(Pick(lastFace, Kind.LIVE, 1f))
    } else {
      val exact = results.firstOrNull { it.timestampNs == ts }
      if (exact != null && exact.faces.isNotEmpty()) {
        picks.add(Pick(exact, Kind.EXACT, SCALE_EXACT))
      } else if (exact == null) {
        val before = results.lastOrNull { it.timestampNs < ts && ts - it.timestampNs <= NEIGHBOR_WINDOW_NS }
        val after = results.firstOrNull { it.timestampNs > ts && it.timestampNs - ts <= NEIGHBOR_WINDOW_NS }
        for (r in listOfNotNull(before, after)) if (r.faces.isNotEmpty()) picks.add(Pick(r, Kind.NEIGHBOR, SCALE_NEIGHBOR))
      }
      if (picks.isEmpty()) {
        if (lastFace != null && ts - lastFace.timestampNs <= HOLD_NS) {
          picks.add(Pick(lastFace, Kind.HOLD, SCALE_HOLD))
        } else if (!(lmFace != null && ts - lmFace.timestampNs <= HOLD_NS)) {
          return Plan(Kind.COVER, emptyList(), latest, 0, 0)
        }
      }
    }

    val items = ArrayList<Item>()
    var fallbacks = 0
    var held = 0
    var uncovered = 0
    var kind = picks.firstOrNull()?.kind ?: if (live) Kind.LIVE else Kind.HOLD
    for (pick in picks) {
      val src = pick.res
      val dt = if (live) min(max(0L, ts - src.timestampNs), MAX_EXTRAPOLATION_NS) else 0L
      val dtS = dt / 1e9f
      for (p in src.faces) {
        val w = p.rect.width()
        // Prédiction : vitesse lissée de la piste (filtre alpha-bêta adaptatif).
        var dx = p.vx * dtS
        var dy = p.vy * dtS
        val shift = hypot(dx, dy)
        val maxShift = w * MAX_SHIFT
        if (shift > maxShift) {
          dx *= maxShift / shift
          dy *= maxShift / shift
        }
        // Visage qui approche / s'éloigne : taille prédite (±25 %).
        val grow = if (live && w > 0f) (1f + p.vw * dtS / w).coerceIn(0.8f, 1.25f) else 1f
        val scale = if (live) {
          min(MAX_SCALE, grow * (1f + AGE_GROWTH * (dt / 100_000_000f) + SPEED_GROWTH * hypot(dx, dy) / max(w, 1f)))
        } else {
          pick.scale
        }
        val cx = p.rect.centerX() + dx
        val cy = p.rect.centerY() + dy
        val headFaceSide = p.face?.let { max(it.width(), it.height()) } ?: (w / 1.6f)
        val headSpeed = hypot(p.vx, p.vy) / max(headFaceSide, 1f)
        val headScale = min(MAX_SCALE, scale * (1f + HEAD_SPEED_GROWTH * max(0f, headSpeed - HEAD_SPEED_DEAD)))
        var att = if (wantMask) attach(src, p, results, landmarks, effect) else null
        var maskCx = 0f
        var maskCy = 0f
        var maskScale = 1f
        var haloScale = 1f
        var lmAge = -1L
        if (att != null) {
          maskCx = att.anchorCx + (cx - p.rect.centerX()) + att.shiftX
          maskCy = att.anchorCy + (cy - p.rect.centerY()) + att.shiftY
          maskScale = att.sizeRatio * grow * (1f + (scale / grow - 1f) * 0.25f)
          lmAge = max(0L, ts - att.landmarkTs)
          // Vitesse lissée de la boîte, en largeurs de visage / s (comme le maillage).
          val faceSide = p.face?.let { max(it.width(), it.height()) } ?: (w / 1.6f)
          val boxSpeed = hypot(p.vx, p.vy) / max(faceSide, 1f)
          haloScale = maskScale * haloGrowth(hypot(dx, dy) / max(w, 1f), lmAge, max(att.face.meshSpeed, boxSpeed))
          // Le masque (même maintenu) doit couvrir la boîte fraîche du visage.
          if (!covers(att.face, maskCx, maskCy, maskScale, att.rotation, p.face, dx, dy)) {
            att = null
            uncovered++
          } else if (abs(att.landmarkTs - src.timestampNs) > LANDMARK_STALE_NS) {
            held++
          }
        }
        if (wantMask && att == null) fallbacks++
        items.add(
          Item(
            src, p, dx, dy, scale,
            att?.face,
            maskCx, maskCy, maskScale,
            att?.rotation ?: 0f,
            haloScale,
            if (att != null) lmAge else -1L,
            headScale,
          ),
        )
      }
    }

    // Visages vus par les repères seuls (profil perdu par BlazeFace…).
    if (lmFace != null && ts - lmFace.timestampNs <= (if (live) LIVE_MAX_AGE_NS else HOLD_NS)) {
      val src = results.firstOrNull { it.timestampNs == lmFace.timestampNs } ?: latest
      for (lf in lmFace.faces) {
        val fb = lf.fallback ?: continue
        val covered = items.any { it.patch.rect.contains(fb.rect.centerX(), fb.rect.centerY()) }
        if (covered) continue
        val age = max(0L, ts - lmFace.timestampNs)
        val scale = min(MAX_SCALE, 1.15f + AGE_GROWTH * (age / 100_000_000f))
        val ok = wantMask && lf.effect == effect
        if (wantMask && !ok) fallbacks++
        items.add(
          Item(
            src, fb, 0f, 0f, scale,
            if (ok) lf else null,
            fb.rect.centerX(), fb.rect.centerY(), 1f + (scale - 1f) * 0.25f,
            0f,
            (1f + (scale - 1f) * 0.25f) * haloGrowth(0f, age, lf.meshSpeed),
            if (ok) age else -1L,
          ),
        )
        if (picks.isEmpty()) kind = if (live) Kind.LIVE else Kind.HOLD
      }
    }
    if (items.isEmpty()) return Plan(Kind.COVER, emptyList(), latest, ts - latest.timestampNs, 0)
    val age = picks.firstOrNull()?.let { ts - it.res.timestampNs } ?: (ts - (lmFace?.timestampNs ?: ts))
    return Plan(kind, items, null, age, fallbacks, held, uncovered)
  }

  /**
   * Croissance du halo RELATIVE au masque : 1 au repos, plus le mouvement
   * réel (déplacement prédit, vitesse du maillage) et le maintien.
   */
  fun haloGrowth(shiftFraction: Float, landmarkAgeNs: Long, speed: Float): Float {
    val age = max(0L, landmarkAgeNs)
    val g = 1f +
      HALO_SPEED_GROWTH * max(0f, shiftFraction - HALO_SHIFT_DEAD) +
      MESH_SPEED_GROWTH * max(0f, speed - MESH_SPEED_DEAD) * (age / 1e9f) +
      HALO_STALE_GROWTH * max(0f, (age - LANDMARK_STALE_NS) / 50_000_000f)
    return min(MAX_HALO, g)
  }

  /**
   * Le masque posé (centre, échelle, rotation) couvre-t-il la boîte fraîche
   * du visage ? Ses coins (boîte BlazeFace × 0,75, déplacée comme le visage)
   * sont ramenés dans le repère des repères et doivent tomber dans l'emprise
   * de la silhouette (+5 %). Sans boîte BlazeFace : rien à vérifier.
   */
  fun covers(
    f: LandmarkFace,
    maskCx: Float,
    maskCy: Float,
    maskScale: Float,
    rotationDeg: Float,
    face: RectF?,
    dx: Float,
    dy: Float,
  ): Boolean {
    val sil = f.silhouette ?: return true
    if (face == null || maskScale <= 0f) return true
    val hw = face.width() * COVER_FACE / 2f
    val hh = face.height() * COVER_FACE / 2f
    val cx = face.centerX() + dx
    val cy = face.centerY() + dy
    val r = Math.toRadians(-rotationDeg.toDouble())
    val cos = kotlin.math.cos(r).toFloat()
    val sin = kotlin.math.sin(r).toFloat()
    val sx = sil.width() * COVER_SLACK
    val sy = sil.height() * COVER_SLACK
    for (k in 0 until 4) {
      val px = (if (k % 2 == 0) cx - hw else cx + hw) - maskCx
      val py = (if (k < 2) cy - hh else cy + hh) - maskCy
      val qx = (px * cos - py * sin) / maskScale + f.anchor.centerX()
      val qy = (px * sin + py * cos) / maskScale + f.anchor.centerY()
      if (qx < sil.left - sx || qx > sil.right + sx || qy < sil.top - sy || qy > sil.bottom + sy) return false
    }
    return true
  }

  private class Attach(
    val face: LandmarkFace,
    val landmarkTs: Long,
    /** Centre d'ancrage du masque (au moment des repères). */
    val anchorCx: Float,
    val anchorCy: Float,
    /** Déplacement du visage entre les repères et l'analyse `src`. */
    val shiftX: Float,
    val shiftY: Float,
    val sizeRatio: Float,
    /** Inclinaison gagnée depuis les repères (degrés). */
    val rotation: Float,
  )

  /**
   * Repères du visage `p` (analyse `src`) : les plus proches dans le temps
   * (≤ 100 ms), retrouvés via la boîte BlazeFace de LEUR image, puis suivis
   * jusqu'à `p`. Null (→ flou de repli) s'ils sont vieux, d'un autre effet, ou
   * si le visage a trop bougé / changé de taille depuis.
   */
  private fun attach(
    src: FaceResult,
    p: FacePatch,
    results: List<FaceResult>,
    landmarks: List<LandmarkResult>,
    effect: FaceMaskRenderer.Effect,
  ): Attach? {
    // Du plus proche au plus lointain dans le temps (≤ 100 ms) : le premier
    // jeu de repères qui se raccroche à ce visage gagne.
    val candidates = landmarks.filter {
      it.faces.isNotEmpty() && abs(it.timestampNs - src.timestampNs) <= MASK_HOLD_NS &&
        it.bufferWidth == src.bufferWidth && it.bufferHeight == src.bufferHeight
    }.sortedBy { abs(it.timestampNs - src.timestampNs) }
    for (l in candidates) {
      val a = attachTo(l, src, p, results, effect)
      if (a != null) return a
    }
    return null
  }

  private fun attachTo(
    l: LandmarkResult,
    src: FaceResult,
    p: FacePatch,
    results: List<FaceResult>,
    effect: FaceMaskRenderer.Effect,
  ): Attach? {
    val w = p.rect.width()
    // Boîte BlazeFace de l'image des repères (même type que `p`).
    val atL = if (l.timestampNs == src.timestampNs) src else results.firstOrNull { it.timestampNs == l.timestampNs }
    val ref = atL?.let { nearest(it.faces, p.rect.centerX(), p.rect.centerY(), w * 0.6f) }
    // Repère le plus proche de cette boîte (ou de `p` à défaut).
    val refCx = ref?.rect?.centerX() ?: p.rect.centerX()
    val refCy = ref?.rect?.centerY() ?: p.rect.centerY()
    var face: LandmarkFace? = null
    var bestD = Float.MAX_VALUE
    for (f in l.faces) {
      val d = hypot(f.anchor.centerX() - refCx, f.anchor.centerY() - refCy)
      if (d < bestD) {
        bestD = d
        face = f
      }
    }
    val f = face ?: return null
    if (f.effect != effect) return null
    val refW = ref?.rect?.width() ?: w
    // Repères décrochés de la boîte de leur propre image.
    if (bestD > MOVED_FRACTION * refW) return null
    val shiftX: Float
    val shiftY: Float
    val ratio: Float
    if (ref != null) {
      shiftX = p.rect.centerX() - ref.rect.centerX()
      shiftY = p.rect.centerY() - ref.rect.centerY()
      ratio = w / max(ref.rect.width(), 1f)
    } else {
      // Pas de boîte BlazeFace à l'instant des repères : seulement si quasi immobile.
      if (l.timestampNs != src.timestampNs) return null
      shiftX = 0f
      shiftY = 0f
      ratio = 1f
    }
    if (hypot(shiftX, shiftY) > MOVED_FRACTION * w || abs(ratio - 1f) > SIZE_TOLERANCE) return null
    // Jamais plus petit que ses repères : la largeur BlazeFace tremble de
    // ±10–15 % d'une image à l'autre (jalon 2d, vidéo de référence) et un
    // masque rétréci découvrirait le bord du visage. Un visage qui s'éloigne
    // garde un masque un peu grand ≤ 100 ms, sans risque.
    val sizeRatio = max(1f, ratio)
    // Inclinaison : le masque tourne avec la tête (BlazeFace frais) ; un
    // masque qui s'écarte de plus de 30° de l'inclinaison du visage actuel
    // n'est pas posé (flou de repli).
    var rotation = 0f
    if (!p.roll.isNaN()) {
      if (!f.roll.isNaN() && Angles.diff(f.roll, ref?.roll ?: p.roll) > MAX_ROLL_DIFF) return null
      val refRoll = ref?.roll ?: Float.NaN
      if (!refRoll.isNaN()) {
        rotation = Angles.delta(p.roll, refRoll)
        if (abs(rotation) > MAX_ROLL_DIFF) return null
      }
      if (!f.roll.isNaN() && Angles.diff(f.roll + rotation, p.roll) > MAX_ROLL_DIFF) return null
    }
    return Attach(f, l.timestampNs, f.anchor.centerX(), f.anchor.centerY(), shiftX, shiftY, sizeRatio, rotation)
  }

  private fun nearest(faces: List<FacePatch>, x: Float, y: Float, maxDist: Float): FacePatch? {
    var best: FacePatch? = null
    var bestD = maxDist
    for (f in faces) {
      val d = hypot(f.rect.centerX() - x, f.rect.centerY() - y)
      if (d <= bestD) {
        bestD = d
        best = f
      }
    }
    return best
  }
}

/** Un visage : zone agrandie (coordonnées du tampon d'analyse) + vignettes. */
internal class FacePatch(
  val rect: RectF,
  /** Quelques pixels pour la pixellisation (agrandis sans lissage). */
  val pixel: Bitmap,
  /** Encore moins de pixels pour le flou (agrandis avec lissage). */
  val blur: Bitmap,
  /** Le même flou en ellipse plumée (repli des masques, filet de sécurité). */
  val blurOval: Bitmap,
  /** Inclinaison des yeux (BlazeFace ou repères, degrés, tampon) ; NaN si inconnue. */
  val roll: Float = Float.NaN,
  /**
   * Zone serrée du visage (boîte BlazeFace à peine élargie) : petite ellipse
   * floue sous le masque, cachée par lui au repos. Null : pas de filet.
   */
  val core: RectF? = null,
  /** Boîte BlazeFace telle quelle (tampon) : le masque posé doit la couvrir. */
  val face: RectF? = null,
  /**
   * Ovale de la tête (jalon 2f, modes Flou et Pixels) : sprites (flou peint
   * dans la forme, pixels nets dans la forme) et contour de sécurité (tampon).
   * Null : ancien rectangle (repli).
   */
  val headBlur: MaskSprite.Sprite? = null,
  val headPixel: MaskSprite.Sprite? = null,
  val headOutline: FloatArray? = null,
) {
  /** Vitesse lissée du centre et de la largeur (px/s), fixée avant publication. */
  var vx = 0f
  var vy = 0f
  var vw = 0f
}

/** Résultat BlazeFace d'une image caméra (chaque image analysée). */
internal class FaceResult(
  val timestampNs: Long,
  val bufferWidth: Int,
  val bufferHeight: Int,
  /** Capteur → tampon d'analyse (CameraX). */
  val sensorToBuffer: Matrix,
  val faces: List<FacePatch>,
  /** Image entière réduite à quelques pixels : flou plein cadre. */
  val frameTiny: Bitmap,
)

/** Un visage vu par Face Landmarker, masque déjà dessiné (sprite). */
internal class LandmarkFace(
  val effect: FaceMaskRenderer.Effect,
  /** Masque pré-rendu (fond transparent) : zone utile et place dans le tampon. */
  val sprite: Bitmap,
  val spriteSrc: android.graphics.Rect,
  val spriteRect: RectF,
  /** Zone agrandie tirée des repères : ancrage du masque. */
  val anchor: RectF,
  /** Flou de cette zone, si le visage n'est vu que par les repères. */
  val fallback: FacePatch?,
  /** Inclinaison de la ligne des yeux du maillage (degrés, tampon). */
  val roll: Float,
  /** Halo pré-rendu (flou plumé de la silhouette), même repère que le sprite. */
  val halo: Bitmap?,
  val haloSrc: android.graphics.Rect?,
  val haloRect: RectF?,
  /** Vitesse propre du maillage depuis la passe précédente (largeurs de visage / s). */
  val meshSpeed: Float,
  /** Emprise de la silhouette du masque (tampon) : contrôle de couverture. */
  val silhouette: RectF? = null,
  /** Contour du halo (x,y… tampon) : tracé de contrôle (panneau). */
  val haloOutline: FloatArray? = null,
)

/** Résultat Face Landmarker d'une image (pas forcément chaque image). */
internal class LandmarkResult(
  val timestampNs: Long,
  val bufferWidth: Int,
  val bufferHeight: Int,
  val faces: List<LandmarkFace>,
)

/** Les dernières analyses, partagées entre les fils d'analyse et le fil GL. */
internal class FaceStore(private val capacity: Int = 16) {
  private val items = ArrayDeque<FaceResult>()

  @Synchronized
  fun add(r: FaceResult) {
    // Horodatages croissants ; une caméra relancée repart de zéro.
    val last = items.lastOrNull()
    if (last != null && r.timestampNs <= last.timestampNs) items.clear()
    items.addLast(r)
    while (items.size > capacity) items.removeFirst()
  }

  @Synchronized
  fun snapshot(): List<FaceResult> = items.toList()

  @Synchronized
  fun latest(): FaceResult? = items.lastOrNull()

  @Synchronized
  fun clear() = items.clear()
}

internal class LandmarkStore(private val capacity: Int = 6) {
  private val items = ArrayDeque<LandmarkResult>()

  /** Ajoute `r` ; renvoie les résultats sortis (leurs sprites sont réutilisables). */
  @Synchronized
  fun add(r: LandmarkResult): List<LandmarkResult> {
    val out = ArrayList<LandmarkResult>(1)
    val last = items.lastOrNull()
    if (last != null && r.timestampNs <= last.timestampNs) {
      out.addAll(items)
      items.clear()
    }
    items.addLast(r)
    while (items.size > capacity) out.add(items.removeFirst())
    return out
  }

  @Synchronized
  fun snapshot(): List<LandmarkResult> = items.toList()

  @Synchronized
  fun clear() = items.clear()
}
