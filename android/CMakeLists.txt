cmake_minimum_required(VERSION 3.8)
project(dawikk-scan)

# Ścieżki do źródeł Scan
set(SCAN_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../cpp/scan)
set(BRIDGE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../cpp/bridge)

# Ustawienia kompilacji
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 17)

# Include directories
include_directories(
    ${SCAN_DIR}
    ${BRIDGE_DIR}
)

# Znajdź wszystkie pliki źródłowe Scan
file(GLOB SCAN_SOURCES 
    ${SCAN_DIR}/*.cpp
)

# Znajdź wszystkie pliki nagłówkowe
file(GLOB SCAN_HEADERS
    ${SCAN_DIR}/*.hpp
    ${SCAN_DIR}/*.h
)

# Wyklucz main.cpp jeśli istnieje
list(FILTER SCAN_SOURCES EXCLUDE REGEX "main\\.cpp$")

# Dodaj specyficzne definicje dla Scan
add_definitions(-DHUB_PROTOCOL -DNDEBUG)

# Utwórz bibliotekę współdzieloną
add_library(
    scan-lib
    SHARED
    
    # JNI implementation
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/scan_jni.cpp
    
    # Bridge implementation  
    ${BRIDGE_DIR}/scan_bridge.cpp
    
    # Scan sources
    ${SCAN_SOURCES}
)

# Linkuj wymagane biblioteki
target_link_libraries(
    scan-lib
    android
    log
)

# Dodaj flagi kompilacji specyficzne dla Scan
target_compile_definitions(scan-lib PRIVATE
    # Dodaj definicje wymagane przez Scan
)