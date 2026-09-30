package expo.modules.niacamera

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.RectF

/**
 * Règle « en cas de doute, on cache » (A1, validée par le fondateur).
 *
 * Pour chaque image à afficher ET à enregistrer, on choisit quoi masquer à
 * partir des analyses MediaPipe voisines dans le temps :
 *  1. EXACT    — l'analyse de cette image même a trouvé des visages ;
 *  2. NEIGHBOR — pas d'analyse pour cette image, mais une analyse à moins de
 *                70 ms (avant ou après) a trouvé des visages : on masque
 *                l'union, agrandie ;
 *  3. HOLD     — visage perdu depuis 100 ms au plus : on garde le dernier
 *                masque, encore agrandi ;
 *  4. COVER    — sinon (visage perdu > 100 ms, analyse bloquée, détecteur en
 *                panne) : flou de l'image entière, cuit dans le fichier.
 *
 * Il n'existe aucun chemin qui laisse passer une image sans masque ni flou.
 * Aucune donnée du visage n'est gardée au-delà des ~16 dernières analyses
 * (≈ 0,5 s), en mémoire vive, jamais écrite ni envoyée.
 */
internal object FaceMaskPolicy {
  const val NEIGHBOR_WINDOW_NS = 70_000_000L
  const val HOLD_NS = 100_000_000L

  const val SCALE_EXACT = 1.0f
  const val SCALE_NEIGHBOR = 1.15f
  const val SCALE_HOLD = 1.3f

  enum class Kind { EXACT, NEIGHBOR, HOLD, COVER }

  class Plan(
    val kind: Kind,
    /** Analyses dont on dessine les visages (vide pour COVER). */
    val sources: List<FaceResult>,
    val scale: Float,
    /** Image source du flou plein cadre (COVER), la plus proche disponible. */
    val coverSource: FaceResult?,
  )

  /** `results` triés par horodatage croissant. */
  fun plan(ts: Long, results: List<FaceResult>): Plan {
    val exact = results.firstOrNull { it.timestampNs == ts }
    if (exact != null && exact.faces.isNotEmpty()) {
      return Plan(Kind.EXACT, listOf(exact), SCALE_EXACT, null)
    }
    if (exact == null) {
      val before = results.lastOrNull { it.timestampNs < ts && ts - it.timestampNs <= NEIGHBOR_WINDOW_NS }
      val after = results.firstOrNull { it.timestampNs > ts && it.timestampNs - ts <= NEIGHBOR_WINDOW_NS }
      val withFaces = listOfNotNull(before, after).filter { it.faces.isNotEmpty() }
      if (withFaces.isNotEmpty()) {
        return Plan(Kind.NEIGHBOR, withFaces, SCALE_NEIGHBOR, null)
      }
    }
    val lastFace = results.lastOrNull { it.timestampNs <= ts && it.faces.isNotEmpty() }
    if (lastFace != null && ts - lastFace.timestampNs <= HOLD_NS) {
      return Plan(Kind.HOLD, listOf(lastFace), SCALE_HOLD, null)
    }
    val cover = results.lastOrNull { it.timestampNs <= ts } ?: results.firstOrNull()
    return Plan(Kind.COVER, emptyList(), 1f, cover)
  }
}

/** Un visage : zone agrandie (coordonnées du tampon d'analyse) + vignettes. */
internal class FacePatch(
  val rect: RectF,
  /** Quelques pixels pour la pixellisation (agrandis sans lissage). */
  val pixel: Bitmap,
  /** Encore moins de pixels pour le flou (agrandis avec lissage). */
  val blur: Bitmap,
  /**
   * Formes du masque (jalon 2), si Face Landmarker a trouvé ce visage. Sans
   * elles, le visage reste couvert par le flou de `rect` (repli).
   */
  val mask: FaceMask? = null,
)

/** Résultat d'une analyse, pour une image caméra donnée. */
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

/** Les dernières analyses, partagées entre le fil d'analyse et le fil GL. */
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
