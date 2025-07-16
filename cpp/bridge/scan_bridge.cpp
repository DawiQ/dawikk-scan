#include "scan_bridge.h"

// C++ includes for Scan engine
#include <stdio.h>
#include <unistd.h>
#include <string>
#include <vector>
#include <array>
#include <algorithm>
#include <iostream>
#include <cstring>
#include <sstream>
#include <thread>
#include <atomic>

// Forward declaration - we'll include Scan headers
namespace {
    constexpr int NUM_PIPES = 2;
    constexpr int PARENT_WRITE_PIPE = 0;
    constexpr int PARENT_READ_PIPE = 1;
    constexpr int READ_FD = 0;
    constexpr int WRITE_FD = 1;

    constexpr size_t BUFFER_SIZE = 4096;

    std::array<std::array<int, 2>, NUM_PIPES> pipes;
    std::vector<char> buffer(BUFFER_SIZE);
    std::thread engine_thread;
    std::atomic<bool> engine_running{false};

    #define PARENT_READ_FD (pipes[PARENT_READ_PIPE][READ_FD])
    #define PARENT_WRITE_FD (pipes[PARENT_WRITE_PIPE][WRITE_FD])
}

// Global variable accessible to hub_main
static std::atomic<bool> g_engine_running{false};

// Include Scan engine headers - we need to modify main.cpp functionality
// For now, let's create a hub_main function that will be our entry point

extern "C" {

// This will be our Scan engine entry point
int hub_main();

int scan_init(void) {
    // Create communication pipes
    if (pipe(pipes[PARENT_READ_PIPE].data()) != 0) {
        return -1;
    }
    if (pipe(pipes[PARENT_WRITE_PIPE].data()) != 0) {
        return -1;
    }
    return 0;
}

int scan_main(void) {
    if (engine_running.load()) {
        return 0; // Already running
    }

    // Start engine in separate thread
    engine_thread = std::thread([]() {
        // Redirect stdin and stdout through our pipes
        dup2(pipes[PARENT_WRITE_PIPE][READ_FD], STDIN_FILENO);
        dup2(pipes[PARENT_READ_PIPE][WRITE_FD], STDOUT_FILENO);
        
        engine_running.store(true);
        g_engine_running.store(true);
        
        // Start the HUB engine - this will be our modified Scan main
        hub_main();
        
        engine_running.store(false);
        g_engine_running.store(false);
    });
    
    engine_thread.detach();
    return 0;
}

const char* scan_stdout_read(void) {
    static std::string output;
    output.clear();

    ssize_t bytesRead;
    while ((bytesRead = read(PARENT_READ_FD, buffer.data(), BUFFER_SIZE)) > 0) {
        output.append(buffer.data(), bytesRead);
        if (output.back() == '\n') {
            break;
        }
    }

    if (bytesRead < 0) {
        return nullptr;
    }

    return output.c_str();
}

int scan_stdin_write(const char* data) {
    if (!g_engine_running.load()) {
        return 0;
    }
    
    ssize_t bytesWritten = write(PARENT_WRITE_FD, data, strlen(data));
    // Ensure proper line ending
    if (bytesWritten > 0 && data[strlen(data) - 1] != '\n') {
        write(PARENT_WRITE_FD, "\n", 1);
    }
    return bytesWritten >= 0 ? 1 : 0;
}

void scan_shutdown(void) {
    if (g_engine_running.load()) {
        scan_stdin_write("quit");
        g_engine_running.store(false);
        engine_running.store(false);
        if (engine_thread.joinable()) {
            engine_thread.join();
        }
    }
    
    // Close pipes
    close(pipes[PARENT_READ_PIPE][READ_FD]);
    close(pipes[PARENT_READ_PIPE][WRITE_FD]);
    close(pipes[PARENT_WRITE_PIPE][READ_FD]);
    close(pipes[PARENT_WRITE_PIPE][WRITE_FD]);
}

// Real HUB main function that integrates with Scan engine
// Note: This is a simplified version without full Scan integration yet
int hub_main() {
    try {
        // Variables for game state
        std::string current_position = "Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww"; // starting position
        std::string variant = "normal";
        int depth_limit = 15;
        double time_limit = 1.0;
        bool engine_ready = false;
        
        std::string line;
        
        while (g_engine_running.load() && std::getline(std::cin, line)) {
            if (line.empty()) continue;
            
            std::istringstream iss(line);
            std::string command;
            iss >> command;

            if (command == "hub") {
                // Send engine identification
                std::cout << "id name=Scan version=3.1 author=\"Fabien Letouzey\" country=France" << std::endl;
                std::cout << "param name=variant value=normal type=enum values=\"normal killer bt frisian losing\"" << std::endl;
                std::cout << "param name=book value=true type=bool" << std::endl;
                std::cout << "param name=book-ply value=4 type=int min=0 max=20" << std::endl;
                std::cout << "param name=book-margin value=4 type=int min=0 max=100" << std::endl;
                std::cout << "param name=threads value=1 type=int min=1 max=16" << std::endl;
                std::cout << "param name=tt-size value=24 type=int min=16 max=30" << std::endl;
                std::cout << "param name=bb-size value=5 type=int min=0 max=7" << std::endl;
                std::cout << "wait" << std::endl;
                std::cout.flush();
                
            } else if (command == "init") {
                // Initialize engine
                engine_ready = true;
                std::cout << "ready" << std::endl;
                std::cout.flush();
                
            } else if (command == "quit") {
                break;
                
            } else if (command == "pos") {
                // Parse position command: pos pos=<position> [moves=<moves>]
                std::string token;
                while (iss >> token) {
                    if (token.find("pos=") == 0) {
                        current_position = token.substr(4);
                    } else if (token.find("moves=") == 0) {
                        // Handle moves if provided
                        std::string moves = token.substr(6);
                        // Remove quotes if present
                        if (!moves.empty() && moves[0] == '"' && moves.back() == '"') {
                            moves = moves.substr(1, moves.length() - 2);
                        }
                        // Here you would apply moves to the position
                    }
                }
                
            } else if (command == "level") {
                // Parse level command
                std::string token;
                while (iss >> token) {
                    if (token.find("depth=") == 0) {
                        depth_limit = std::stoi(token.substr(6));
                    } else if (token.find("move-time=") == 0) {
                        time_limit = std::stod(token.substr(10));
                    } else if (token.find("time=") == 0) {
                        time_limit = std::stod(token.substr(5));
                    }
                }
                
            } else if (command == "go") {
                std::string mode;
                iss >> mode;
                
                if (!engine_ready) {
                    continue;
                }
                
                if (mode == "think" || mode == "analyze") {
                    // Simulate analysis/thinking
                    // In real implementation, this would call the Scan engine
                    
                    // Send analysis info
                    for (int d = 1; d <= std::min(depth_limit, 5); d++) {
                        std::cout << "info depth=" << d 
                                  << " mean-depth=" << (d + 0.5)
                                  << " score=" << (0.15 * d / 5.0)
                                  << " nodes=" << (1000 * d)
                                  << " time=" << (0.1 * d)
                                  << " nps=" << (10000.0)
                                  << " pv=\"32-28";
                        if (d > 1) std::cout << " 19-23";
                        if (d > 2) std::cout << " 28-24";
                        std::cout << "\"" << std::endl;
                        std::cout.flush();
                    }
                    
                    // Send final move
                    std::cout << "done move=32-28 ponder=19-23" << std::endl;
                    std::cout.flush();
                    
                } else if (mode == "ponder") {
                    // Pondering mode - think on opponent's time
                    std::cout << "info depth=3 score=0.10 nodes=5000 time=0.500 nps=10000.0 pv=\"32-28 19-23\"" << std::endl;
                    std::cout.flush();
                }
                
            } else if (command == "stop") {
                // Stop current calculation
                std::cout << "done move=32-28" << std::endl;
                std::cout.flush();
                
            } else if (command == "new-game") {
                // Clear transposition table and reset
                current_position = "Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww";
                
            } else if (command == "ping") {
                std::cout << "pong" << std::endl;
                std::cout.flush();
                
            } else if (command == "set-param") {
                // Parse parameter setting: set-param name=<n> value=<value>
                std::string token;
                std::string param_name, param_value;
                while (iss >> token) {
                    if (token.find("name=") == 0) {
                        param_name = token.substr(5);
                    } else if (token.find("value=") == 0) {
                        param_value = token.substr(6);
                    }
                }
                
                if (param_name == "variant") {
                    variant = param_value;
                }
                // Handle other parameters as needed
                
            } else if (command == "ponder-hit") {
                // Ponder hit - opponent played expected move
                std::cout << "done move=32-28" << std::endl;
                std::cout.flush();
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "Error in hub_main: " << e.what() << std::endl;
        return -1;
    } catch (...) {
        std::cerr << "Unknown error in hub_main" << std::endl;
        return -1;
    }
    
    return 0;
}

} // extern "C"