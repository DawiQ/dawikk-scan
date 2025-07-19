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
  s.exclude_files = [
    "cpp/scan/src/main.cpp",
    "cpp/scan/src/dxp.cpp",      # Exclude DXP protocol (network play)
    "cpp/scan/src/dxp.hpp",
    "cpp/scan/src/socket.cpp",   # Exclude socket code
    "cpp/scan/src/socket.hpp"
  ]

  # Resources - evaluation files, opening books, and config
  s.resource_bundles = {
    'ScanData' => [
      'cpp/scan/data/**/*',
      'cpp/scan/scan.ini'
    ]
  }
  
  # C++ settings - optimized for mobile
  s.pod_target_xcconfig = { 
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "CLANG_CXX_LIBRARY" => "libc++",
    "OTHER_CPLUSPLUSFLAGS" => [
      "-DNDEBUG",
      "-DMOBILE_BUILD=1",
      "-O2", 
      "-std=c++17",
      "-fno-rtti",
      "-pthread",
      "-Wno-comma", 
      "-Wno-deprecated-declarations",
      "-Wno-unused-parameter",
      "-Wno-unused-variable",
      "-Wno-sign-compare",
      "-Wno-unused-function",
      "-fexceptions"
    ].join(" "),
    "OTHER_LDFLAGS" => "-pthread -O2",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/cpp/bridge\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp/scan/src\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp\""
    ].join(" "),
    "GCC_PREPROCESSOR_DEFINITIONS" => [
      "NDEBUG=1",
      "MOBILE_BUILD=1"
    ].join(" "),
    "ENABLE_BITCODE" => "NO",  # Disable bitcode for C++ compatibility
    "SWIFT_OPTIMIZATION_LEVEL" => "-O",
    "GCC_OPTIMIZATION_LEVEL" => "2"
  }

  # User target settings for the host app
  s.user_target_xcconfig = {
    "ENABLE_BITCODE" => "NO",
    "OTHER_LDFLAGS" => "-pthread"
  }

  # Link with required frameworks
  s.frameworks = "Foundation"
  s.libraries = "c++"
  
  # Dependencies
  s.dependency "React-Core"
  
  # Installation message
  s.post_install do |installer|
    puts ""
    puts "✅ dawikk-scan installed successfully!"
    puts "📋 Make sure to:"
    puts "   1. Clean and rebuild your project"
    puts "   2. Reset Metro cache: npx react-native start --reset-cache"
    puts "   3. For iOS: cd ios && pod install"
    puts ""
  end

  # Validate installation
  s.prepare_command = <<-CMD
    echo "🔍 Validating Scan engine files..."
    
    # Check if main engine files exist
    if [ ! -f "cpp/scan/src/search.cpp" ]; then
      echo "❌ Error: Scan engine source files not found!"
      echo "Please ensure all Scan engine files are properly included."
      exit 1
    fi
    
    # Check if data files exist
    if [ ! -d "cpp/scan/data" ]; then
      echo "⚠️  Warning: Scan data directory not found. Engine may not work properly."
    fi
    
    echo "✅ Validation complete"
  CMD
end