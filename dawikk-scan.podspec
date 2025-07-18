require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "dawikk-scan"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"] || "https://github.com/yourusername/react-native-scan"
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "11.0" }
  s.source       = { :git => "https://github.com/yourusername/react-native-scan.git", :tag => "#{s.version}" }

  # Define all source files - include ALL Scan engine files
  s.source_files = [
    "ios/**/*.{h,m,mm}", 
    "cpp/bridge/**/*.{h,cpp}",
    "cpp/scan/src/**/*.{h,cpp,hpp}"
  ]
  
  # Define private headers
  s.private_header_files = [
    "cpp/bridge/scan_bridge.h",
    "cpp/scan/src/**/*.{h,hpp}"
  ]

  # Exclude main.cpp since we integrate it into bridge
  s.exclude_files = "cpp/scan/src/main.cpp"

  # Resources - evaluation files, opening books, and config
  s.resource_bundles = {
    'ScanData' => [
      'cpp/scan/data/**/*',
      'cpp/scan/scan.ini'
    ]
  }
  
  # C++ settings - removed -mpopcnt as it's not supported on ARM64
  s.pod_target_xcconfig = { 
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "CLANG_CXX_LIBRARY" => "libc++",
    "OTHER_CPLUSPLUSFLAGS" => [
      "-DNDEBUG",
      "-O2", 
      "-flto",
      "-std=c++14",
      "-fno-rtti",
      "-pthread",
      "-Wno-comma", 
      "-Wno-deprecated-declarations",
      "-Wno-unused-parameter",
      "-Wno-unused-variable",
      "-Wno-sign-compare"
    ].join(" "),
    "OTHER_LDFLAGS" => "-pthread -flto -O2",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/cpp/bridge\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp/scan/src\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp\""
    ].join(" "),
    "GCC_PREPROCESSOR_DEFINITIONS" => "NDEBUG=1"
  }

  # Link with required frameworks
  s.frameworks = "Foundation"
  
  # Dependencies
  s.dependency "React-Core"
end