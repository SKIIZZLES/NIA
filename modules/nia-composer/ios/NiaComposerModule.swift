import ExpoModulesCore

/// Bouchon iOS (phase P0) : l'export AVFoundation viendra plus tard.
/// `isAvailable` renvoie false, et l'app garde le comportement actuel
/// (assemblage sans ré-encodage, réglages appliqués à la lecture).
public class NiaComposerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NiaComposer")

    Events("onProgress")

    Function("isAvailable") {
      return false
    }

    AsyncFunction("exportAsync") { (_: String, promise: Promise) in
      promise.reject("ERR_UNAVAILABLE", "NiaComposer is not implemented on iOS yet")
    }

    AsyncFunction("cancelAsync") { () -> Void in
    }
  }
}
