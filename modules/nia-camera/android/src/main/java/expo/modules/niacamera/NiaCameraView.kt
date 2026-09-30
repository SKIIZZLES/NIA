package expo.modules.niacamera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraEffect
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.effects.OverlayEffect
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Caméra « visage masqué » (A1, jalon 1).
 *
 * CameraX : Preview + VideoCapture + ImageAnalysis, et un OverlayEffect
 * appliqué à Preview ET VideoCapture. Chaque image attend (file de
 * QUEUE_DEPTH images) que MediaPipe l'ait analysée, puis le masque est
 * dessiné dessus avant l'aperçu et l'encodeur : aucun fichier brut n'existe.
 */
@SuppressLint("ViewConstructor")
class NiaCameraView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext),
  FaceAnalyzer.Listener {

  private val onCameraReady by EventDispatcher<Unit>()
  private val onMountError by EventDispatcher<Map<String, Any>>()
  private val onFaceChange by EventDispatcher<Map<String, Any>>()
  private val onStats by EventDispatcher<Map<String, Any>>()

  private val mainHandler = Handler(Looper.getMainLooper())
  private val mainExecutor = ContextCompat.getMainExecutor(context)
  private val glThread = HandlerThread("NiaCameraEffect").apply { start() }
  private val glHandler = Handler(glThread.looper)
  private val glExecutor = Executor { r -> glHandler.post(r) }
  private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread(r, "NiaCameraAnalysis")
  }

  private val previewView = PreviewView(context).apply {
    scaleType = PreviewView.ScaleType.FILL_CENTER
    elevation = 0f
  }

  private val store = FaceStore()
  private val stats = NiaCameraStats()
  private val renderer = FaceMaskRenderer(store, stats)
  private var analyzer: FaceAnalyzer? = null

  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var boundCases: List<UseCase> = emptyList()
  private var effect: OverlayEffect? = null
  private var recorder: Recorder? = null
  private var activeRecording: Recording? = null
  private var recordPromise: Promise? = null
  private var released = false
  private var needsBind = true
  private var boundFacing: String? = null
  private var cameraStateObserver: Observer<CameraState>? = null

  // Props
  var facing: String = "back"
  var mute: Boolean = false
  private var zoom: Float = 0f
  private var torch: Boolean = false

  /** Synchro stricte (drawFrameAsync) ; sinon libération par la file seule. */
  @Volatile
  private var exactSync = true
  private var consecutiveMisses = 0

  // Détection « visage présent » pour le déclencheur (hystérésis).
  private var faceStreak = 0
  private var noFaceStreak = 0
  private var faceReported: Boolean? = null

  init {
    addView(previewView)
    scheduleStats()
  }

  // --- Props -----------------------------------------------------------------

  fun setEffectMode(value: String) {
    renderer.effect = if (value == "pixelate") FaceMaskRenderer.Effect.PIXELATE else FaceMaskRenderer.Effect.BLUR
  }

  fun setSyncMode(value: String) {
    exactSync = value != "queue"
    consecutiveMisses = 0
  }

  fun setZoom(value: Float) {
    zoom = value.coerceIn(0f, 1f)
    camera?.cameraControl?.setLinearZoom(zoom)
  }

  fun setTorch(value: Boolean) {
    torch = value
    applyTorch()
  }

  fun onPropsUpdated() {
    if (boundFacing != facing) needsBind = true
    if (needsBind && isAttachedToWindow) bind()
  }

  private fun applyTorch() {
    val cam = camera ?: return
    if (cam.cameraInfo.hasFlashUnit()) cam.cameraControl.enableTorch(torch)
  }

  // --- Mise en page (comme expo-camera) --------------------------------------

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    measureChild(previewView, widthMeasureSpec, heightMeasureSpec)
    setMeasuredDimension(
      resolveSize(previewView.measuredWidth, widthMeasureSpec),
      resolveSize(previewView.measuredHeight, heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    previewView.layout(0, 0, right - left, bottom - top)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (needsBind) bind()
  }

  // --- Caméra -----------------------------------------------------------------

  private fun bind() {
    if (released) return
    needsBind = false
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        doBind(future.get())
      } catch (e: Throwable) {
        Log.e(TAG, "Liaison caméra impossible", e)
        needsBind = true
        onMountError(mapOf("code" to "ERR_CAMERA", "message" to (e.message ?: e.javaClass.simpleName)))
      }
    }, mainExecutor)
  }

  private fun doBind(p: ProcessCameraProvider) {
    if (released) return
    val owner = appContext.currentActivity as? LifecycleOwner
      ?: throw IllegalStateException("Activité indisponible")
    provider = p
    stopRecordingInternal()
    cameraStateObserver?.let { obs -> camera?.cameraInfo?.cameraState?.removeObserver(obs) }
    // Session propre : expo-camera est démontée avant (délai côté JS).
    p.unbindAll()
    effect?.close()
    effect = null
    closeAnalyzer()
    store.clear()

    val selector = if (facing == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    val ratio = AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY

    val preview = Preview.Builder()
      .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(ratio).build())
      .build()
      .also { it.surfaceProvider = previewView.surfaceProvider }

    val rec = Recorder.Builder()
      .setExecutor(mainExecutor)
      .setQualitySelector(
        QualitySelector.from(Quality.HD, FallbackStrategy.lowerQualityOrHigherThan(Quality.HD)),
      )
      .build()
    recorder = rec
    val videoCapture = VideoCapture.withOutput(rec)

    val analysis = ImageAnalysis.Builder()
      .setResolutionSelector(
        ResolutionSelector.Builder()
          .setAspectRatioStrategy(ratio)
          .setResolutionStrategy(
            ResolutionStrategy(Size(640, 360), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER),
          )
          .build(),
      )
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .build()
    renderer.detectorFailed = false
    val a = FaceAnalyzer(context, store, this)
    analyzer = a
    analysis.setAnalyzer(analysisExecutor, a)

    val overlay = OverlayEffect(
      CameraEffect.PREVIEW or CameraEffect.VIDEO_CAPTURE,
      QUEUE_DEPTH,
      glHandler,
    ) { t -> Log.e(TAG, "OverlayEffect en erreur", t) }
    overlay.setOnDrawListener { frame -> renderer.onDraw(frame) }
    effect = overlay

    val group = UseCaseGroup.Builder()
      .addUseCase(preview)
      .addUseCase(videoCapture)
      .addUseCase(analysis)
      .addEffect(overlay)
      .build()
    val cam = p.bindToLifecycle(owner, selector, group)
    camera = cam
    boundCases = listOf(preview, videoCapture, analysis)
    boundFacing = facing
    cam.cameraControl.setLinearZoom(zoom)
    val obs = Observer<CameraState> { state ->
      if (state.type == CameraState.Type.OPEN) {
        applyTorch()
        onCameraReady(Unit)
      }
      state.error?.let { err -> Log.w(TAG, "État caméra : erreur ${err.code}") }
    }
    cameraStateObserver = obs
    cam.cameraInfo.cameraState.observe(owner, obs)
    Log.i(TAG, "caméra liée facing=$facing queue=$QUEUE_DEPTH")
  }

  // --- FaceAnalyzer.Listener (fil d'analyse) ----------------------------------

  override fun onAnalyzed(timestampNs: Long, faceCount: Int, detectMs: Float, totalMs: Float) {
    stats.onAnalyzed(faceCount, detectMs, totalMs)
    val fx = effect
    if (exactSync && fx != null) {
      val future = fx.drawFrameAsync(timestampNs)
      future.addListener({
        val ok = try {
          future.get() == OverlayEffect.RESULT_SUCCESS
        } catch (_: Throwable) {
          false
        }
        stats.onSync(ok)
        if (ok) {
          consecutiveMisses = 0
        } else if (++consecutiveMisses >= MAX_SYNC_MISSES && exactSync) {
          // Horodatages analyse / image non concordants : on garde la file
          // (plus de latence, toujours masqué) au lieu de vider l'aperçu.
          exactSync = false
          Log.w(TAG, "drawFrameAsync ne trouve pas les images : passage en mode file")
        }
      }, glExecutor)
    }
    mainHandler.post { updateFacePresence(faceCount > 0) }
  }

  override fun onDetectorError(message: String) {
    renderer.detectorFailed = true
    mainHandler.post {
      onMountError(mapOf("code" to "ERR_DETECTOR", "message" to message))
    }
  }

  private fun updateFacePresence(face: Boolean) {
    if (face) {
      faceStreak++
      noFaceStreak = 0
    } else {
      noFaceStreak++
      faceStreak = 0
    }
    val next = when {
      faceStreak >= FACE_ON_STREAK -> true
      noFaceStreak >= FACE_OFF_STREAK -> false
      else -> faceReported ?: false
    }
    if (next != faceReported) {
      faceReported = next
      onFaceChange(mapOf("detected" to next))
    }
  }

  private fun scheduleStats() {
    mainHandler.postDelayed(object : Runnable {
      override fun run() {
        if (released) return
        val mode = if (exactSync) "exact" else "queue"
        val effectName = if (renderer.effect == FaceMaskRenderer.Effect.PIXELATE) "pixelate" else "blur"
        stats.flush(SystemClock.elapsedRealtime(), mode, effectName)?.let { onStats(it) }
        mainHandler.postDelayed(this, 1000)
      }
    }, 1000)
  }

  // --- Enregistrement -----------------------------------------------------------

  fun record(maxDurationSec: Double, maxFileSize: Double, promise: Promise) {
    val rec = recorder
    if (rec == null || camera == null) {
      promise.reject("ERR_NOT_READY", "Caméra pas prête", null)
      return
    }
    if (activeRecording != null) {
      promise.reject("ERR_BUSY", "Enregistrement déjà en cours", null)
      return
    }
    val dir = File(context.cacheDir, "NiaCamera").apply { mkdirs() }
    val file = File(dir, "masque-${System.currentTimeMillis()}.mp4")
    val options = FileOutputOptions.Builder(file).apply {
      if (maxFileSize > 0) setFileSizeLimit(maxFileSize.toLong())
      if (maxDurationSec > 0) setDurationLimitMillis((maxDurationSec * 1000).toLong())
    }.build()
    val micOk = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED
    var pending = rec.prepareRecording(context, options)
    if (!mute && micOk) pending = pending.withAudioEnabled()
    recordPromise = promise
    activeRecording = pending.start(mainExecutor) { event ->
      if (event is VideoRecordEvent.Finalize) {
        activeRecording = null
        val p = recordPromise
        recordPromise = null
        when (event.error) {
          VideoRecordEvent.Finalize.ERROR_NONE,
          VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED,
          VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED,
          VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE -> {
            p?.resolve(mapOf("uri" to Uri.fromFile(file).toString()))
          }
          else -> {
            file.delete()
            p?.reject("ERR_RECORDING", event.cause?.message ?: "Enregistrement échoué (${event.error})", event.cause)
          }
        }
      }
    }
  }

  fun stopRecording() {
    activeRecording?.stop()
  }

  private fun stopRecordingInternal() {
    try {
      activeRecording?.stop()
    } catch (_: Throwable) {
    }
  }

  /** Ferme le détecteur sur le fil d'analyse, après l'image en cours. */
  private fun closeAnalyzer() {
    val old = analyzer ?: return
    analyzer = null
    old.markClosed()
    try {
      analysisExecutor.execute { old.close() }
    } catch (_: Throwable) {
      // exécuteur déjà arrêté
    }
  }

  // --- Libération ----------------------------------------------------------------

  fun release() {
    if (released) return
    released = true
    mainHandler.removeCallbacksAndMessages(null)
    stopRecordingInternal()
    cameraStateObserver?.let { obs -> camera?.cameraInfo?.cameraState?.removeObserver(obs) }
    // Nos cas d'usage seulement : ne pas couper une autre caméra montée ensuite.
    try {
      if (boundCases.isNotEmpty()) provider?.unbind(*boundCases.toTypedArray())
    } catch (e: Throwable) {
      Log.w(TAG, "unbind", e)
    }
    boundCases = emptyList()
    camera = null
    effect?.close()
    effect = null
    closeAnalyzer()
    store.clear()
    analysisExecutor.shutdown()
    glThread.quitSafely()
  }

  companion object {
    const val TAG = "NiaCamera"
    /** ≈ 200 ms à 30 i/s : l'analyse a ce temps pour rendre sa réponse. */
    const val QUEUE_DEPTH = 6
    const val MAX_SYNC_MISSES = 15
    const val FACE_ON_STREAK = 2
    const val FACE_OFF_STREAK = 4
  }
}
