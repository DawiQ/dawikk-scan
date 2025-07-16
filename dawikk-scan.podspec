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

  # Define all source files
  s.source_files = [
    "ios/**/*.{h,m,mm}", 
    "cpp/bridge/**/*.{h,cpp}",
    "cpp/scan/src/**/*.{h,cpp,hpp}"
  ]
  
  # Define private headers
  s.private_header_files = "cpp/bridge/scan_bridge.h"

  # Exclude main.cpp if it exists (we have our own main)
  s.exclude_files = "cpp/scan/src/main.cpp"

  # Resources - evaluation files and opening books
  s.resource_bundles = {
    'ScanData' => ['cpp/scan/data/**/*']
  }
  
  # C++ settings
  s.pod_target_xcconfig = { 
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "CLANG_CXX_LIBRARY" => "libc++",
    "OTHER_CPLUSPLUSFLAGS" => "-DNDEBUG -Wno-comma -Wno-deprecated-declarations",
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/cpp\""
  }

  s.dependency "React-Core"
end