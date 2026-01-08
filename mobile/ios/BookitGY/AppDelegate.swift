import Expo
import React
import ReactAppDependencyProvider

// @generated begin react-native-maps-import - expo prebuild (DO NOT MODIFY) sync-bee50fec513f89284e0fa3f5d935afdde33af98f
#if canImport(GoogleMaps)
import GoogleMaps
#endif
// @generated end react-native-maps-import
@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

// @generated begin react-native-maps-init - expo prebuild (DO NOT MODIFY) sync-001d8ce0c176b2a0f2e649d849dac0806af3a551
#if canImport(GoogleMaps)
GMSServices.provideAPIKey("AIzaSyDif7VfeWmBgax6MrIyOh3ebblieZtKE8I")
#endif
// @generated end react-native-maps-init
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
