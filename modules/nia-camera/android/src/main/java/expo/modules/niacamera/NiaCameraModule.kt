package expo.modules.niacamera

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class NiaRecordOptions : Record {
  /** Secondes ; 0 = sans limite. */
  @Field
  var maxDuration: Double = 0.0

  /** Octets ; 0 = sans limite. */
  @Field
  var maxFileSize: Double = 0.0
}

class NiaCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NiaCamera")

    Function("isAvailable") { true }

    View(NiaCameraView::class) {
      Events("onCameraReady", "onMountError", "onFaceChange", "onStats")

      Prop("facing") { view: NiaCameraView, value: String? ->
        view.facing = if (value == "front") "front" else "back"
      }
      Prop("effect") { view: NiaCameraView, value: String? ->
        // "blur" | "pixelate" | "skimask" | "fullmask"
        view.setEffectMode(value ?: "blur")
      }
      Prop("syncMode") { view: NiaCameraView, value: String? ->
        view.setSyncMode(value ?: "exact")
      }
      Prop("zoom") { view: NiaCameraView, value: Float? ->
        view.setZoom(value ?: 0f)
      }
      Prop("enableTorch") { view: NiaCameraView, value: Boolean? ->
        view.setTorch(value == true)
      }
      Prop("mute") { view: NiaCameraView, value: Boolean? ->
        view.mute = value == true
      }

      OnViewDidUpdateProps { view: NiaCameraView ->
        view.onPropsUpdated()
      }

      OnViewDestroys { view: NiaCameraView ->
        view.release()
      }

      AsyncFunction("record") { view: NiaCameraView, options: NiaRecordOptions, promise: Promise ->
        view.record(options.maxDuration, options.maxFileSize, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("stopRecording") { view: NiaCameraView ->
        view.stopRecording()
      }.runOnQueue(Queues.MAIN)
    }
  }
}
