#ifdef __APPLE__
#include <TargetConditionals.h>
#if TARGET_OS_IOS || TARGET_OS_IPHONE_SIMULATOR
#define MOBILE_BUILD 1
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#endif
#endif

#include "scan_bridge.h"

// Include Scan engine headers
#include "../scan/src/bb_base.hpp"
#include "../scan/src/bb_comp.hpp"
#include "../scan/src/bb_index.hpp"
#include "../scan/src/bit.hpp"
#include "../scan/src/book.hpp"
#include "../scan/src/common.hpp"
#include "../scan/src/eval.hpp"
#include "../scan/src/fen.hpp"
#include "../scan/src/game.hpp"
#include "../scan/src/gen.hpp"
#include "../scan/src/hash.hpp"
#include "../scan/src/hub.hpp"
#include "../scan/src/libmy.hpp"
#include "../scan/src/move.hpp"
#include "../scan/src/pos.hpp"
#include "../scan/src/search.hpp"
#include "../scan/src/sort.hpp"
#include "../scan/src/thread.hpp"
#include "../scan/src/tt.hpp"
#include "../scan/src/util.hpp"
#include "../scan/src/var.hpp"

#include <sstream>
#include <chrono>
#include <algorithm>
#include <iostream>

namespace ScanBridge {

class Engine::Impl {
private:
    std::atomic<ScanStatus> status_;
    std::string lastError_;
    mutable std::mutex errorMutex_;
    
    // Threading
    std::thread engineThread_;
    std::atomic<bool> shouldStop_;
    
    // Message handling
    std::function<void(const std::string&)> messageCallback_;
    std::mutex callbackMutex_;
    
    // Command queue (thread-safe)
    std::queue<std::string> commandQueue_;
    std::mutex queueMutex_;
    std::condition_variable queueCondition_;
    
    // Engine state
    Game engineGame_;
    std::atomic<bool> engineInitialized_;
    
    // Message buffer for output
    std::queue<std::string> outputQueue_;
    std::mutex outputMutex_;
    
public:
    Impl() : status_(SCAN_STATUS_STOPPED), shouldStop_(false), engineInitialized_(false) {}
    
    ~Impl() {
        shutdown();
    }
    
    ScanResult init() {
        if (status_.load() != SCAN_STATUS_STOPPED) {
            return SCAN_ERROR_ALREADY_RUNNING;
        }
        
        try {
            setStatus(SCAN_STATUS_INITIALIZING);
            
            // Initialize Scan engine components
            bit::init();
            hash::init();
            pos::init();
            var::init();
            
            bb::index_init();
            bb::comp_init();
            
            ml::rand_init();
            
            setStatus(SCAN_STATUS_READY);
            return SCAN_SUCCESS;
            
        } catch (const std::exception& e) {
            setError("Failed to initialize Scan engine: " + std::string(e.what()));
            setStatus(SCAN_STATUS_ERROR);
            return SCAN_ERROR_INIT_FAILED;
        } catch (...) {
            setError("Unknown error during Scan engine initialization");
            setStatus(SCAN_STATUS_ERROR);
            return SCAN_ERROR_INIT_FAILED;
        }
    }
    
    ScanResult start() {
        if (status_.load() != SCAN_STATUS_READY && status_.load() != SCAN_STATUS_STOPPED) {
            return SCAN_ERROR_NOT_INITIALIZED;
        }
        
        try {
            shouldStop_.store(false);
            engineThread_ = std::thread(&Impl::engineLoop, this);
            
            // Wait for engine to be ready
            auto timeout = std::chrono::steady_clock::now() + std::chrono::seconds(10);
            while (status_.load() != SCAN_STATUS_READY && 
                   std::chrono::steady_clock::now() < timeout) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            
            if (status_.load() != SCAN_STATUS_READY) {
                setError("Engine failed to start within timeout");
                return SCAN_ERROR_TIMEOUT;
            }
            
            return SCAN_SUCCESS;
            
        } catch (const std::exception& e) {
            setError("Failed to start engine thread: " + std::string(e.what()));
            setStatus(SCAN_STATUS_ERROR);
            return SCAN_ERROR_ENGINE_ERROR;
        }
    }
    
    ScanResult sendCommand(const std::string& command) {
        if (status_.load() == SCAN_STATUS_STOPPED || status_.load() == SCAN_STATUS_ERROR) {
            return SCAN_ERROR_NOT_INITIALIZED;
        }
        
        if (command.empty()) {
            return SCAN_ERROR_INVALID_COMMAND;
        }
        
        try {
            std::lock_guard<std::mutex> lock(queueMutex_);
            commandQueue_.push(command);
            queueCondition_.notify_one();
            return SCAN_SUCCESS;
        } catch (...) {
            return SCAN_ERROR_ENGINE_ERROR;
        }
    }
    
    void setMessageCallback(std::function<void(const std::string&)> callback) {
        std::lock_guard<std::mutex> lock(callbackMutex_);
        messageCallback_ = callback;
    }
    
    ScanStatus getStatus() const {
        return status_.load();
    }
    
    std::string getLastError() const {
        std::lock_guard<std::mutex> lock(errorMutex_);
        return lastError_;
    }
    
    void shutdown() {
        shouldStop_.store(true);
        queueCondition_.notify_all();
        
        if (engineThread_.joinable()) {
            engineThread_.join();
        }
        
        setStatus(SCAN_STATUS_STOPPED);
    }
    
    bool isReady() const {
        return status_.load() == SCAN_STATUS_READY;
    }
    
    bool waitReady(int timeoutSeconds) {
        auto timeout = std::chrono::steady_clock::now() + std::chrono::seconds(timeoutSeconds);
        
        while (status_.load() != SCAN_STATUS_READY && 
               std::chrono::steady_clock::now() < timeout) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            
            if (status_.load() == SCAN_STATUS_ERROR) {
                return false;
            }
        }
        
        return status_.load() == SCAN_STATUS_READY;
    }

private:
    void engineLoop() {
        try {
            setStatus(SCAN_STATUS_READY);
            
            // Initialize game
            engineGame_.clear();
            engineInitialized_.store(true);
            
            // Send initial ready message
            sendMessage("wait");
            
            while (!shouldStop_.load()) {
                std::string command;
                
                // Wait for command
                {
                    std::unique_lock<std::mutex> lock(queueMutex_);
                    queueCondition_.wait_for(lock, std::chrono::milliseconds(100), 
                        [this] { return !commandQueue_.empty() || shouldStop_.load(); });
                    
                    if (shouldStop_.load()) {
                        break;
                    }
                    
                    if (!commandQueue_.empty()) {
                        command = commandQueue_.front();
                        commandQueue_.pop();
                    }
                }
                
                if (!command.empty()) {
                    processCommand(command);
                }
            }
            
        } catch (const std::exception& e) {
            setError("Engine loop error: " + std::string(e.what()));
            setStatus(SCAN_STATUS_ERROR);
        } catch (...) {
            setError("Unknown engine loop error");
            setStatus(SCAN_STATUS_ERROR);
        }
        
        engineInitialized_.store(false);
    }
    
    void processCommand(const std::string& line) {
        try {
            hub::Scanner scan(line);
            
            if (scan.eos()) {
                sendMessage("error message=\"missing command\"");
                return;
            }
            
            std::string command = scan.get_command();
            
            if (command == "hub") {
                handleHubCommand(scan);
            } else if (command == "init") {
                handleInitCommand(scan);
            } else if (command == "pos") {
                handlePosCommand(scan);
            } else if (command == "go") {
                handleGoCommand(scan);
            } else if (command == "level") {
                handleLevelCommand(scan);
            } else if (command == "stop") {
                handleStopCommand(scan);
            } else if (command == "new-game") {
                handleNewGameCommand(scan);
            } else if (command == "ping") {
                sendMessage("pong");
            } else if (command == "set-param") {
                handleSetParamCommand(scan);
            } else if (command == "quit") {
                shouldStop_.store(true);
            } else {
                sendMessage("error message=\"unknown command: " + command + "\"");
            }
            
        } catch (const std::exception& e) {
            sendMessage("error message=\"command processing error: " + std::string(e.what()) + "\"");
        } catch (...) {
            sendMessage("error message=\"unknown command processing error\"");
        }
    }
    
    void handleHubCommand(hub::Scanner& scan) {
        sendMessage("id name=Scan version=3.1 author=\"Fabien Letouzey\" country=France");
        
        // Send parameters
        sendMessage("param name=variant value=normal type=enum values=\"normal killer bt frisian losing\"");
        sendMessage("param name=book value=true type=bool");
        sendMessage("param name=book-ply value=4 type=int min=0 max=20");
        sendMessage("param name=book-margin value=4 type=int min=0 max=100");
        sendMessage("param name=threads value=1 type=int min=1 max=16");
        sendMessage("param name=tt-size value=24 type=int min=16 max=30");
        sendMessage("param name=bb-size value=5 type=int min=0 max=7");
        
        sendMessage("wait");
    }
    
    void handleInitCommand(hub::Scanner& scan) {
        try {
            bit::init();
            
            if (var::Book) {
                try {
                    book::init();
                } catch (...) {
                    var::set("book", "false");
                    var::update();
                }
            }
            
            if (var::BB) {
                try {
                    bb::init();
                } catch (...) {
                    var::set("bb-size", "0");
                    var::update();
                }
            }
            
            eval_init();
            G_TT.set_size(var::TT_Size);
            
            sendMessage("ready");
            
        } catch (const std::exception& e) {
            sendMessage("error message=\"init failed: " + std::string(e.what()) + "\"");
        }
    }
    
    void handlePosCommand(hub::Scanner& scan) {
        try {
            std::string pos = pos_hub(pos::Start);
            std::string moves;
            
            while (!scan.eos()) {
                auto p = scan.get_pair();
                
                if (p.name == "start") {
                    pos = pos_hub(pos::Start);
                } else if (p.name == "pos") {
                    pos = p.value;
                } else if (p.name == "moves") {
                    moves = p.value;
                }
            }
            
            // Set position
            engineGame_.init(pos_from_hub(pos));
            
            // Apply moves
            if (!moves.empty()) {
                std::stringstream ss(moves);
                std::string move_str;
                
                while (ss >> move_str) {
                    try {
                        Move mv = move::from_hub(move_str, engineGame_.pos());
                        
                        if (!move::is_legal(mv, engineGame_.pos())) {
                            sendMessage("error message=\"illegal move: " + move_str + "\"");
                            return;
                        }
                        
                        engineGame_.add_move(mv);
                        
                    } catch (const Bad_Input &) {
                        sendMessage("error message=\"bad move: " + move_str + "\"");
                        return;
                    }
                }
            }
            
        } catch (const Bad_Input &) {
            sendMessage("error message=\"bad position\"");
        } catch (const std::exception& e) {
            sendMessage("error message=\"position error: " + std::string(e.what()) + "\"");
        }
    }
    
    void handleGoCommand(hub::Scanner& scan) {
        try {
            setStatus(SCAN_STATUS_THINKING);
            
            bool think = false;
            bool ponder = false;
            bool analyze = false;
            
            while (!scan.eos()) {
                auto p = scan.get_pair();
                
                if (p.name == "think") {
                    think = true;
                } else if (p.name == "ponder") {
                    ponder = true;
                } else if (p.name == "analyze") {
                    analyze = true;
                }
            }
            
            // Perform search
            Search_Input si;
            si.move = !analyze;
            si.book = !analyze;
            si.input = false;
            si.output = Output_None; // We'll handle output ourselves
            si.ponder = ponder;
            
            Search_Output so;
            search(so, engineGame_.node(), si);
            
            Move move = so.move;
            Move answer = so.answer;
            
            if (move == move::None) {
                move = quick_move(engineGame_.node());
            }
            
            if (move != move::None && answer == move::None) {
                answer = quick_move(engineGame_.node().succ(move));
            }
            
            // Send result
            std::string response = "done";
            if (move != move::None) {
                response += " move=" + move::to_hub(move, engineGame_.pos());
            }
            if (answer != move::None) {
                Pos p1 = engineGame_.pos().succ(move);
                response += " ponder=" + move::to_hub(answer, p1);
            }
            
            sendMessage(response);
            setStatus(SCAN_STATUS_READY);
            
        } catch (const std::exception& e) {
            sendMessage("error message=\"search error: " + std::string(e.what()) + "\"");
            setStatus(SCAN_STATUS_READY);
        }
    }
    
    void handleLevelCommand(hub::Scanner& scan) {
        // Handle level commands (depth, time, etc.)
        // Implementation depends on specific requirements
        sendMessage("info message=\"level command processed\"");
    }
    
    void handleStopCommand(hub::Scanner& scan) {
        // Stop current search
        setStatus(SCAN_STATUS_READY);
    }
    
    void handleNewGameCommand(hub::Scanner& scan) {
        try {
            G_TT.clear();
            engineGame_.clear();
        } catch (const std::exception& e) {
            sendMessage("error message=\"new game error: " + std::string(e.what()) + "\"");
        }
    }
    
    void handleSetParamCommand(hub::Scanner& scan) {
        try {
            std::string name;
            std::string value;
            
            while (!scan.eos()) {
                auto p = scan.get_pair();
                
                if (p.name == "name") {
                    name = p.value;
                } else if (p.name == "value") {
                    value = p.value;
                }
            }
            
            if (name.empty()) {
                sendMessage("error message=\"missing parameter name\"");
                return;
            }
            
            var::set(name, value);
            var::update();
            
        } catch (const std::exception& e) {
            sendMessage("error message=\"invalid parameter: " + std::string(e.what()) + "\"");
        }
    }
    
    void sendMessage(const std::string& message) {
        std::lock_guard<std::mutex> lock(callbackMutex_);
        if (messageCallback_) {
            try {
                messageCallback_(message);
            } catch (...) {
                // Ignore callback errors to prevent crashes
            }
        }
    }
    
    void setStatus(ScanStatus status) {
        status_.store(status);
    }
    
    void setError(const std::string& error) {
        std::lock_guard<std::mutex> lock(errorMutex_);
        lastError_ = error;
    }
};

// Static instance
Engine& Engine::getInstance() {
    static Engine instance;
    return instance;
}

Engine::~Engine() = default;

ScanResult Engine::init() {
    if (!pImpl) {
        pImpl = std::make_unique<Impl>();
    }
    return pImpl->init();
}

ScanResult Engine::start() {
    if (!pImpl) {
        return SCAN_ERROR_NOT_INITIALIZED;
    }
    return pImpl->start();
}

ScanResult Engine::sendCommand(const std::string& command) {
    if (!pImpl) {
        return SCAN_ERROR_NOT_INITIALIZED;
    }
    return pImpl->sendCommand(command);
}

void Engine::setMessageCallback(std::function<void(const std::string&)> callback) {
    if (pImpl) {
        pImpl->setMessageCallback(callback);
    }
}

ScanStatus Engine::getStatus() const {
    if (!pImpl) {
        return SCAN_STATUS_STOPPED;
    }
    return pImpl->getStatus();
}

std::string Engine::getLastError() const {
    if (!pImpl) {
        return "Engine not initialized";
    }
    return pImpl->getLastError();
}

void Engine::shutdown() {
    if (pImpl) {
        pImpl->shutdown();
    }
}

bool Engine::isReady() const {
    if (!pImpl) {
        return false;
    }
    return pImpl->isReady();
}

bool Engine::waitReady(int timeoutSeconds) {
    if (!pImpl) {
        return false;
    }
    return pImpl->waitReady(timeoutSeconds);
}

} // namespace ScanBridge

// C interface implementation
static MessageCallback g_callback = nullptr;
static void* g_context = nullptr;

extern "C" {

ScanResult scan_bridge_init(void) {
    return ScanBridge::Engine::getInstance().init();
}

ScanResult scan_bridge_start(void) {
    return ScanBridge::Engine::getInstance().start();
}

ScanResult scan_bridge_send_command(const char* command) {
    if (!command) {
        return SCAN_ERROR_INVALID_COMMAND;
    }
    return ScanBridge::Engine::getInstance().sendCommand(std::string(command));
}

void scan_bridge_set_callback(MessageCallback callback, void* context) {
    g_callback = callback;
    g_context = context;
    
    if (callback) {
        ScanBridge::Engine::getInstance().setMessageCallback(
            [](const std::string& message) {
                if (g_callback) {
                    g_callback(message.c_str(), g_context);
                }
            }
        );
    } else {
        ScanBridge::Engine::getInstance().setMessageCallback(nullptr);
    }
}

ScanStatus scan_bridge_get_status(void) {
    return ScanBridge::Engine::getInstance().getStatus();
}

const char* scan_bridge_get_last_error(void) {
    static std::string error;
    error = ScanBridge::Engine::getInstance().getLastError();
    return error.c_str();
}

void scan_bridge_shutdown(void) {
    ScanBridge::Engine::getInstance().shutdown();
}

bool scan_bridge_is_ready(void) {
    return ScanBridge::Engine::getInstance().isReady();
}

bool scan_bridge_wait_ready(int timeout_seconds) {
    return ScanBridge::Engine::getInstance().waitReady(timeout_seconds);
}

}