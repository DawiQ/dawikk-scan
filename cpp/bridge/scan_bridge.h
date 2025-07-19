#ifndef SCAN_BRIDGE_H
#define SCAN_BRIDGE_H

// C headers (zawsze dostępne)
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// Message callback type for engine output
typedef void (*MessageCallback)(const char* message, void* context);

// Engine status enum
typedef enum {
    SCAN_STATUS_STOPPED = 0,
    SCAN_STATUS_INITIALIZING = 1,
    SCAN_STATUS_READY = 2,
    SCAN_STATUS_THINKING = 3,
    SCAN_STATUS_ERROR = 4
} ScanStatus;

// Result codes
typedef enum {
    SCAN_SUCCESS = 0,
    SCAN_ERROR_INIT_FAILED = -1,
    SCAN_ERROR_NOT_INITIALIZED = -2,
    SCAN_ERROR_ALREADY_RUNNING = -3,
    SCAN_ERROR_INVALID_COMMAND = -4,
    SCAN_ERROR_ENGINE_ERROR = -5,
    SCAN_ERROR_TIMEOUT = -6
} ScanResult;

// Initialize the Scan engine bridge
ScanResult scan_bridge_init(void);

// Start the Scan engine
ScanResult scan_bridge_start(void);

// Send command to the engine (thread-safe)
ScanResult scan_bridge_send_command(const char* command);

// Set message callback for engine output
void scan_bridge_set_callback(MessageCallback callback, void* context);

// Get current engine status
ScanStatus scan_bridge_get_status(void);

// Get last error message
const char* scan_bridge_get_last_error(void);

// Stop and cleanup the engine
void scan_bridge_shutdown(void);

// Check if engine is ready for commands
bool scan_bridge_is_ready(void);

// Wait for engine to be ready (with timeout in seconds)
bool scan_bridge_wait_ready(int timeout_seconds);

#ifdef __cplusplus
}

// C++ headers tylko w sekcji C++
#include <string>
#include <functional>
#include <memory>
#include <atomic>
#include <thread>
#include <queue>
#include <mutex>
#include <condition_variable>

// C++ interface for better integration
namespace ScanBridge {
    
    class Engine {
    public:
        static Engine& getInstance();
        
        // Initialize the engine
        ScanResult init();
        
        // Start the engine
        ScanResult start();
        
        // Send command (returns immediately, result via callback)
        ScanResult sendCommand(const std::string& command);
        
        // Set callback for engine messages
        void setMessageCallback(std::function<void(const std::string&)> callback);
        
        // Get current status
        ScanStatus getStatus() const;
        
        // Get last error
        std::string getLastError() const;
        
        // Shutdown
        void shutdown();
        
        // Check if ready
        bool isReady() const;
        
        // Wait for ready state
        bool waitReady(int timeoutSeconds = 10);
        
    private:
        Engine() = default;
        ~Engine();
        
        // Prevent copying
        Engine(const Engine&) = delete;
        Engine& operator=(const Engine&) = delete;
        
        // Internal implementation
        class Impl;
        std::unique_ptr<Impl> pImpl;
    };
}

#endif // __cplusplus

#endif // SCAN_BRIDGE_H