require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "dawikk-scan"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "12.0" }
  s.source       = { :git => package["repository"]["url"], :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{h,m,mm}", 
    "cpp/bridge/**/*.{h,cpp}",
    "cpp/scan/**/*.{h,cpp,hpp}"
  ]
  
  s.private_header_files = "cpp/bridge/scan_bridge.h"

  s.exclude_files = "cpp/scan/main.cpp"
  
  s.pod_target_xcconfig = { 
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "CLANG_CXX_LIBRARY" => "libc++",
    "OTHER_CPLUSPLUSFLAGS" => "-DHUB_PROTOCOL -DNDEBUG",
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/cpp\""
  }

  s.dependency "React-Core"
end