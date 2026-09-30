Pod::Spec.new do |s|
  s.name           = 'NiaComposer'
  s.version        = '0.1.0'
  s.summary        = 'NIA — export vidéo sur l’appareil (bouchon iOS en P0)'
  s.description    = 'Module Expo local. Android : Media3 Transformer. iOS : bouchon, le parcours de création garde son comportement actuel.'
  s.author         = 'NIA'
  s.homepage       = 'https://github.com/SKIIZZLES/NIA'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
