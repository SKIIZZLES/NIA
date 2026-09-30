package expo.modules.niacomposer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.OverlaySettings
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.RgbMatrix
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.InAppMp4Muxer
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * NIA — export vidéo sur l'appareil (éditeur P0, montage V1, habillage V2).
 *
 * Reçoit une composition JSON (clips vidéo avec début / fin / vitesse,
 * photos fixes en V1, son ajouté, volumes) et produit UN fichier MP4 : H.264
 * (petit côté 720 px, 30 i/s au plus), AAC, débit fixé par l'appelant pour
 * tenir sous le plafond d'envoi.
 * Media3 Transformer 1.9 ; le muxer Media3 (InAppMp4Muxer) place le moov en
 * tête quand il tient dans l'espace réservé (400 Ko, soit bien plus que ce
 * que demandent 3 min) : le résultat « faststart » est vérifié et renvoyé.
 *
 * V2 : calques texte / stickers (PNG capturés par l'app) et filtre NIA
 * (matrice couleur) sont appliqués à la composition entière, après le cadrage
 * de chaque clip : les horaires des calques sont donc en temps de sortie.
 *
 * Un seul export à la fois. Tout ce qui touche au Transformer se fait sur le
 * thread principal (il exige un Looper) ; les promesses sont réglées une
 * seule fois (fin, erreur ou annulation).
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class NiaComposerModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var job: Job? = null

  private class Job(
    val transformer: Transformer,
    val outputPath: String,
    val promise: Promise,
    val outputWidth: Int,
    val outputHeight: Int,
  ) {
    var settled = false
    val progress = ProgressHolder()
  }

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("NiaComposer")

    Events("onProgress")

    Function("isAvailable") { true }

    AsyncFunction("exportAsync") { json: String, promise: Promise ->
      main.post { start(json, promise) }
    }

    AsyncFunction("cancelAsync") { promise: Promise ->
      main.post {
        cancelCurrent()
        promise.resolve(null)
      }
    }

    OnDestroy {
      main.post { cancelCurrent() }
    }
  }

  // --- Démarrage -----------------------------------------------------------

  private fun start(json: String, promise: Promise) {
    if (job != null) {
      promise.reject("ERR_BUSY", "An export is already running", null)
      return
    }
    val request: Request
    try {
      request = parseRequest(JSONObject(json))
    } catch (e: Throwable) {
      promise.reject("ERR_INVALID", e.message ?: "Invalid composition", e)
      return
    }
    try {
      val built = buildComposition(request)
      File(request.outputPath).parentFile?.mkdirs()
      File(request.outputPath).delete()

      val encoderFactory = DefaultEncoderFactory.Builder(context)
        .setRequestedVideoEncoderSettings(
          VideoEncoderSettings.Builder().setBitrate(request.videoBitrate).build(),
        )
        .setRequestedAudioEncoderSettings(
          AudioEncoderSettings.Builder().setBitrate(request.audioBitrate).build(),
        )
        .setEnableFallback(true)
        .build()

      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(encoderFactory)
        .setMuxerFactory(InAppMp4Muxer.Factory())
        .setLooper(Looper.getMainLooper())
        .addListener(listener)
        .build()

      val current = Job(transformer, request.outputPath, promise, built.width, built.height)
      job = current
      transformer.start(built.composition, request.outputPath)
      scheduleProgress(current)
    } catch (e: Throwable) {
      job = null
      File(request.outputPath).delete()
      promise.reject("ERR_EXPORT", e.message ?: "Export failed to start", e)
    }
  }

  private val listener = object : Transformer.Listener {
    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
      val current = job ?: return
      finish(current) {
        val file = File(current.outputPath)
        if (!file.exists() || file.length() == 0L) {
          current.promise.reject("ERR_EXPORT", "Empty output", null)
          return@finish
        }
        val durationMs =
          probeDurationMs(file.absolutePath) ?: exportResult.approximateDurationMs.takeIf { it > 0 } ?: 0L
        current.promise.resolve(
          mapOf(
            "uri" to Uri.fromFile(file).toString(),
            "size" to file.length().toDouble(),
            "durationMs" to durationMs.toDouble(),
            "width" to current.outputWidth,
            "height" to current.outputHeight,
            "fastStart" to (isFastStart(file) == true),
          ),
        )
      }
    }

    override fun onError(
      composition: Composition,
      exportResult: ExportResult,
      exportException: ExportException,
    ) {
      val current = job ?: return
      finish(current) {
        File(current.outputPath).delete()
        current.promise.reject(
          "ERR_EXPORT",
          "${exportException.errorCodeName}: ${exportException.message ?: ""}",
          exportException,
        )
      }
    }
  }

  private inline fun finish(current: Job, body: () -> Unit) {
    if (current.settled) return
    current.settled = true
    if (job === current) job = null
    body()
  }

  private fun cancelCurrent() {
    val current = job ?: return
    try {
      current.transformer.cancel()
    } catch (_: Throwable) {
      // déjà terminé
    }
    finish(current) {
      File(current.outputPath).delete()
      current.promise.reject("ERR_CANCELLED", "Export cancelled", null)
    }
  }

  private fun scheduleProgress(current: Job) {
    main.postDelayed(
      object : Runnable {
        override fun run() {
          if (current.settled || job !== current) return
          try {
            val state = current.transformer.getProgress(current.progress)
            if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
              sendEvent("onProgress", mapOf("progress" to current.progress.progress / 100.0))
            }
          } catch (_: Throwable) {
            // Transformer libéré entre-temps
          }
          main.postDelayed(this, PROGRESS_INTERVAL_MS)
        }
      },
      PROGRESS_INTERVAL_MS,
    )
  }

  // --- Composition ---------------------------------------------------------

  /** `image` (V1) : photo fixe affichée endMs − startMs ms, sans son ni vitesse. */
  private data class Clip(
    val uri: String,
    val startMs: Long,
    val endMs: Long?,
    val speed: Float,
    val image: Boolean,
    val mimeType: String?,
  )

  private data class Audio(val uri: String, val offsetMs: Long, val volume: Float)

  /** V2 : calque PNG, centre (x, y) 0..1, rotation horaire, fenêtre en temps de sortie. */
  private data class OverlaySpec(
    val path: String,
    val x: Float,
    val y: Float,
    val rotation: Float,
    val startMs: Long,
    val endMs: Long?,
  )

  private data class Request(
    val clips: List<Clip>,
    val audio: Audio?,
    val originalVolume: Float,
    val outputPath: String,
    val shortSide: Int,
    val maxWidth: Int,
    val maxHeight: Int,
    val fps: Float,
    val fixedCanvas: Boolean,
    val videoBitrate: Int,
    val audioBitrate: Int,
    val overlays: List<OverlaySpec>,
    val overlayFrameWidth: Int,
    val filterMatrix: FloatArray?,
  )

  private class Built(val composition: Composition, val width: Int, val height: Int)

  private fun parseRequest(o: JSONObject): Request {
    val arr = o.getJSONArray("clips")
    require(arr.length() in 1..MAX_CLIPS) { "clips: 1..$MAX_CLIPS expected" }
    val clips = (0 until arr.length()).map { i ->
      val c = arr.getJSONObject(i)
      val start = max(0L, c.optLong("startMs", 0L))
      val end = if (c.isNull("endMs")) null else c.optLong("endMs", -1L).takeIf { it > start }
      val speed = c.optDouble("speed", 1.0).toFloat().coerceIn(MIN_SPEED, MAX_SPEED)
      val image = c.optBoolean("image", false)
      val mime = if (c.isNull("mimeType")) null else c.optString("mimeType", "").takeIf { it.startsWith("image/") }
      if (image) {
        require(end != null && end - start in MIN_STILL_MS..MAX_STILL_MS) { "image clip: duration expected" }
        Clip(c.getString("uri"), 0L, end - start, 1f, true, mime ?: "image/jpeg")
      } else {
        Clip(c.getString("uri"), start, end, speed, false, null)
      }
    }
    val audio = if (o.isNull("audio") || !o.has("audio")) null else o.getJSONObject("audio").let { a ->
      Audio(
        a.getString("uri"),
        max(0L, a.optLong("offsetMs", 0L)),
        a.optDouble("volume", 1.0).toFloat().coerceIn(0f, 1f),
      )
    }
    val overlays = if (!o.has("overlays") || o.isNull("overlays")) emptyList() else {
      val list = o.getJSONArray("overlays")
      require(list.length() <= MAX_OVERLAYS) { "overlays: at most $MAX_OVERLAYS" }
      (0 until list.length()).map { i ->
        val v = list.getJSONObject(i)
        val path = v.getString("uri").removePrefix("file://")
        require(path.startsWith("/")) { "overlay uri must be a local file" }
        val start = max(0L, v.optLong("startMs", 0L))
        val end = if (v.isNull("endMs")) null else v.optLong("endMs", -1L).takeIf { it > start }
        OverlaySpec(
          path = path,
          x = v.optDouble("x", 0.5).toFloat().coerceIn(0f, 1f),
          y = v.optDouble("y", 0.5).toFloat().coerceIn(0f, 1f),
          rotation = v.optDouble("rotation", 0.0).toFloat().takeIf { it.isFinite() } ?: 0f,
          startMs = start,
          endMs = end,
        )
      }
    }
    val filterMatrix = if (!o.has("filter") || o.isNull("filter")) null else {
      val m = o.getJSONObject("filter").getJSONArray("matrix")
      require(m.length() == 16) { "filter.matrix: 16 values expected" }
      FloatArray(16) { i ->
        val v = m.getDouble(i).toFloat()
        require(v.isFinite() && abs(v) <= 4f) { "filter.matrix: invalid value" }
        v
      }
    }
    val out = o.getJSONObject("output")
    val path = out.getString("path").removePrefix("file://")
    require(path.startsWith("/")) { "output.path must be absolute" }
    return Request(
      clips = clips,
      audio = audio,
      originalVolume = o.optDouble("originalVolume", 1.0).toFloat().coerceIn(0f, 1f),
      outputPath = path,
      shortSide = out.optInt("shortSide", 720).coerceIn(144, 2160),
      maxWidth = out.optInt("maxWidth", 720),
      maxHeight = out.optInt("maxHeight", 1280),
      fps = out.optDouble("fps", 30.0).toFloat().coerceIn(1f, 60f),
      // Une photo en tête n'a pas de format vidéo à suivre : cadre fixe.
      fixedCanvas = out.optBoolean("fixedCanvas", false) || clips[0].image,
      videoBitrate = out.optInt("videoBitrate", 2_000_000).coerceIn(200_000, 20_000_000),
      audioBitrate = out.optInt("audioBitrate", 128_000).coerceIn(32_000, 320_000),
      overlays = overlays,
      overlayFrameWidth = o.optInt("overlayFrameWidth", 0),
      filterMatrix = filterMatrix,
    )
  }

  private fun buildComposition(r: Request): Built {
    // Taille de sortie (P0) : format (après rotation) du premier clip, petit
    // côté ramené à shortSide, dans une boîte maxWidth × maxHeight (orientée
    // comme le clip). V1 (montage) : cadre fixe maxWidth × maxHeight. Un clip
    // d'un autre format est inscrit dans ce cadre (bandes noires).
    val (outW, outH) = if (r.fixedCanvas) {
      Pair(max(2, even(r.maxWidth)), max(2, even(r.maxHeight)))
    } else {
      val first = probeVideo(r.clips[0].uri) ?: throw IllegalArgumentException("Unreadable video")
      outputSize(first.width, first.height, r.shortSide, r.maxWidth, r.maxHeight)
    }
    val present = Presentation.createForWidthAndHeight(outW, outH, Presentation.LAYOUT_SCALE_TO_FIT)

    var totalOutMs = 0.0
    val items = r.clips.map { clip ->
      if (clip.image) {
        // Photo fixe : Media3 la répète à `fps` images/s pendant sa durée ;
        // la séquence (pistes audio + vidéo) comble le son par du silence.
        val durationMs = clip.endMs ?: STILL_DEFAULT_MS
        totalOutMs += durationMs.toDouble()
        val item = MediaItem.Builder()
          .setUri(Uri.parse(clip.uri))
          .setMimeType(clip.mimeType ?: MimeTypes.IMAGE_JPEG)
          .setImageDurationMs(durationMs)
          .build()
        return@map EditedMediaItem.Builder(item)
          .setFrameRate(r.fps.roundToInt().coerceAtLeast(1))
          .setEffects(Effects(emptyList(), listOf<Effect>(present)))
          .build()
      }
      val info = probeVideo(clip.uri) ?: throw IllegalArgumentException("Unreadable video: clip")
      val srcEnd = info.durationMs.takeIf { it > 0 }
      val end = when {
        clip.endMs != null && srcEnd != null -> min(clip.endMs, srcEnd)
        clip.endMs != null -> clip.endMs
        srcEnd != null -> srcEnd
        else -> throw IllegalArgumentException("Unknown clip duration")
      }
      require(end - clip.startMs >= MIN_CLIP_MS) { "Clip too short" }
      totalOutMs += (end - clip.startMs) / clip.speed.toDouble()

      val mediaItem = MediaItem.Builder()
        .setUri(Uri.parse(clip.uri))
        .setClippingConfiguration(
          MediaItem.ClippingConfiguration.Builder()
            .setStartPositionMs(clip.startMs)
            .setEndPositionMs(end)
            .build(),
        )
        .build()
      val videoEffects: List<Effect> = listOf(
        present,
        FrameDropEffect.createDefaultFrameDropEffect(r.fps),
      )
      val audioProcessors: List<AudioProcessor> =
        if (abs(r.originalVolume - 1f) > 0.001f) listOf(volumeProcessor(r.originalVolume)) else emptyList()
      val builder = EditedMediaItem.Builder(mediaItem).setEffects(Effects(audioProcessors, videoEffects))
      if (abs(clip.speed - 1f) > 0.001f) builder.setSpeed(ConstantSpeed(clip.speed))
      builder.build()
    }

    val videoSequence = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO))
      .addItems(items)
      .build()
    val sequences = mutableListOf(videoSequence)

    // Son ajouté : il démarre à offsetMs, joue à vitesse normale sur la
    // timeline finale et reprend du début du son quand il est plus court
    // (même règle que lib/soundSync côté lecture). Découpé pour durer
    // exactement la vidéo : ni blanc, ni vidéo prolongée.
    val audio = r.audio
    if (audio != null && audio.volume > 0.001f) {
      val soundMs = probeDurationMs(audio.uri) ?: throw IllegalArgumentException("Unreadable sound")
      require(soundMs >= MIN_CLIP_MS) { "Sound too short" }
      val audioItems = mutableListOf<EditedMediaItem>()
      var remaining = totalOutMs.roundToLong()
      var start = if (audio.offsetMs < soundMs - MIN_CLIP_MS) audio.offsetMs else 0L
      while (remaining > 0 && audioItems.size < MAX_AUDIO_ITEMS) {
        val end = min(soundMs, start + remaining)
        if (end - start < 20) break
        val item = MediaItem.Builder()
          .setUri(Uri.parse(audio.uri))
          .setClippingConfiguration(
            MediaItem.ClippingConfiguration.Builder()
              .setStartPositionMs(start)
              .setEndPositionMs(end)
              .build(),
          )
          .build()
        val processors: List<AudioProcessor> =
          if (abs(audio.volume - 1f) > 0.001f) listOf(volumeProcessor(audio.volume)) else emptyList()
        audioItems += EditedMediaItem.Builder(item)
          .setRemoveVideo(true)
          .setEffects(Effects(processors, emptyList()))
          .build()
        remaining -= end - start
        start = 0L
      }
      if (audioItems.isNotEmpty()) {
        sequences += EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
          .addItems(audioItems)
          .build()
      }
    }

    // V2 : habillage cuit sur la composition entière (après le cadrage de
    // chaque clip, donc dans le cadre de sortie, horaires en temps de sortie).
    // Ordre de l'aperçu : filtre d'abord, calques par-dessus.
    // Les images des calques ne sont pas recyclées à la main : le fil GL du
    // Transformer peut encore les lire juste après une annulation ; le GC les
    // libère avec la composition.
    val compositionEffects = mutableListOf<Effect>()
    r.filterMatrix?.let { compositionEffects += FixedRgbMatrix(it) }
    if (r.overlays.isNotEmpty()) {
      require(r.overlayFrameWidth > 0) { "overlayFrameWidth expected" }
      // Capture faite dans un cadre de overlayFrameWidth px : même échelle pour tous.
      val scale = outW.toFloat() / r.overlayFrameWidth
      val textures = r.overlays.map { spec ->
        val bmp = BitmapFactory.decodeFile(spec.path)
          ?: throw IllegalArgumentException("Unreadable overlay image")
        TimedBitmapOverlay(
          bmp,
          startUs = spec.startMs * 1000L,
          endUs = spec.endMs?.let { it * 1000L } ?: Long.MAX_VALUE,
          shown = StaticOverlaySettings.Builder()
            // Repère Media3 : NDC, y vers le haut ; rotation antihoraire.
            .setBackgroundFrameAnchor(2f * spec.x - 1f, 1f - 2f * spec.y)
            .setScale(scale, scale)
            .setRotationDegrees(-spec.rotation)
            .build(),
        )
      }
      compositionEffects += OverlayEffect(textures.map { it as TextureOverlay })
    }
    val builder = Composition.Builder(sequences)
    if (compositionEffects.isNotEmpty()) builder.setEffects(Effects(emptyList(), compositionEffects))
    return Built(builder.build(), outW, outH)
  }

  /** V2 : matrice couleur fixe (colonnes d'abord), appliquée à chaque image. */
  private class FixedRgbMatrix(private val matrix: FloatArray) : RgbMatrix {
    override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean): FloatArray = matrix
  }

  /** V2 : calque visible de startUs (inclus) à endUs (exclu) ; ailleurs, transparent. */
  private class TimedBitmapOverlay(
    private val bitmap: Bitmap,
    private val startUs: Long,
    private val endUs: Long,
    private val shown: StaticOverlaySettings,
  ) : BitmapOverlay() {
    private val hidden: StaticOverlaySettings = StaticOverlaySettings.Builder().setAlphaScale(0f).build()

    override fun getBitmap(presentationTimeUs: Long): Bitmap = bitmap

    override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings =
      if (presentationTimeUs in startUs until endUs) shown else hidden
  }

  private class ConstantSpeed(private val speed: Float) : SpeedProvider {
    override fun getSpeed(timeUs: Long): Float = speed
    override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
  }

  /** Gain constant ; toute source mono ou stéréo sort en stéréo (mixage homogène). */
  private fun volumeProcessor(volume: Float): AudioProcessor {
    val p = ChannelMixingAudioProcessor()
    p.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(1, 2).scaleBy(volume))
    p.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(2, 2).scaleBy(volume))
    return p
  }

  // --- Lecture des fichiers -----------------------------------------------

  private data class VideoInfo(val width: Int, val height: Int, val durationMs: Long)

  private fun <T> withRetriever(uri: String, body: (MediaMetadataRetriever) -> T): T? {
    val r = MediaMetadataRetriever()
    return try {
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        r.setDataSource(uri, HashMap())
      } else {
        r.setDataSource(context, Uri.parse(if (uri.startsWith("/")) "file://$uri" else uri))
      }
      body(r)
    } catch (_: Throwable) {
      null
    } finally {
      try {
        r.release()
      } catch (_: Throwable) {
        // rien
      }
    }
  }

  private fun probeVideo(uri: String): VideoInfo? = withRetriever(uri) { r ->
    val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
    val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
    val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    val d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
    if (w <= 0 || h <= 0) null
    else if (rot % 180 != 0) VideoInfo(h, w, d)
    else VideoInfo(w, h, d)
  }

  private fun probeDurationMs(uri: String): Long? = withRetriever(uri) { r ->
    r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.takeIf { it > 0 }
  }

  /** Vrai si le moov précède le mdat (lecture progressive immédiate). */
  private fun isFastStart(file: File): Boolean? = try {
    RandomAccessFile(file, "r").use { f ->
      var pos = 0L
      val len = f.length()
      var result: Boolean? = null
      while (pos + 8 <= len) {
        f.seek(pos)
        var size = f.readInt().toLong() and 0xffffffffL
        val type = ByteArray(4).also { f.readFully(it) }.toString(Charsets.US_ASCII)
        if (size == 1L) size = f.readLong() else if (size == 0L) size = len - pos
        if (type == "moov") { result = true; break }
        if (type == "mdat") { result = false; break }
        if (size < 8) break
        pos += size
      }
      result
    }
  } catch (_: Throwable) {
    null
  }

  companion object {
    private const val PROGRESS_INTERVAL_MS = 250L
    private const val MAX_CLIPS = 100
    private const val MAX_AUDIO_ITEMS = 200
    private const val MIN_CLIP_MS = 100L
    private const val MIN_SPEED = 0.25f
    private const val MAX_SPEED = 4f
    private const val MIN_STILL_MS = 100L
    private const val MAX_STILL_MS = 60_000L
    private const val STILL_DEFAULT_MS = 3_000L
    private const val MAX_OVERLAYS = 20

    /** Dimensions paires, petit côté ≤ shortSide, dans la boîte maxW × maxH orientée comme la source. */
    fun outputSize(srcW: Int, srcH: Int, shortSide: Int, maxW: Int, maxH: Int): Pair<Int, Int> {
      val portrait = srcH >= srcW
      val boxW = if (portrait) min(maxW, maxH) else max(maxW, maxH)
      val boxH = if (portrait) max(maxW, maxH) else min(maxW, maxH)
      // Jamais d'agrandissement : une source plus petite garde sa taille.
      val scale = minOf(
        1.0,
        shortSide.toDouble() / min(srcW, srcH),
        min(boxW.toDouble() / srcW, boxH.toDouble() / srcH),
      )
      val w = even((srcW * scale).roundToInt())
      val h = even((srcH * scale).roundToInt())
      return Pair(max(2, w), max(2, h))
    }

    fun even(v: Int): Int = if (v % 2 == 0) v else v - 1
  }
}
