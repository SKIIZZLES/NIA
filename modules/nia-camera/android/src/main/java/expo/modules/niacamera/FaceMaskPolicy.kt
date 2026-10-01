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
 *  - un visage sans repères frais (> 100 ms) ou qui a bougé depuis ses
 *    repères garde le flou (repli), jamais le masque seul ;
 *  - sous chaque masque, le flou elliptique de la zone du visage ;
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
  /** Repères utilisables jusqu'à 100 ms de l'analyse du visage. */
  const val LANDMARK_STALE_NS = 100_000_000L
  /** Prolongation maximale du mouvement (LIVE). */
  const val MAX_EXTRAPOLATION_NS = 150_000_000L
  const val VELOCITY_WINDOW_NS = 150_000_000L
  const val VELOCITY_SPAN_NS = 100_000_000L

  const val SCALE_EXACT = 1.0f
  const val SCALE_NEIGHBOR = 1.15f
  const val SCALE_HOLD = 1.3f
  /** LIVE : +12 % par tranche de 100 ms d'âge, + la part du déplacement prédit. */
  const val AGE_GROWTH = 0.12f
  const val SPEED_GROWTH = 0.8f
  const val MAX_SCALE = 1.8f
  /** Déplacement prédit ≤ 60 % de la largeur du visage. */
  const val MAX_SHIFT = 0.6f
  /** Repères « décrochés » : centre à plus de 30 % de la largeur, taille ±35 %. */
  const val MOVED_FRACTION = 0.3f
  const val SIZE_TOLERANCE = 0.35f

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
    /** Âge des repères utilisés (ns), -1 sans masque. */
    val landmarkAgeNs: Long,
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
    var kind = picks.firstOrNull()?.kind ?: if (live) Kind.LIVE else Kind.HOLD
    for (pick in picks) {
      val src = pick.res
      // Vitesse mesurée sur ~100 ms (pas d'une image à l'autre : le
      // tremblement des boîtes serait amplifié par la prolongation).
      var prev: FaceResult? = null
      if (live) {
        for (r in results) {
          val span = src.timestampNs - r.timestampNs
          if (span <= 0 || span > VELOCITY_WINDOW_NS || r.faces.isEmpty()) continue
          if (prev == null || abs(span - VELOCITY_SPAN_NS) < abs(src.timestampNs - prev.timestampNs - VELOCITY_SPAN_NS)) prev = r
        }
      }
      val dt = if (live) min(max(0L, ts - src.timestampNs), MAX_EXTRAPOLATION_NS) else 0L
      for (p in src.faces) {
        val w = p.rect.width()
        var dx = 0f
        var dy = 0f
        if (prev != null && dt > 0) {
          val q = nearest(prev.faces, p.rect.centerX(), p.rect.centerY(), w * 0.6f)
          if (q != null) {
            val span = (src.timestampNs - prev.timestampNs).toFloat()
            if (span > 0f) {
              dx = (p.rect.centerX() - q.rect.centerX()) / span * dt
              dy = (p.rect.centerY() - q.rect.centerY()) / span * dt
              val shift = hypot(dx, dy)
              val maxShift = w * MAX_SHIFT
              if (shift > maxShift) {
                dx *= maxShift / shift
                dy *= maxShift / shift
              }
            }
          }
        }
        val scale = if (live) {
          min(MAX_SCALE, 1f + AGE_GROWTH * (dt / 100_000_000f) + SPEED_GROWTH * hypot(dx, dy) / max(w, 1f))
        } else {
          pick.scale
        }
        val cx = p.rect.centerX() + dx
        val cy = p.rect.centerY() + dy
        val att = if (wantMask) attach(src, p, results, landmarks, effect) else null
        if (wantMask && att == null) fallbacks++
        items.add(
          Item(
            src, p, dx, dy, scale,
            att?.face,
            att?.let { it.anchorCx + (cx - p.rect.centerX()) + it.shiftX } ?: 0f,
            att?.let { it.anchorCy + (cy - p.rect.centerY()) + it.shiftY } ?: 0f,
            att?.let { it.sizeRatio * (1f + (scale - 1f) * 0.25f) } ?: 1f,
            att?.let { ts - it.landmarkTs } ?: -1L,
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
            if (ok) age else -1L,
          ),
        )
        if (picks.isEmpty()) kind = if (live) Kind.LIVE else Kind.HOLD
      }
    }
    if (items.isEmpty()) return Plan(Kind.COVER, emptyList(), latest, ts - latest.timestampNs, 0)
    val age = picks.firstOrNull()?.let { ts - it.res.timestampNs } ?: (ts - (lmFace?.timestampNs ?: ts))
    return Plan(kind, items, null, age, fallbacks)
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
      it.faces.isNotEmpty() && abs(it.timestampNs - src.timestampNs) <= LANDMARK_STALE_NS &&
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
    return Attach(f, l.timestampNs, f.anchor.centerX(), f.anchor.centerY(), shiftX, shiftY, ratio)
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
  /** Le même flou en ellipse aux bords doux (dessous des masques). */
  val blurOval: Bitmap,
)

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
